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
import { storage } from './storage';

type AuthStatus = 'loading' | 'authed' | 'guest';

interface AuthContextValue {
  status: AuthStatus;
  user: DecodedJwt | null;
  accessToken: string | null;
  companyCode: string | null;
  /** Faz login; lança ApiError em caso de falha (para a UI mostrar). */
  login(input: TenantLoginInput): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<DecodedJwt | null>(null);
  const [companyCode, setCompanyCode] = useState<string | null>(null);

  // Refs com os valores actuais para os ganchos do cliente HTTP (sempre frescos).
  const accessRef = useRef<string | null>(null);
  const refreshRef = useRef<string | null>(null);
  const companyRef = useRef<string | undefined>(undefined);

  const applyTokens = useCallback((tokens: TokenPair) => {
    accessRef.current = tokens.accessToken;
    refreshRef.current = tokens.refreshToken;
    setAccessToken(tokens.accessToken);
    setUser(decodeJwt(tokens.accessToken));
    void storage.saveTokens(tokens);
  }, []);

  const clearSession = useCallback(() => {
    accessRef.current = null;
    refreshRef.current = null;
    setAccessToken(null);
    setUser(null);
    setStatus('guest');
    void storage.clearTokens();
  }, []);

  // Liga os ganchos de autenticação ao cliente HTTP (uma só vez).
  useEffect(() => {
    configureApi({
      getAccessToken: () => accessRef.current,
      getCompanyCode: () => companyRef.current,
      onAuthLost: () => clearSession(),
      refresh: async () => {
        const rt = refreshRef.current;
        if (!rt) return false;
        try {
          const pair = await api.refresh(rt);
          applyTokens(pair);
          return true;
        } catch {
          return false;
        }
      },
    });
  }, [applyTokens, clearSession]);

  // Restaura a sessão guardada no arranque.
  useEffect(() => {
    let alive = true;
    (async () => {
      const code = await storage.loadCompanyCode();
      if (alive && code) {
        companyRef.current = code;
        setCompanyCode(code);
      }
      const tokens = await storage.loadTokens();
      if (!alive) return;
      if (!tokens) {
        setStatus('guest');
        return;
      }
      accessRef.current = tokens.accessToken;
      refreshRef.current = tokens.refreshToken;
      if (!isExpired(tokens.accessToken)) {
        setAccessToken(tokens.accessToken);
        setUser(decodeJwt(tokens.accessToken));
        setStatus('authed');
        return;
      }
      // Access expirado → tenta renovar com o refresh.
      try {
        const pair = await api.refresh(tokens.refreshToken);
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

  const login = useCallback(
    async (input: TenantLoginInput) => {
      const tokens = await api.login(input);
      if (input.companyCode) {
        companyRef.current = input.companyCode;
        setCompanyCode(input.companyCode);
        void storage.saveCompanyCode(input.companyCode);
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
        // ignora falhas de rede no logout — limpa local de qualquer forma
      }
    }
    clearSession();
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, accessToken, companyCode, login, logout }),
    [status, user, accessToken, companyCode, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
