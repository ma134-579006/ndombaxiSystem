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
import type { TenantLoginInput, TokenPair } from '../api/types';
import { decodeJwt, isExpired, type DecodedJwt } from './jwt';
import { setTheme } from '../theme';

type AuthStatus = 'loading' | 'authed' | 'guest';

const LS_ACCESS = 'nexus.pos.access';
const LS_REFRESH = 'nexus.pos.refresh';
const LS_COMPANY = 'nexus.pos.company';

interface AuthContextValue {
  status: AuthStatus;
  user: DecodedJwt | null;
  companyCode: string | null;
  login(input: TenantLoginInput): Promise<void>;
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

  const applyTokens = useCallback((tokens: TokenPair) => {
    accessRef.current = tokens.accessToken;
    refreshRef.current = tokens.refreshToken;
    localStorage.setItem(LS_ACCESS, tokens.accessToken);
    localStorage.setItem(LS_REFRESH, tokens.refreshToken);
    setUser(decodeJwt(tokens.accessToken));
  }, []);

  const clearSession = useCallback(() => {
    accessRef.current = null;
    refreshRef.current = null;
    localStorage.removeItem(LS_ACCESS);
    localStorage.removeItem(LS_REFRESH);
    setUser(null);
    setStatus('guest');
  }, []);

  // Liga os ganchos ao cliente HTTP.
  useEffect(() => {
    configureApi({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
      onAuthLost: () => clearSession(),
      refresh: async () => {
        const rt = refreshRef.current;
        if (!rt) return false;
        try {
          applyTokens(await api.refresh(rt));
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [applyTokens, clearSession]);

  // Restaura a sessão guardada.
  useEffect(() => {
    let alive = true;
    (async () => {
      const access = localStorage.getItem(LS_ACCESS);
      const refresh = localStorage.getItem(LS_REFRESH);
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
    () => ({ status, user, companyCode, login, logout }),
    [status, user, companyCode, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
