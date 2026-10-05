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
  // Recusa PASSAGEIRA (limite de pedidos por minuto, servidor ocupado, rede):
  // espera e repete. Antes, numa eliminação de centenas de registos, a nuvem
  // recusava parte dos pedidos (429) e "uns eliminavam, outros davam erro".
  const passageira = (e: unknown) => {
    const s = (e as { status?: number })?.status;
    return s === 429 || s === 408 || s === 502 || s === 503 || s === 504 || s === 0;
  };
  const comRepeticao = async (b: T[]) => {
    for (let tentativa = 0; ; tentativa++) {
      try { return await run(b); } catch (e) {
        if (!passageira(e) || tentativa >= 5) throw e;
        await new Promise((r) => setTimeout(r, Math.min(20_000, 1_500 * 2 ** tentativa)));
      }
    }
  };
  // Lote que falha de vez é DIVIDIDO ao meio e repetido (o lote é atómico no
  // servidor — nada dele ficou feito): um registo problemático não leva os outros
  // 199 consigo, e no fim só ficam de fora os que falham mesmo.
  const executar = async (b: T[]): Promise<void> => {
    try { await comRepeticao(b); st.done += b.length; }
    catch (e) {
      if (b.length > 1) {
        const meio = Math.ceil(b.length / 2);
        await executar(b.slice(0, meio));
        await executar(b.slice(meio));
        return;
      }
      st.failed += 1;
      if (!firstError) firstError = e instanceof Error ? e.message : 'erro desconhecido';
    }
    paint();
  };
  const worker = async () => {
    while (next < batches.length) {
      const b = batches[next++];
      await executar(b);
      paint();
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, batches.length) }, worker));
  st.finished = true; paint();
  await new Promise((r) => setTimeout(r, 700)); // mostra o 100% antes de fechar
  setBulkUi?.(null);
  return { done: st.done, failed: st.failed, firstError };
}

/* ── PROGRESSO DE UPLOAD / DOWNLOAD / GERAÇÃO DE FICHEIROS ─────────────────
   O MESMO ecrã de progresso das operações em massa (anel com %, barra e estado),
   para TODO o sistema: carregar um ficheiro, descarregar um export/backup, gerar um PDF.
   - Só aparece se a operação demorar (>250 ms) — tarefas instantâneas não "piscam".
   - Se a tarefa reportar % real (ctl.setPct) usa-o; senão avança suavemente até ~92%
     e salta para 100% quando termina. Mostra o 100% antes de fechar. */
type TransferKind = 'upload' | 'download' | 'generate';
interface TransferState { title: string; kind: TransferKind; file?: string; pct: number; detail?: string; finished: boolean }
let setTransferUi: ((s: TransferState | null) => void) | null = null;
export interface TransferCtl { setPct(n: number, detail?: string): void }
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function runTransfer<T>(opts: { title: string; kind?: TransferKind; file?: string; task: (ctl: TransferCtl) => Promise<T> }): Promise<T> {
  const st: TransferState = { title: opts.title, kind: opts.kind ?? 'generate', file: opts.file, pct: 0, finished: false };
  let shown = false; let real = false; let shownAt = 0;
  const paint = () => { if (shown) setTransferUi?.({ ...st }); };
  const showTimer = window.setTimeout(() => { shown = true; shownAt = Date.now(); paint(); }, 250);
  const simTimer = window.setInterval(() => { if (real) return; st.pct = st.pct + (92 - st.pct) * 0.07; paint(); }, 130);
  const ctl: TransferCtl = { setPct: (n, d) => { real = true; st.pct = Math.max(st.pct, Math.min(99, n)); if (d) st.detail = d; paint(); } };
  const stop = () => { window.clearTimeout(showTimer); window.clearInterval(simTimer); };
  try {
    const r = await opts.task(ctl);
    stop();
    if (shown) {
      st.pct = 100; st.finished = true; paint();
      await new Promise((res) => setTimeout(res, Math.max(600, 900 - (Date.now() - shownAt))));
      setTransferUi?.(null);
    }
    return r;
  } catch (e) { stop(); if (shown) setTransferUi?.(null); throw e; }
}

