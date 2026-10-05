import React, { useState } from 'react';
import { copyrightLine } from '../brand';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { useKeyboard } from '../keyboard/KeyboardProvider';
import { isNativeApp, storeCodeFrom } from '../native';
import { forgetRecentStore, readRecentStores, type RecentStore } from '../state/StoreContext';
import { BarcodeScanner } from './BarcodeScanner';
import { IconChevronRight, IconClose, IconKeyboard, IconPin, IconReceipt, IconShield, IconStore } from './Icons';

const VERSION = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '';
const LOGO = `${import.meta.env.BASE_URL}logo.png`;

/** Iniciais para o avatar de uma loja recente ("Kero Hipermercados" → "KH"). */
function initials(name: string): string {
  const w = name.trim().split(/\s+/).filter(Boolean);
  return ((w[0]?.[0] ?? '') + (w[1]?.[0] ?? '')).toUpperCase() || '·';
}

/**
 * Entrada na loja: código, link partilhado ou QR. Na app LPS Loja é o ecrã
 * inicial (o cliente compra em várias lojas); no site só aparece quando o link
 * não traz a loja.
 */
export function StorePicker({ onOpen, error }: { onOpen(code: string): void; error?: string | null }) {
  const kbd = useKeyboard();
  const [input, setInput] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentStore[]>(() => readRecentStores());

  const submit = () => {
    const code = storeCodeFrom(input);
    if (!code) { setMsg('Código inválido. Use só letras, números e hífen (ex.: minha-loja) ou cole o link da loja.'); return; }
    setMsg(null);
    onOpen(code);
  };

  return (
    <div className="sp">
      <div className="sp-col">
        <header className="sp-hero">
          <img className="sp-logo" src={LOGO} alt="LPS Vendas" width={88} height={88} />
          <h1>{isNativeApp ? 'As suas lojas, num só lugar' : 'Abrir loja'}</h1>
          <p>Escreva o código da loja, cole o link que recebeu ou leia o QR da loja.</p>
        </header>

        <section className="sp-card" aria-label="Entrar numa loja">
          {error ? <div className="banner danger sp-msg">{error}</div> : null}
          <label className="sp-label" htmlFor="sp-code">Código ou link da loja</label>
          <div className="sp-field">
            <span className="sp-field-ic" aria-hidden><IconStore size={20} /></span>
            <KeyboardInput value={input} onChange={(v) => { setInput(v); setMsg(null); }} placeholder="ex.: minha-loja" onSubmit={submit} autoFocus={!isNativeApp} />
          </div>
          {msg ? <div className="sp-hint err">{msg}</div> : null}
          <button className="btn lg block" onClick={submit} disabled={!input.trim()}>
            Entrar na loja <IconChevronRight size={18} />
          </button>
          <div className="sp-or" role="separator"><span>ou</span></div>
          <BarcodeScanner mode="qr" label="Ler QR da loja"
            onDetected={(txt) => { const c = storeCodeFrom(txt); if (c) { onOpen(c); return true; } return false; }} />
        </section>

        {recent.length ? (
          <section className="sp-recent" aria-label="Lojas recentes">
            <h2>Lojas recentes</h2>
            <ul>
              {recent.map((r) => (
                <li key={r.code}>
                  <button className="sp-store" onClick={() => onOpen(r.code)}>
                    <span className="sp-avatar" aria-hidden>{initials(r.name)}</span>
                    <span className="sp-store-tx">
                      <span className="nm">{r.name}</span>
                      <span className="cd">{r.code}</span>
                    </span>
                    <IconChevronRight size={18} />
                  </button>
                  <button className="sp-forget" onClick={() => setRecent(forgetRecentStore(r.code))} aria-label={`Esquecer ${r.name}`} title="Esquecer">
                    <IconClose size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <ul className="sp-trust">
          <li><IconShield size={18} /><span>Pagamento seguro com os meios que a loja aceita (Multicaixa Express, referência…)</span></li>
          <li><IconPin size={18} /><span>Entrega com localização em tempo real</span></li>
          <li><IconReceipt size={18} /><span>Factura de cada compra sempre disponível na sua conta</span></li>
        </ul>

        {!isNativeApp ? (
          // Teclado no ecrã — para terminais táteis (quiosques na loja).
          <button type="button" className={`kbd-toggle${kbd.enabled ? ' on' : ''}`} onClick={() => kbd.toggle()}
            style={{ width: '100%', cursor: 'pointer', textAlign: 'left' }}>
            <span className="meta">
              <IconKeyboard size={18} />
              <span>
                <span className="ttl" style={{ display: 'block' }}>Teclado no ecrã</span>
                <span className="hint">Para terminais táteis sem teclado físico.</span>
              </span>
            </span>
            <span style={{ fontWeight: 800, color: kbd.enabled ? 'var(--accent)' : 'var(--muted)' }}>{kbd.enabled ? 'Ligado' : 'Desligado'}</span>
          </button>
        ) : null}

        <p className="sp-foot">{copyrightLine()}{VERSION ? ` · versão ${VERSION}` : ''}</p>
      </div>
    </div>
  );
}
