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
import type { PlatformLoginInput, TenantLoginInput, TenantTokenPair, TokenPair } from '../api/types';
import { decodeJwt, isExpired, type DecodedJwt } from './jwt';
import { setTheme, DEFAULT_THEME } from '../theme';
import { startOfflineEngine, stopOfflineEngine } from '../offline/boot';
import { prefetchTenantData } from '../offline/prefetch';
// NOTA: o cofre NÃO é apagado no logout de propósito. Se o fosse, um gestor que
// terminasse a sessão sem rede ficava impedido de voltar a entrar no próprio
// posto. A credencial expira sozinha ao fim de 30 dias (ver session.ts).
import {
  clearPendingUpgrade, getPendingUpgrade, rememberOffline, setPendingUpgrade, verifyOffline,
} from '../offline/session';
import { isOfflineToken, syncCredentials } from '../offline/credentials';
import { offerSessionToHost } from '../offline/localServer';

type AuthStatus = 'loading' | 'authed' | 'guest';
/** Que painel mostrar: plataforma (Super Admin) ou gestor da empresa. */
export type AuthMode = 'platform' | 'tenant';

const LS_ACCESS = 'ndombaxi.web.access';
const LS_REFRESH = 'ndombaxi.web.refresh';
const LS_COMPANY = 'ndombaxi.web.company';
const LS_SESSION_START = 'ndombaxi.web.session_start';
// Tempo de vida ABSOLUTO da sessão (segurança): após isto, re-login obrigatório,
// mesmo com refresh token válido. Evita sessões "eternas" guardadas no browser.
const MAX_SESSION_MS = 12 * 60 * 60 * 1000; // 12 horas
// Acesso shadow: guarda a sessão de plataforma para restaurar ao sair.
const LS_SHADOW = 'ndombaxi.web.shadow';
const LS_PREV_ACCESS = 'ndombaxi.web.prevaccess';
const LS_PREV_REFRESH = 'ndombaxi.web.prevrefresh';

interface AuthContextValue {
  status: AuthStatus;
  user: DecodedJwt | null;
  mode: AuthMode | null;
  companyCode: string | null;
  /** Nome da empresa quando em modo shadow (Super Admin dentro de uma empresa). */
  shadow: string | null;
  loginPlatform(input: PlatformLoginInput): Promise<void>;
  loginTenant(input: TenantLoginInput): Promise<void>;
  loginGoogle(idToken: string, companyCode?: string): Promise<void>;
  adoptSession(tokens: TokenPair, companyCode: string): void;
  enterShadow(tokens: TokenPair, companyCode: string, companyName: string): void;
  exitShadow(): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * A tentativa de login falhou por não haver SERVIDOR do outro lado?
 *
 * `status === 0` é o fetch que nem saiu (sem rede, DNS, TLS, tempo esgotado).
 * Mas há mais formas de não haver servidor: o intermediário devolve 502/503/504
 * quando a API está em baixo ou a acordar, e 408 quando desiste. Em qualquer
 * destes casos ninguém validou as credenciais — e recusar a entrada aqui seria
 * exatamente o que deixava a app instalada inútil. Um 401 continua a ser um NÃO
 * do servidor e nunca cai para o caminho offline.
 */
function isNetworkFailure(e: unknown): boolean {
  return e instanceof ApiError && (e.status === 0 || e.status === 408 || (e.status >= 502 && e.status <= 504));
}

/** Deriva o modo do painel a partir do JWT (subjectType). */
function modeFromUser(u: DecodedJwt | null): AuthMode | null {
  if (!u) return null;
  return u.subjectType === 'PLATFORM' ? 'platform' : 'tenant';
}

/**
 * Auto-logout DESATIVADO: a sessão nunca termina sozinha (nem por inatividade,
 * nem por tempo de vida absoluto). A inatividade apenas BLOQUEIA o ecrã (IdleLock),
 * preservando a sessão e o trabalho. A sessão só acaba com logout explícito ou
 * quando o refresh token deixar de ser aceite pelo servidor.
 */
function sessionExpired(): boolean {
  return false;
}
// Mantido para referência (tempo de vida absoluto, já não aplicado):
void MAX_SESSION_MS;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<DecodedJwt | null>(null);
  const [companyCode, setCompanyCode] = useState<string | null>(
    () => sessionStorage.getItem(LS_COMPANY),
  );
  const [shadow, setShadow] = useState<string | null>(() => sessionStorage.getItem(LS_SHADOW));

  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const companyRef = useRef<string | undefined>(sessionStorage.getItem(LS_COMPANY) ?? undefined);
  // Refresh ÚNICO em voo (single-flight): dedupe chamadas concorrentes para o mesmo
  // refresh token (a API revoga-o na rotação). Evita a corrida proativo×on-demand
  // que reutilizava o token → 401 → logout (ex.: desbloquear o ecrã passados >15 min).
  const refreshInFlight = useRef<Promise<boolean> | null>(null);

