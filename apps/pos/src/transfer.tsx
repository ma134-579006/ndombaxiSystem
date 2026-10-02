import React, { useEffect, useState } from 'react';

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

const PATHS: Record<Kind, string> = {
  upload: 'M12 19V6M6.5 11.5 12 6l5.5 5.5M5 20h14',
  download: 'M12 5v13M6.5 12.5 12 18l5.5-5.5M5 4h14',
  generate: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 14h6M9 17h4',
};

/** Montar UMA vez (main.tsx), ao lado da App. */
export function TransferHost() {
  const [s, setS] = useState<State | null>(null);
  useEffect(() => { setUi = setS; return () => { setUi = null; }; }, []);
  if (!s) return null;
  const pct = Math.round(s.pct);
  return (
    <div className="xf-bg" role="dialog" aria-modal="true" aria-label={s.title}>
      <div className="xf-box">
        <div className={`xf-ring${s.finished ? ' ok' : ''}`} style={{ ['--p' as string]: pct }}>
          <span>{s.finished
            ? <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
            : `${pct}%`}</span>
        </div>
        <h4>{s.finished ? 'Concluído' : s.title}</h4>
        {s.file ? (
          <div className="xf-file">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={PATHS[s.kind]} /></svg>
            <span>{s.file}</span>
          </div>
        ) : null}
        <p aria-live="polite">{s.finished ? (s.kind === 'upload' ? 'Ficheiro carregado' : s.kind === 'download' ? 'Ficheiro guardado' : 'Ficheiro pronto') : (s.detail || (s.kind === 'upload' ? 'A enviar…' : s.kind === 'download' ? 'A preparar o ficheiro…' : 'A gerar…'))}</p>
        <div className="xf-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}><i style={{ width: `${pct}%` }} /></div>
        {!s.finished ? <small>Não feche esta janela.</small> : null}
      </div>
    </div>
  );
}
