import React, { useState } from 'react';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { Shell, type Section } from './components/Shell';
import { Login } from './pages/Login';
import { Ai } from './sections/Ai';
import { Fiscal } from './sections/Fiscal';
import { Gateways } from './sections/Gateways';
import { Tenants } from './sections/Tenants';

function Authed() {
  const [section, setSection] = useState<Section>('tenants');
  return (
    <Shell section={section} setSection={setSection}>
      {section === 'tenants' ? <Tenants /> : null}
      {section === 'ai' ? <Ai /> : null}
      {section === 'fiscal' ? <Fiscal /> : null}
      {section === 'gateways' ? <Gateways /> : null}
    </Shell>
  );
}

function Gate() {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <div className="login">
        <span className="muted">A carregar…</span>
      </div>
    );
  }
  return status === 'authed' ? <Authed /> : <Login />;
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