  const applyTokens = useCallback((tokens: TokenPair) => {
    accessRef.current = tokens.accessToken;
    refreshRef.current = tokens.refreshToken;
    sessionStorage.setItem(LS_ACCESS, tokens.accessToken);
    sessionStorage.setItem(LS_REFRESH, tokens.refreshToken);
    setUser(decodeJwt(tokens.accessToken));
  }, []);

  const clearSession = useCallback(() => {
    accessRef.current = null;
    refreshRef.current = null;
    sessionStorage.removeItem(LS_ACCESS);
    sessionStorage.removeItem(LS_REFRESH);
    sessionStorage.removeItem(LS_SESSION_START);
    sessionStorage.removeItem(LS_SHADOW);
    sessionStorage.removeItem(LS_PREV_ACCESS);
    sessionStorage.removeItem(LS_PREV_REFRESH);
    setShadow(null);
    setUser(null);
    setStatus('guest');
  }, []);

  // Renova o token UMA vez de cada vez (single-flight). Só termina a sessão quando
  // o refresh token é REJEITADO (401/403); rede/servidor preservam a sessão.
  const doRefresh = useCallback((): Promise<boolean> => {
    if (refreshInFlight.current) return refreshInFlight.current;
    const p = (async () => {
      const rt = refreshRef.current;
      // SESSÃO OFFLINE PROVISÓRIA: o token foi cunhado no aparelho, o servidor
      // recusa-o (e bem). Aqui não se renova — PROMOVE-SE: faz-se um login
      // verdadeiro com o que o utilizador escreveu ao entrar, sem lhe pedir a
      // senha outra vez.
      if (isOfflineToken(accessRef.current)) {
        const up = getPendingUpgrade();
        if (up) {
          try {
            const r = await api.loginTenant(up);
            const code = up.companyCode ?? r.companyCode;
            companyRef.current = code;
            setCompanyCode(code);
            sessionStorage.setItem(LS_COMPANY, code);
            applyTokens(r);
            clearPendingUpgrade();
            void rememberOffline({
              companyCode: code, email: up.email, password: up.password,
              accessToken: r.accessToken, refreshToken: r.refreshToken,
            }).catch(() => undefined);
            void syncCredentials(code, true);
            return true;
          } catch (e) {
            // Ainda sem rede → a sessão offline continua de pé (não deslogar).
            if (e instanceof ApiError && e.status === 0) return false;
          }
        }
        // Chegámos aqui com resposta do servidor (logo, há rede) e sem forma de
        // promover a sessão: o caminho honesto é pedir o login outra vez.
        clearSession();
        return false;
      }
      if (!rt) { clearSession(); return false; }
      if (sessionExpired()) { clearSession(); return false; } // (desativado — sempre false)
      try { applyTokens(await api.refresh(rt)); return true; }
      catch (e) {
        if (e instanceof ApiError && (e.status === 401 || e.status === 403)) clearSession();
        return false;
      }
    })().finally(() => { refreshInFlight.current = null; });
    refreshInFlight.current = p;
    return p;
  }, [applyTokens, clearSession]);

  useEffect(() => {
    configureApi({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
      onAuthLost: () => clearSession(),
      refresh: () => doRefresh(),
    });
  }, [clearSession, doRefresh]);

