import React from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { KeyboardProvider } from './keyboard/KeyboardProvider';
import { LoginPage } from './pages/LoginPage';
import { PosPage } from './pages/PosPage';

function Gate() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="app-bg">
        <div className="login-screen">
          <span className="muted">A carregar…</span>
        </div>
      </div>
    );
  }
  return status === 'authed' ? <PosPage /> : <LoginPage />;
}

/**
 * Raiz da Caixa NEXUS. O KeyboardProvider envolve tudo (login incluído) para
 * que o teclado no ecrã esteja disponível em todos os campos.
 */
export function App() {
  return (
    <AuthProvider>
      <KeyboardProvider>
        <Gate />
      </KeyboardProvider>
    </AuthProvider>
  );
}
