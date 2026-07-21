import React, { useState } from 'react';
import { copyrightLine } from './brand';
import { IconKeyboard, IconStore } from './components/Icons';
import { KeyboardProvider, useKeyboard } from './keyboard/KeyboardProvider';
import { KeyboardInput } from './keyboard/KeyboardInput';
import { Storefront } from './pages/Storefront';
import { StoreChat } from './components/StoreChat';
import { StoreProvider, useStore } from './state/StoreContext';
import { RepairTrack } from './views/RepairTrack';

function Gate() {
  const { code, setCode, status, error } = useStore();
  const kbd = useKeyboard();
  const [input, setInput] = useState('');

  if (!code) {
    return (
      <div className="gate">
        <div className="card">
          <div className="logo"><IconStore size={32} /></div>
          <h2 style={{ margin: '0 0 6px' }}>Abrir loja</h2>
          <p className="muted" style={{ marginTop: 0 }}>Indique o código da loja para entrar.</p>
          <div style={{ marginTop: 10 }}>
            <KeyboardInput
              value={input}
              onChange={setInput}
              placeholder="codigo-da-loja"
              onSubmit={() => input.trim() && setCode(input)}
              autoFocus
            />
          </div>

          {/* Teclado no ecrã — para terminais táteis */}
          <button
            type="button"
            className={`kbd-toggle${kbd.enabled ? ' on' : ''}`}
            onClick={() => kbd.toggle()}
            style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}
          >
            <span className="meta">
              <IconKeyboard size={18} />
              <span>
                <span className="ttl" style={{ display: 'block' }}>Teclado no ecrã</span>
                <span className="hint">Para terminais táteis sem teclado físico.</span>
              </span>
            </span>
            <span style={{ fontWeight: 800, color: kbd.enabled ? 'var(--accent, #2563eb)' : 'var(--muted)' }}>
              {kbd.enabled ? 'Ligado' : 'Desligado'}
            </span>
          </button>

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

  return (
    <>
      <Storefront />
      <StoreChat code={code} />
    </>
  );
}

export function App() {
  // PORTAL DO CLIENTE: se o URL trouxer ?os=<token>&loja=<code> (QR da folha de
  // serviço), mostra o rastreio do reparo — página autónoma, sem gate nem carrinho.
  const params = new URLSearchParams(window.location.search);
  const os = params.get('os');
  const loja = params.get('loja') || params.get('code');
  if (os && loja) {
    return (
      <KeyboardProvider>
        <RepairTrack code={loja} token={os} />
      </KeyboardProvider>
    );
  }
  return (
    <StoreProvider>
      <KeyboardProvider>
        <Gate />
      </KeyboardProvider>
    </StoreProvider>
  );
}
