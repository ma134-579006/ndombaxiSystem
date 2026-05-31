import React, { useState } from 'react';
import { copyrightLine } from './brand';
import { IconStore } from './components/Icons';
import { Storefront } from './pages/Storefront';
import { StoreProvider, useStore } from './state/StoreContext';

function Gate() {
  const { code, setCode, status, error } = useStore();
  const [input, setInput] = useState('');

  if (!code) {
    return (
      <div className="gate">
        <div className="card">
          <div className="logo"><IconStore size={32} /></div>
          <h2 style={{ margin: '0 0 6px' }}>Abrir loja</h2>
          <p className="muted" style={{ marginTop: 0 }}>Indique o código da loja para entrar.</p>
          <div className="field" style={{ marginTop: 10 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && input.trim()) setCode(input);
              }}
              placeholder="codigo-da-loja"
              autoFocus
            />
          </div>
          <button className="btn lg block" onClick={() => setCode(input)} disabled={!input.trim()}>
            Entrar
          </button>
          <p className="sig" style={{ marginTop: 18, fontSize: 12, color: 'var(--muted)' }}>{copyrightLine()}</p>
        </div>
      </div>
    );
  }

  if (status === 'loading' || status === 'idle') {
    return (
      <div className="gate">
        <p className="muted">A abrir a loja…</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="gate">
        <div className="card">
          <div className="logo"><IconStore size={32} /></div>
          <h2 style={{ margin: '0 0 6px' }}>Loja indisponível</h2>
          <div className="banner danger" style={{ marginBottom: 14 }}>{error}</div>
          <button className="btn ghost block" onClick={() => setCode('')}>Tentar outro código</button>
        </div>
      </div>
    );
  }

  return <Storefront />;
}

export function App() {
  return (
    <StoreProvider>
      <Gate />
    </StoreProvider>
  );
}
