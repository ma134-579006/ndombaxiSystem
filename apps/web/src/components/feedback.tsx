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

/* ── PROGRESSO DE OPERAÇÕES EM MASSA (eliminar/desativar vários) ──────────
   Ecrã modal com percentagem real, contagem e barra. Uso:
     const r = await runBulk({ title: 'A eliminar produtos', items: ids, batchSize: 250,
                               run: async (lote) => { await api.x.removeMany(lote); } });
   - batchSize > 1: `run` recebe lotes (endpoint em lote → rápido).
   - batchSize = 1: `run` recebe 1 item; corre `concurrency` em paralelo.
   Um lote que falhe NÃO interrompe os restantes: conta como falhado. */
interface BulkState { title: string; total: number; done: number; failed: number; finished: boolean }
let setBulkUi: ((s: BulkState | null) => void) | null = null;

export interface BulkResult { done: number; failed: number; firstError: string | null }

export async function runBulk<T>(opts: {
  title: string;
  items: T[];
  run: (batch: T[]) => Promise<unknown>;
  batchSize?: number;
  concurrency?: number;
}): Promise<BulkResult> {
  const { title, items, run } = opts;
  const size = Math.max(1, opts.batchSize ?? 1);
  const conc = Math.max(1, opts.concurrency ?? (size > 1 ? 2 : 6));
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  const st: BulkState = { title, total: items.length, done: 0, failed: 0, finished: false };
  const paint = () => setBulkUi?.({ ...st });
  paint();
  let firstError: string | null = null;
  let next = 0;
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      try { await run(b); st.done += b.length; }
      catch (e) { st.failed += b.length; if (!firstError) firstError = e instanceof Error ? e.message : 'erro desconhecido'; }
      paint();
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, batches.length) }, worker));
  st.finished = true; paint();
  await new Promise((r) => setTimeout(r, 700)); // mostra o 100% antes de fechar
  setBulkUi?.(null);
  return { done: st.done, failed: st.failed, firstError };
}

function BulkProgress({ s }: { s: BulkState }) {
  const processed = s.done + s.failed;
  const pct = s.total ? Math.round((processed / s.total) * 100) : 100;
  return (
    <div className="fb-confirm-bg" role="dialog" aria-modal="true" aria-label={s.title}>
      <div className="fb-confirm fb-bulk">
        <div className={`fb-bulk-ring${s.finished ? ' ok' : ''}`} style={{ ['--p' as string]: pct }}>
          <span>{s.finished && !s.failed
            ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            : `${pct}%`}</span>
        </div>
        <h4>{s.finished ? 'Concluído' : s.title}</h4>
        <p aria-live="polite">
          {processed.toLocaleString('pt-PT')} de {s.total.toLocaleString('pt-PT')}
          {s.failed ? ` · ${s.failed.toLocaleString('pt-PT')} com erro` : ''}
        </p>
        <div className="fb-bulk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <i style={{ width: `${pct}%` }} />
        </div>
        {!s.finished ? <small className="fb-bulk-hint">Não feche esta janela.</small> : null}
      </div>
    </div>
  );
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
  const [bulk, setBulk] = useState<BulkState | null>(null);

  useEffect(() => {
    pushToast = (kind, text) => {
      const id = seq++;
      setToasts((p) => [...p.slice(-4), { id, kind, text }]);
      window.setTimeout(() => setToasts((p) => p.map((t) => (t.id === id ? { ...t, leaving: true } : t))), TOAST_MS - 300);
      window.setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), TOAST_MS);
    };
    openConfirm = (c) => setConfirm(c);
    setBulkUi = (s) => setBulk(s);
    return () => { pushToast = null; openConfirm = null; setBulkUi = null; };
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
      {bulk ? <BulkProgress s={bulk} /> : null}
    </>
  );
}
