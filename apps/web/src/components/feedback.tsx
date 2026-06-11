import React, { useEffect, useState } from 'react';

/**
 * FEEDBACK enterprise do sistema: TOASTS (canto superior direito, com ícone,
 * barra de progresso e entrada animada) + DIÁLOGO DE CONFIRMAÇÃO moderno —
 * substituem os alert()/confirm() nativos do browser em todo o painel.
 *
 * Uso:  toast.success('Guardado.');  toast.error('Falhou.');
 *       if (await confirmDialog({ message: 'Eliminar 3 produtos?', danger: true })) …
 */

type ToastKind = 'success' | 'error' | 'info' | 'warning';
interface ToastItem { id: number; kind: ToastKind; text: string; leaving?: boolean }
interface ConfirmOpts { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
interface ConfirmState extends ConfirmOpts { resolve(ok: boolean): void }

let pushToast: ((kind: ToastKind, text: string) => void) | null = null;
let openConfirm: ((c: ConfirmState) => void) | null = null;
let seq = 1;

export const toast = {
  success: (text: string) => pushToast?.('success', text),
  error: (text: string) => pushToast?.('error', text),
  info: (text: string) => pushToast?.('info', text),
  warning: (text: string) => pushToast?.('warning', text),
};

/** Confirmação bonita (substitui window.confirm). Resolve true/false. */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    if (!openConfirm) { resolve(window.confirm(opts.message)); return; } // fallback
    openConfirm({ ...opts, resolve });
  });
}

const ICONS: Record<ToastKind, React.ReactNode> = {
  success: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>,
  error: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.4v.2" /></svg>,
  warning: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 4.1 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0Z" /><path d="M12 9v4M12 17v.2" /></svg>,
  info: <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 7.6v.2" /></svg>,
};

const TOAST_MS = 4600;

/** Montar UMA vez (no App). Aloja os toasts e o diálogo de confirmação. */
export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  useEffect(() => {
    pushToast = (kind, text) => {
      const id = seq++;
      setToasts((p) => [...p.slice(-4), { id, kind, text }]);
      window.setTimeout(() => setToasts((p) => p.map((t) => (t.id === id ? { ...t, leaving: true } : t))), TOAST_MS - 300);
      window.setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), TOAST_MS);
    };
    openConfirm = (c) => setConfirm(c);
    return () => { pushToast = null; openConfirm = null; };
  }, []);

  // Esc fecha o diálogo (= cancelar)
  useEffect(() => {
    if (!confirm) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { confirm.resolve(false); setConfirm(null); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [confirm]);

  const answer = (ok: boolean) => { confirm?.resolve(ok); setConfirm(null); };

  return (
    <>
      <div className="fb-toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`fb-toast ${t.kind}${t.leaving ? ' leaving' : ''}`} role="status"
            onClick={() => setToasts((p) => p.filter((x) => x.id !== t.id))}>
            <span className="fb-toast-ic">{ICONS[t.kind]}</span>
            <span className="fb-toast-tx">{t.text}</span>
            <span className="fb-toast-bar" style={{ animationDuration: `${TOAST_MS}ms` }} />
          </div>
        ))}
      </div>
      {confirm ? (
        <div className="fb-confirm-bg" onClick={() => answer(false)} role="dialog" aria-modal="true">
          <div className="fb-confirm" onClick={(e) => e.stopPropagation()}>
            <div className={`fb-confirm-ic${confirm.danger ? ' danger' : ''}`}>
              {confirm.danger ? ICONS.warning : ICONS.info}
            </div>
            <h4>{confirm.title ?? (confirm.danger ? 'Tens a certeza?' : 'Confirmar')}</h4>
            <p>{confirm.message}</p>
            <div className="fb-confirm-row">
              <button className="btn ghost" onClick={() => answer(false)}>{confirm.cancelLabel ?? 'Cancelar'}</button>
              <button className={`btn${confirm.danger ? ' danger' : ''}`} onClick={() => answer(true)} autoFocus>
                {confirm.confirmLabel ?? (confirm.danger ? 'Sim, continuar' : 'Confirmar')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
