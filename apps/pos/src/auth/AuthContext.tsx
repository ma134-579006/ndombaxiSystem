import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, ApiError, configureApi } from '../api/client';
import type { TenantLoginInput, TokenPair } from '../api/types';
import { decodeJwt, isExpired, type DecodedJwt } from './jwt';
import { setTheme } from '../theme';
import {
  clearPendingUpgrade, getPendingUpgrade, rememberOffline, setPendingUpgrade, verifyOffline,
} from '../offline/session';
import { isOfflineToken, syncCredentials } from '../offline/credentials';

type AuthStatus = 'loading' | 'authed' | 'guest';

/**
 * Falhou por não haver SERVIDOR do outro lado? `status 0` é o fetch que nem
 * saiu; 408/502/503/504 são o intermediário a dizer que a API não respondeu.
 * Em nenhum destes casos alguém validou o PIN — e recusar aqui é o que deixava
 * a Caixa instalada inútil. Um 401 continua a ser um NÃO do servidor.
 */
function isNetworkFailure(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status === 408 || (e.status >= 502 && e.status <= 504));
}

const LS_ACCESS = 'nexus.pos.access';
const LS_REFRESH = 'nexus.pos.refresh';
const LS_COMPANY = 'nexus.pos.company';

interface AuthContextValue {
  status: AuthStatus;
  user: DecodedJwt | null;
  companyCode: string | null;
  login(input: TenantLoginInput): Promise<void>;
  loginGoogle(idToken: string): Promise<void>;
  /** Login do operador por nome (id) + PIN (estilo Vendus). */
  loginPin(companyCode: string, userId: string, pin: string): Promise<void>;
  loginStaff(email: string, pin: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<DecodedJwt | null>(null);
  const [companyCode, setCompanyCode] = useState<string | null>(
    () => localStorage.getItem(LS_COMPANY),
  );

  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const companyRef = useRef<string | undefined>(localStorage.getItem(LS_COMPANY) ?? undefined);
  // Refresh ÚNICO em voo (single-flight): dedupe chamadas concorrentes. Sem isto, a
  // renovação proativa e o refresh disparado por um 401 corriam ao mesmo tempo,
  // reutilizavam o MESMO refresh token (a API revoga-o na rotação) e a 2ª recebia
  // 401 → logout — exatamente o que acontecia ao desbloquear o ecrã passados >15 min.
  const refreshInFlight = useRef<Promise<boolean> | null>(null);

  const applyTokens = useCallback((tokens: TokenPair) => {
    accessRef.current = tokens.accessToken;
    refreshRef.current = tokens.refreshToken;
    // Tokens em sessionStorage (por-aba): nova aba/ligação copiada NÃO herda a
    // sessão → exige novo login do operador (PIN). Mais seguro.
    sessionStorage.setItem(LS_ACCESS, tokens.accessToken);
    sessionStorage.setItem(LS_REFRESH, tokens.refreshToken);
    setUser(decodeJwt(tokens.accessToken));
  }, []);

  const clearSession = useCallback(() => {
    accessRef.current = null;
    refreshRef.current = null;
    sessionStorage.removeItem(LS_ACCESS);
    sessionStorage.removeItem(LS_REFRESH);
    setUser(null);
    setStatus('guest');
  }, []);

  // Renova o token UMA vez de cada vez (single-flight). Só termina a sessão quando
  // o refresh token é REJEITADO (401/403). Erros de rede (status 0) ou de servidor
  // (5xx — API a acordar) PRESERVAM a sessão — nunca há logout por inatividade/rede.
  const doRefresh = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const p = (async () => {
      const rt = refreshRef.current;
      // SESSÃO OFFLINE PROVISÓRIA: token cunhado no posto, que o servidor
      // recusa (e bem). Não se renova — promove-se, com o que o operador
      // escreveu ao entrar, sem lhe pedir o PIN outra vez.
      if (isOfflineToken(accessRef.current)) {
        const up = getPendingUpgrade();
        if (up) {
          try {
            const r = await api.staffLogin(up.email, up.pin);
            companyRef.current = r.companyCode;
            setCompanyCode(r.companyCode);
            localStorage.setItem(LS_COMPANY, r.companyCode);
            applyTokens(r);
            clearPendingUpgrade();
            void rememberOffline({
              companyCode: r.companyCode, email: up.email, pin: up.pin,
              accessToken: r.accessToken, refreshToken: r.refreshToken,
            });
            void syncCredentials(r.companyCode, true);
            return true;
          } catch (e) {
            if (isNetworkFailure(e)) return false; // ainda sem rede — sessão de pé
          }
        }
        // Houve resposta do servidor (logo há rede) e não há como promover:
        // o caminho honesto é pedir o login outra vez.
        clearSession();
        return false;
      }
      if (!rt) { clearSession(); return false; }
      try { applyTokens(await api.refresh(rt)); return true; }
      catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) clearSession();
        return false;
      }
    })().finally(() => { refreshInFlight.current = null; });
    refreshInFlight.current = p;
    return p;
  }, [applyTokens, clearSession]);

  // Liga os ganchos ao cliente HTTP.
  useEffect(() => {
    configureApi({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
      onAuthLost: () => clearSession(),
      refresh: () => doRefresh(),
    });
  }, [clearSession, doRefresh]);

  // CREDENCIAIS DA EMPRESA no posto + promoção da sessão offline.
  // Sessão provisória → tenta o login verdadeiro (assim que a rede voltar, a
  // sessão passa a real sem o operador dar por nada). Sessão real → mantém o
  // pacote de credenciais em dia (PIN trocado, colega novo, saída).
  // Relógio simples, NUNCA `navigator.onLine`: nas apps nativas esse valor mente.
  useEffect(() => {
    if (status !== 'authed' || !companyRef.current) return;
    const t = window.setInterval(() => {
      if (isOfflineToken(accessRef.current)) { void doRefresh(); return; }
      void syncCredentials(companyRef.current);
    }, 60_000);
    return () => window.clearInterval(t);
  }, [status, doRefresh]);

  // Renovação PROATIVA do token de acesso: renova ~1 min ANTES de expirar para a
  // sessão nunca cair sozinha aos 15 min. A inatividade apenas BLOQUEIA o ecrã
  // (IdleLock, 2m30), preservando a venda em curso; nunca faz logout.
  useEffect(() => {
    if (status !== 'authed' || !user?.exp) return;
    const msLeft = user.exp * 1000 - Date.now() - 60_000; // 1 min de margem
    const delay = Math.min(Math.max(msLeft, 5_000), 12 * 60 * 1000);
    const t = window.setTimeout(() => { void doRefresh(); }, delay);
    return () => window.clearTimeout(t);
  }, [status, user, doRefresh]);

  // Restaura a sessão guardada.
  useEffect(() => {
    let alive = true;
    (async () => {
      const access = sessionStorage.getItem(LS_ACCESS);
      const refresh = sessionStorage.getItem(LS_REFRESH);
      if (!access || !refresh) {
        if (alive) setStatus('guest');
        return;
      }
      accessRef.current = access;
      refreshRef.current = refresh;
      if (!isExpired(access)) {
        if (!alive) return;
        setUser(decodeJwt(access));
        setStatus('authed');
        return;
      }
      try {
        const pair = await api.refresh(refresh);
        if (!alive) return;
        applyTokens(pair);
        setStatus('authed');
      } catch {
        if (alive) clearSession();
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyTokens, clearSession]);

  // Tema por perfil: ao autenticar, aplica o tema guardado na conta.
  useEffect(() => {
    if (status !== 'authed') return;
    let alive = true;
    void (async () => {
      try {
        const { theme } = await api.preferences.get();
        if (alive) setTheme(theme || '');
      } catch { /* mantém o tema local */ }
    })();
    return () => { alive = false; };
  }, [status, user]);

  const login = useCallback(
    async (input: TenantLoginInput) => {
      const tokens = await api.login(input);
      if (input.companyCode) {
        companyRef.current = input.companyCode;
        setCompanyCode(input.companyCode);
        localStorage.setItem(LS_COMPANY, input.companyCode);
      }
      applyTokens(tokens);
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginGoogle = useCallback(
    async (idToken: string) => {
      // A empresa é encontrada pelo e-mail da conta Google; a API devolve o
      // código resolvido (fica guardado para o PIN/troca de operador).
      const r = await api.loginGoogle(idToken);
      companyRef.current = r.companyCode;
      setCompanyCode(r.companyCode);
      localStorage.setItem(LS_COMPANY, r.companyCode);
      applyTokens(r);
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginPin = useCallback(
    async (code: string, userId: string, pin: string) => {
      const tokens = await api.loginPin({ companyCode: code, userId, pin });
      companyRef.current = code;
      setCompanyCode(code);
      localStorage.setItem(LS_COMPANY, code);
      applyTokens(tokens);
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginStaff = useCallback(
    async (email: string, pin: string) => {
      const em = email.trim().toLowerCase();
      try {
        const r = await api.staffLogin(em, pin);
        companyRef.current = r.companyCode;
        setCompanyCode(r.companyCode);
        localStorage.setItem(LS_COMPANY, r.companyCode);
        applyTokens(r);
        setStatus('authed');
        // ADITIVO: memoriza a credencial para reabrir a Caixa OFFLINE com o mesmo
        // PIN. Best-effort — nunca deixa isto quebrar o login que acabou de dar.
        void rememberOffline({
          companyCode: r.companyCode, email: em, pin,
          accessToken: r.accessToken, refreshToken: r.refreshToken,
        });
        clearPendingUpgrade();
        // Traz as credenciais da EMPRESA INTEIRA para este posto: é o que
        // permite a qualquer colega abrir a Caixa aqui sem rede, mesmo que
        // nunca tenha escrito o PIN neste aparelho.
        void syncCredentials(r.companyCode, true);
      } catch (e) {
        // SÓ falha de rede → tenta entrar OFFLINE com o mesmo PIN. Um erro do
        // servidor (PIN errado, 4xx) segue o caminho normal e é mostrado.
        if (isNetworkFailure(e)) {
          const off = await verifyOffline(em, pin, companyRef.current);
          if (off.ok && off.identity) {
            companyRef.current = off.identity.companyCode;
            setCompanyCode(off.identity.companyCode);
            localStorage.setItem(LS_COMPANY, off.identity.companyCode);
            if (off.provisional) setPendingUpgrade({ email: em, pin });
            else clearPendingUpgrade();
            applyTokens({
              accessToken: off.identity.accessToken,
              // Sem refresh do servidor guardamos o próprio token local, para a
              // sessão offline sobreviver a um recarregamento da janela.
              refreshToken: off.identity.refreshToken || off.identity.accessToken,
            });
            setStatus('authed');
            return;
          }
          if (off.reason === 'wrong-pin') throw new ApiError(0, 'PIN incorreto (modo offline).');
          if (off.reason === 'expired') throw new ApiError(0, 'A sessão offline expirou. Ligue-se à internet uma vez para renovar.');
          throw new ApiError(0, 'Sem ligação e sem sessão offline neste aparelho. Entre uma vez com internet para poder usar offline.');
        }
        throw e;
      }
    },
    [applyTokens],
  );

  const logout = useCallback(async () => {
    const rt = refreshRef.current;
    if (rt) {
      try {
        await api.logout(rt);
      } catch {
        /* ignora falhas de rede no logout */
      }
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, companyCode, login, loginGoogle, loginPin, loginStaff, logout }),
    [status, user, companyCode, login, loginGoogle, loginPin, loginStaff, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