  // OFFLINE-FIRST (Fatia 1): o motor de sincronização vive enquanto houver sessão
  // de gestor de uma empresa. Aditivo — mantém o cache local das entidades de
  // referência e expõe o estado; não altera nenhum fluxo existente. Só no modo
  // tenant (com código de empresa); o super admin não tem schema de tenant.
  useEffect(() => {
    if (status !== 'authed' || !companyRef.current) return;
    void startOfflineEngine({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
    });
    // DOWNLOAD COMPLETO ao entrar: puxa já todos os dados de referência da
    // empresa para a cache local (Gestão 100% navegável offline). E repete
    // sempre que a rede REGRESSA, para a cópia local ficar atualizada — "quando
    // verifica a rede, baixa os dados". Só leituras; best-effort.
    void prefetchTenantData();
    const onOnline = () => { void prefetchTenantData(); };
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      void stopOfflineEngine();
    };
  }, [status]);

  // CREDENCIAIS DA EMPRESA no aparelho + promoção da sessão offline.
  //
  // Duas coisas, um só relógio:
  //  1. Se a sessão é provisória (entrou sem rede com credenciais provisionadas),
  //     tenta fazer o login verdadeiro. Assim que a ligação voltar, a sessão
  //     passa a ser real sem o utilizador dar por nada.
  //  2. Com sessão real, re-sincroniza o pacote de credenciais de vez em quando
  //     — senhas trocadas, colegas novos, saídas. É o "ir sincronizando".
  //
  // A cadência é um relógio simples e não `navigator.onLine`: nas apps nativas
  // esse valor MENTE (já custou uma regressão em que a app inteira dizia
  // "sem ligação" com internet a funcionar).
  useEffect(() => {
    if (status !== 'authed' || !companyRef.current) return;
    const tick = () => {
      if (isOfflineToken(accessRef.current)) { void doRefresh(); return; }
      void syncCredentials(companyRef.current);
      // Oferece a sessão ao posto: se for altura de trazer a empresa para a base
      // local, ele trata disso sozinho. Sem botão e sem perguntar nada — quem
      // decide é o processo principal, que sabe o que o navegador não sabe
      // (ficheiros instalados, espaço em disco, tentativas falhadas).
      const tok = accessRef.current;
      if (tok && user?.role) {
        void offerSessionToHost({
          accessToken: tok, companyCode: companyRef.current!, role: user.role,
        });
      }
    };
    const t = window.setInterval(tick, 60_000);
    // Uma primeira tentativa logo à entrada, sem esperar o minuto.
    tick();
    return () => window.clearInterval(t);
  }, [status, doRefresh, user]);

  // Renovação PROATIVA do token: renova ~1 min antes de expirar para a sessão do
  // gestor nunca cair sozinha (incl. quando o gestor abre/usa a caixa). Só a
  // inatividade bloqueia o ecrã; nunca há logout automático.
  useEffect(() => {
    if (status !== 'authed' || !user?.exp) return;
    const msLeft = user.exp * 1000 - Date.now() - 60_000;
    const delay = Math.min(Math.max(msLeft, 5_000), 12 * 60 * 1000);
    const t = window.setTimeout(() => { void doRefresh(); }, delay);
    return () => window.clearTimeout(t);
  }, [status, user, doRefresh]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const access = sessionStorage.getItem(LS_ACCESS);
      const refresh = sessionStorage.getItem(LS_REFRESH);
      if (!access || !refresh) {
        if (alive) setStatus('guest');
        return;
      }
      if (sessionExpired()) {
        // Sessão guardada expirou → limpa e pede login outra vez.
        clearSession();
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
        applyTokens(await api.refresh(refresh));
        if (alive) setStatus('authed');
      } catch {
        if (alive) clearSession();
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyTokens, clearSession]);

  // Tema POR PERFIL: ao autenticar, aplica o tema guardado na conta (no
  // servidor). Outra conta neste dispositivo recebe o tema dela (ou o padrão).
  useEffect(() => {
    if (status !== 'authed') return;
    let alive = true;
    void (async () => {
      try {
        const { theme } = await api.preferences.get();
        // Sem preferência guardada no servidor → CLARO (tema por defeito).
        if (alive) setTheme(theme || DEFAULT_THEME);
      } catch {
        /* sem rede / sem preferência → mantém o tema local */
      }
    })();
    return () => { alive = false; };
  }, [status, user]);

  // SEGURANÇA: NÃO há logout por inatividade — a inatividade apenas BLOQUEIA o
  // ecrã (ver IdleLock), preservando a sessão e o trabalho em curso. Aqui só se
  // verifica o tempo de vida ABSOLUTO da sessão (12h) → re-login obrigatório.
  useEffect(() => {
    if (status !== 'authed') return;
    const tick = window.setInterval(() => {
      if (sessionExpired()) void logout();
    }, 30_000);
    return () => window.clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const loginPlatform = useCallback(
    async (input: PlatformLoginInput) => {
      // Super Admin não usa código de empresa.
      companyRef.current = undefined;
      setCompanyCode(null);
      sessionStorage.removeItem(LS_COMPANY);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(await api.login(input));
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginTenant = useCallback(
    async (input: TenantLoginInput) => {
      // O código deixou de ser pedido: a API resolve a empresa pelo e-mail
      // e devolve o código (necessário para o cabeçalho X-Tenant-Code).
      let r: TenantTokenPair;
      try {
        r = await api.loginTenant(input);
      } catch (e) {
        // SEM REDE (status 0): tenta a credencial guardada no aparelho. É o que
        // torna a app instalada utilizável offline — a sessão vive em
        // `sessionStorage` e morre ao fechar a janela, por isso sem esta porta
        // reabrir sem internet deixava o gestor de fora. Só entra aqui quando o
        // login online FALHOU POR REDE: credenciais erradas continuam a ser
        // recusadas pelo servidor, como sempre.
        if (isNetworkFailure(e)) {
          const v = await verifyOffline(input.email, input.password, input.companyCode);
          if (v.ok && v.identity) {
            companyRef.current = v.identity.companyCode;
            setCompanyCode(v.identity.companyCode);
            sessionStorage.setItem(LS_COMPANY, v.identity.companyCode);
            sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
            // Sessão provisória (credenciais provisionadas, sem tokens do
            // servidor): guarda em memória o que foi escrito, para a promover a
            // sessão real mal a rede volte — sem voltar a pedir a senha.
            if (v.provisional) {
              setPendingUpgrade({
                email: input.email, password: input.password,
                companyCode: input.companyCode ?? v.identity.companyCode,
              });
            } else {
              clearPendingUpgrade();
            }
            applyTokens({
              accessToken: v.identity.accessToken,
              // Sem refresh token do servidor guardamos o próprio token local:
              // é o que permite à sessão offline sobreviver a um recarregamento
              // da janela (o arranque exige os dois valores).
              refreshToken: v.identity.refreshToken || v.identity.accessToken,
            });
            setStatus('authed');
            return;
          }
          if (v.reason === 'wrong-password') {
            throw new ApiError(0, 'Palavra-passe incorreta (verificação offline).');
          }
          if (v.reason === 'expired') {
            throw new ApiError(0, 'O acesso offline expirou. Ligue-se à internet uma vez para renovar.');
          }
        }
        throw e;
      }
      const code = input.companyCode ?? r.companyCode;
      companyRef.current = code;
      setCompanyCode(code);
      sessionStorage.setItem(LS_COMPANY, code);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(r);
      setStatus('authed');
      clearPendingUpgrade();
      // Guarda a credencial para o próximo arranque sem rede (best-effort: uma
      // falha aqui nunca pode estragar um login que já teve sucesso).
      void rememberOffline({
        companyCode: code, email: input.email, password: input.password,
        accessToken: r.accessToken, refreshToken: r.refreshToken,
      }).catch(() => undefined);
      // E descarrega as credenciais da EMPRESA INTEIRA para este aparelho — é o
      // que permite a qualquer colega entrar aqui sem rede, mesmo que nunca
      // tenha escrito a senha neste computador/telemóvel.
      void syncCredentials(code, true);
    },
    [applyTokens],
  );

  // Adota uma sessão já emitida (ex.: após registo simples) — auto-login.
  const adoptSession = useCallback(
    (tokens: TokenPair, code: string) => {
      companyRef.current = code;
      setCompanyCode(code);
      sessionStorage.setItem(LS_COMPANY, code);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(tokens);
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginGoogle = useCallback(
    async (idToken: string, companyCode?: string) => {
      const r = await api.loginGoogle(idToken, companyCode);
      const code = companyCode ?? r.companyCode;
      companyRef.current = code;
      setCompanyCode(code);
      sessionStorage.setItem(LS_COMPANY, code);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(r);
      setStatus('authed');
    },
    [applyTokens],
  );

  const enterShadow = useCallback(
    (tokens: TokenPair, code: string, companyName: string) => {
      // Preserva a sessão de plataforma actual para restaurar ao sair.
      if (accessRef.current) sessionStorage.setItem(LS_PREV_ACCESS, accessRef.current);
      if (refreshRef.current) sessionStorage.setItem(LS_PREV_REFRESH, refreshRef.current);
      companyRef.current = code;
      setCompanyCode(code);
      sessionStorage.setItem(LS_COMPANY, code);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(tokens);
      sessionStorage.setItem(LS_SHADOW, companyName);
      setShadow(companyName);
      setStatus('authed');
    },
    [applyTokens],
  );

  const exitShadow = useCallback(() => {
    const pa = sessionStorage.getItem(LS_PREV_ACCESS);
    const pr = sessionStorage.getItem(LS_PREV_REFRESH);
    sessionStorage.removeItem(LS_PREV_ACCESS);
    sessionStorage.removeItem(LS_PREV_REFRESH);
    sessionStorage.removeItem(LS_SHADOW);
    sessionStorage.removeItem(LS_COMPANY);
    companyRef.current = undefined;
    setCompanyCode(null);
    setShadow(null);
    if (pa && pr) {
      applyTokens({ accessToken: pa, refreshToken: pr });
      setStatus('authed');
    } else {
      clearSession();
    }
  }, [applyTokens, clearSession]);

  const logout = useCallback(async () => {
    const rt = refreshRef.current;
    if (rt) {
      try {
        await api.logout(rt);
      } catch {
        /* ignora */
      }
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      mode: modeFromUser(user),
      companyCode,
      shadow,
      loginPlatform,
      loginTenant,
      loginGoogle,
      adoptSession,
      enterShadow,
      exitShadow,
      logout,
    }),
    [status, user, companyCode, shadow, loginPlatform, loginTenant, loginGoogle, adoptSession, enterShadow, exitShadow, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