/** Lê um ficheiro escolhido pelo utilizador com progresso REAL (onprogress). */
export function readFileProgress(file: File, mode: 'dataURL' | 'text' = 'dataURL'): Promise<string> {
  return runTransfer<string>({
    title: 'A carregar ficheiro', kind: 'upload', file: `${file.name} · ${fmtBytes(file.size)}`,
    task: (ctl) => new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onprogress = (e) => { if (e.lengthComputable) ctl.setPct((e.loaded / e.total) * 100, `${fmtBytes(e.loaded)} de ${fmtBytes(e.total)}`); };
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Não foi possível ler o ficheiro.'));
      if (mode === 'text') r.readAsText(file); else r.readAsDataURL(file);
    }),
  });
}

/** Grava um Blob no disco (descarregamento). */
function saveBlobToDisk(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Descarrega um ficheiro produzido por `make` (pedido à API, geração local…) com o ecrã de progresso. */
export function runDownload(opts: { title: string; fileName: string; make: (ctl: TransferCtl) => Promise<Blob | { blob: Blob; fileName?: string }> }): Promise<void> {
  return runTransfer<void>({
    title: opts.title, kind: 'download', file: opts.fileName,
    task: async (ctl) => {
      const out = await opts.make(ctl);
      const blob = out instanceof Blob ? out : out.blob;
      const name = out instanceof Blob ? opts.fileName : (out.fileName || opts.fileName);
      ctl.setPct(97, `${fmtBytes(blob.size)} · a guardar`);
      saveBlobToDisk(blob, name);
    },
  });
}

function TransferProgress({ s }: { s: TransferState }) {
  const pct = Math.round(s.pct);
  const label = s.finished ? 'Concluído' : s.title;
  const ic = s.kind === 'upload' ? 'M12 19V6M6.5 11.5 12 6l5.5 5.5M5 20h14' : s.kind === 'download' ? 'M12 5v13M6.5 12.5 12 18l5.5-5.5M5 4h14' : 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14h6M9 17h4';
  return (
    <div className="fb-confirm-bg" role="dialog" aria-modal="true" aria-label={label}>
      <div className="fb-confirm fb-bulk fb-xfer">
        <div className={`fb-bulk-ring${s.finished ? ' ok' : ''}`} style={{ ['--p' as string]: pct }}>
          <span>{s.finished
            ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            : `${pct}%`}</span>
        </div>
        <h4>{label}</h4>
        {s.file ? (
          <div className="fb-xfer-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={ic} /></svg>
            <span>{s.file}</span>
          </div>
        ) : null}
        <p aria-live="polite">{s.finished ? (s.kind === 'upload' ? 'Ficheiro carregado' : s.kind === 'download' ? 'Ficheiro guardado' : 'Ficheiro pronto') : (s.detail || (s.kind === 'upload' ? 'A enviar…' : s.kind === 'download' ? 'A preparar o ficheiro…' : 'A gerar…'))}</p>
        <div className="fb-bulk-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        {!s.finished ? <small className="fb-bulk-hint">Não feche esta janela.</small> : null}
      </div>
    </div>
  );
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
/** Frases longas precisam de mais tempo para se ler: ~65 ms por carácter, entre 4,6 s e 12 s. */
const toastMs = (text: string) => Math.min(12_000, Math.max(TOAST_MS, text.length * 65));

/** Montar UMA vez (no App). Aloja os toasts e o diálogo de confirmação. */
export function FeedbackHost() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [bulk, setBulk] = useState<BulkState | null>(null);
  const [xfer, setXfer] = useState<TransferState | null>(null);

  useEffect(() => {
    pushToast = (kind, text) => {
      const id = seq++;
      const ms = toastMs(text);
      setToasts((p) => [...p.slice(-4), { id, kind, text }]);
      window.setTimeout(() => setToasts((p) => p.map((t) => (t.id === id ? { ...t, leaving: true } : t))), ms - 300);
      window.setTimeout(() => setToasts((p) => p.filter((t) => t.id !== id)), ms);
    };
    openConfirm = (c) => setConfirm(c);
    setBulkUi = (s) => setBulk(s);
    setTransferUi = (s) => setXfer(s);
    return () => { pushToast = null; openConfirm = null; setBulkUi = null; setTransferUi = null; };
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
      {xfer ? <TransferProgress s={xfer} /> : null}
    </>
  );
}
