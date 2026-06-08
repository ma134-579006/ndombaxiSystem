import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { api, configureApi } from '../api/client';
import type { PlatformLoginInput, TenantLoginInput, TokenPair } from '../api/types';
import { decodeJwt, isExpired, type DecodedJwt } from './jwt';
import { setTheme, DEFAULT_THEME } from '../theme';

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
const IDLE_MS = 20 * 60 * 1000; // logout automático após 20 min de inatividade
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
  loginGoogle(companyCode: string, idToken: string): Promise<void>;
  adoptSession(tokens: TokenPair, companyCode: string): void;
  enterShadow(tokens: TokenPair, companyCode: string, companyName: string): void;
  exitShadow(): void;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Deriva o modo do painel a partir do JWT (subjectType). */
function modeFromUser(u: DecodedJwt | null): AuthMode | null {
  if (!u) return null;
  return u.subjectType === 'PLATFORM' ? 'platform' : 'tenant';
}

/** A sessão ultrapassou o tempo de vida absoluto? (expira o login guardado) */
function sessionExpired(): boolean {
  const started = Number(sessionStorage.getItem(LS_SESSION_START) || 0);
  return started > 0 && Date.now() - started > MAX_SESSION_MS;
}

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

  useEffect(() => {
    configureApi({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
      onAuthLost: () => clearSession(),
      refresh: async () => {
        const rt = refreshRef.current;
        if (!rt) return false;
        if (sessionExpired()) return false; // sessão expirou → força re-login
        try {
          applyTokens(await api.refresh(rt));
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [applyTokens, clearSession]);

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

  // SEGURANÇA: logout só por INATIVIDADE real (20 min) ou sessão absoluta (12h).
  // NÃO faz refresh forçado ao focar (a API do Render adormece e um refresh
  // falhado expulsava o utilizador a meio do fluxo). O cliente HTTP já trata o
  // refresh em cada pedido (401). A sessão é por-aba (sessionStorage).
  useEffect(() => {
    if (status !== 'authed') return;
    let last = Date.now();
    const bump = () => { last = Date.now(); };
    const events = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const tick = window.setInterval(() => {
      if (Date.now() - last > IDLE_MS || sessionExpired()) void logout();
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(tick);
    };
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
      companyRef.current = input.companyCode;
      setCompanyCode(input.companyCode);
      sessionStorage.setItem(LS_COMPANY, input.companyCode);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(await api.loginTenant(input));
      setStatus('authed');
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
    async (companyCode: string, idToken: string) => {
      companyRef.current = companyCode;
      setCompanyCode(companyCode);
      sessionStorage.setItem(LS_COMPANY, companyCode);
      sessionStorage.setItem(LS_SESSION_START, String(Date.now()));
      applyTokens(await api.loginGoogle(companyCode, idToken));
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
