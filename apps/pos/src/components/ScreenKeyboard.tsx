import React, { useEffect, useState } from 'react';

/**
 * Teclado no ecrã AUTÓNOMO para os logins / criar conta (terminais táteis / PCs
 * sem teclado físico). Um botão flutuante (FORA do fluxo do formulário, por isso
 * NÃO causa scroll) liga/desliga; quando ligado, mostra um teclado fixo no fundo
 * que escreve no campo ATUALMENTE focado (qualquer <input>/<textarea>), via o
 * setter nativo + evento 'input' (compatível com inputs controlados pelo React).
 * Esconde-se em ecrãs ≤560px (telemóveis têm teclado nativo).
 */
const LS = 'ndombaxi.kbd.on';

function typeInto(ch: string) {
  const el = document.activeElement as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el || (el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA')) return;
  if ((el as HTMLInputElement).readOnly || el.disabled) return;
  const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  const max = (el as HTMLInputElement).maxLength;
  let next = ch === '\b' ? el.value.slice(0, -1) : el.value + ch;
  if (max && max > 0 && next.length > max) next = next.slice(0, max);
  setter?.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

const ROWS_LOWER = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm@.'];
const ROWS_UPPER = ['1234567890', 'QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM@.'];

export function ScreenKeyboard() {
  const [on, setOn] = useState<boolean>(() => { try { return localStorage.getItem(LS) === '1'; } catch { return false; } });
  const [shift, setShift] = useState(false);
  useEffect(() => { try { localStorage.setItem(LS, on ? '1' : '0'); } catch { /* */ } }, [on]);

  const rows = shift ? ROWS_UPPER : ROWS_LOWER;
  // onMouseDown + preventDefault: não rouba o foco ao input.
  const key = (ch: string) => ({ onMouseDown: (e: React.MouseEvent) => { e.preventDefault(); typeInto(ch); } });

  return (
    <>
      <button type="button" className={`oskb-toggle${on ? ' on' : ''}`} onClick={() => setOn((v) => !v)}
        title="Teclado no ecrã (para terminais sem teclado)" aria-label="Teclado no ecrã">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6" />
        </svg>
        <span className="oskb-toggle-lbl">Teclado no ecrã</span>
      </button>

      {on ? (
        <div className="oskb" role="group" aria-label="Teclado no ecrã">
          <div className="oskb-bar">
            <span>⌨ Teclado no ecrã</span>
            <button type="button" className="oskb-x" onMouseDown={(e) => { e.preventDefault(); setOn(false); }}>Fechar ✕</button>
          </div>
          {rows.map((row, i) => (
            <div className="oskb-row" key={i}>
              {i === rows.length - 1 ? (
                <button type="button" className="oskb-k wide" onMouseDown={(e) => { e.preventDefault(); setShift((s) => !s); }}>⇧</button>
              ) : null}
              {row.split('').map((c) => (
                <button type="button" className="oskb-k" key={c} {...key(shift ? c : c)}>{c}</button>
              ))}
              {i === rows.length - 1 ? (
                <button type="button" className="oskb-k wide" {...key('\b')}>⌫</button>
              ) : null}
            </div>
          ))}
          <div className="oskb-row">
            <button type="button" className="oskb-k" {...key('-')}>-</button>
            <button type="button" className="oskb-k" {...key('_')}>_</button>
            <button type="button" className="oskb-k space" {...key(' ')}>espaço</button>
            <button type="button" className="oskb-k" {...key('@')}>@</button>
            <button type="button" className="oskb-k" {...key('.')}>.</button>
          </div>
        </div>
      ) : null}
    </>
  );
}
