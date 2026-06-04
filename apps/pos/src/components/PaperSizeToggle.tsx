import React, { useState } from 'react';
import { PAPER_WIDTHS, getPaper, setPaper, type PaperWidth } from '../print';

/** Seletor da largura do papel térmico (80/58mm), por dispositivo. */
export function PaperSizeToggle() {
  const [w, setW] = useState<PaperWidth>(getPaper());
  const pick = (id: PaperWidth) => { setPaper(id); setW(id); };
  return (
    <div className="paper-toggle no-print" title="Largura da impressora térmica">
      <span className="lbl">Papel</span>
      {PAPER_WIDTHS.map((p) => (
        <button key={p.id} type="button" className={`chip${w === p.id ? ' on' : ''}`} onClick={() => pick(p.id)}>
          {p.label}
        </button>
      ))}
    </div>
  );
}
