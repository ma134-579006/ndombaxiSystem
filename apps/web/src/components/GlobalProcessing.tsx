import { useEffect, useRef, useState } from 'react';
import { LOGO_ROUND } from '../brand';
import type { BusyKind } from '../api/client';

const LABEL: Record<BusyKind, string> = {
  save: 'A guardar…',
  delete: 'A eliminar…',
  process: 'A processar…',
  login: 'A entrar…',
};

/**
 * Círculo de PROCESSAMENTO global (padrão de referência): aparece quando uma
 * operação de escrita do utilizador demora mais de 350ms — guardar, criar,
 * eliminar, emitir, entrar — na landing, no admin e no super admin. Some assim
 * que a última operação termina. Montado uma vez na raiz da app.
 */
export function GlobalProcessing() {
  const [count, setCount] = useState(0);
  const [kind, setKind] = useState<BusyKind>('process');
  const [shown, setShown] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    const onBusy = (e: Event) => {
      const d = (e as CustomEvent<{ delta: 1 | -1; kind: BusyKind }>).detail;
      if (d.delta > 0) setKind(d.kind);
      setCount((c) => Math.max(0, c + d.delta));
    };
    window.addEventListener('nx:busy', onBusy);
    return () => window.removeEventListener('nx:busy', onBusy);
  }, []);

  useEffect(() => {
    if (count > 0 && !shown && timer.current == null) {
      timer.current = window.setTimeout(() => { timer.current = null; setShown(true); }, 350);
    }
    if (count === 0) {
      if (timer.current != null) { window.clearTimeout(timer.current); timer.current = null; }
      setShown(false);
    }
  }, [count, shown]);

  if (!shown) return null;
  return (
    <div className="vproc-bg" role="status" aria-live="polite">
      <div className="vproc">
        <div className="vproc-ring"><img src={LOGO_ROUND} alt="" /><i /><b /></div>
        <span>{LABEL[kind]}</span>
      </div>
    </div>
  );
}
