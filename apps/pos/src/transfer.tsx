import React, { useEffect, useState } from 'react';
import { LOGO_ROUND } from './brand';

/**
 * Progresso de UPLOAD / DOWNLOAD / GERAÇÃO de ficheiros — o mesmo ecrã (anel com %,
 * nome do ficheiro e barra) usado em todo o sistema. Só aparece se demorar >250 ms;
 * sem % real avança suavemente até ~92% e salta para 100% ao terminar.
 */
type Kind = 'upload' | 'download' | 'generate';
interface State { title: string; kind: Kind; file?: string; pct: number; detail?: string; finished: boolean }
let setUi: ((s: State | null) => void) | null = null;
export interface TransferCtl { setPct(n: number, detail?: string): void }
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export async function runTransfer<T>(opts: { title: string; kind?: Kind; file?: string; task: (ctl: TransferCtl) => Promise<T> }): Promise<T> {
  const st: State = { title: opts.title, kind: opts.kind ?? 'generate', file: opts.file, pct: 0, finished: false };
  let shown = false; let real = false; let shownAt = 0;
  const paint = () => { if (shown) setUi?.({ ...st }); };
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
      setUi?.(null);
    }
    return r;
  } catch (e) { stop(); if (shown) setUi?.(null); throw e; }
}

/** Lê um ficheiro escolhido pelo utilizador com progresso REAL. */
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

/** Montar UMA vez (main.tsx), ao lado da App. */
export function TransferHost() {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => { setUi = setS; return () => { setUi = null; }; }, []);
  if (!s) return null;
  const pct = Math.round(s.pct);
  // Círculo de processamento ÚNICO do sistema (logótipo + anel), com a
  // percentagem real por baixo — substitui o antigo anel com barra.
  return (
    <div className="vproc-bg" role="dialog" aria-modal="true" aria-label={s.title}>
      <div className="vproc">
        <div className="vproc-ring"><img src={LOGO_ROUND} alt="" /><i /><b /></div>
        <span>{s.finished ? 'Concluído' : s.title}{!s.finished ? ` · ${pct}%` : ''}</span>
        {s.file ? <small className="vproc-sub">{s.file}</small> : null}
        {s.detail && !s.finished ? <small className="vproc-sub">{s.detail}</small> : null}
      </div>
    </div>
  );}
