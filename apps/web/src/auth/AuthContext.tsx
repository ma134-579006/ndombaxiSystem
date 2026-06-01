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

type AuthStatus = 'loading' | 'authed' | 'guest';
/** Que painel mostrar: plataforma (Super Admin) ou gestor da empresa. */
export type AuthMode = 'platform' | 'tenant';

const LS_ACCESS = 'ndombaxi.web.access';
const LS_REFRESH = 'ndombaxi.web.refresh';
const LS_COMPANY = 'ndombaxi.web.company';

interface AuthContextValue {
  status: AuthStatus;
  user: DecodedJwt | null;
  mode: AuthMode | null;
  companyCode: string | null;
  loginPlatform(input: PlatformLoginInput): Promise<void>;
  loginTenant(input: TenantLoginInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Deriva o modo do painel a partir do JWT (subjectType). */
function modeFromUser(u: DecodedJwt | null): AuthMode | null {
  if (!u) return null;
  return u.subjectType === 'PLATFORM' ? 'platform' : 'tenant';
}

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

  const loginPlatform = useCallback(
    async (input: PlatformLoginInput) => {
      // Super Admin não usa código de empresa.
      companyRef.current = undefined;
      setCompanyCode(null);
      localStorage.removeItem(LS_COMPANY);
      applyTokens(await api.login(input));
      setStatus('authed');
    },
    [applyTokens],
  );

  const loginTenant = useCallback(
    async (input: TenantLoginInput) => {
      companyRef.current = input.companyCode;
      setCompanyCode(input.companyCode);
      localStorage.setItem(LS_COMPANY, input.companyCode);
      applyTokens(await api.loginTenant(input));
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
      loginPlatform,
      loginTenant,
      logout,
    }),
    [status, user, companyCode, loginPlatform, loginTenant, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
