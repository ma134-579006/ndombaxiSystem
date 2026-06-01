import React, { useState } from 'react';
import { IconBackspace, IconCheck, IconShift } from '../components/Icons';

export type KeyboardLayout = 'text' | 'numeric';

interface Props {
  layout: KeyboardLayout;
  submitLabel?: string;
  onInsert(ch: string): void;
  onBackspace(): void;
  onClear(): void;
  onSubmit(): void;
  onHide(): void;
}

const LETTER_ROWS = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];
const SYMBOL_ROWS = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['@', '#', '€', '_', '&', '-', '+', '(', ')', '/'],
  ['*', '"', "'", ':', ';', '!', '?'],
];
const NUMERIC_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
];

/**
 * Teclado no ecrã (QWERTY/símbolos ou numérico) para PCs/terminais táteis.
 * Componente controlado: comunica as teclas através das callbacks.
 * Usa onMouseDown + preventDefault para NÃO roubar o foco ao campo activo.
 */
export function VirtualKeyboard({
  layout,
  submitLabel = 'OK',
  onInsert,
  onBackspace,
  onClear,
  onSubmit,
  onHide,
}: Props) {
  const [mode, setMode] = useState<'letters' | 'symbols'>('letters');
  const [shift, setShift] = useState(false);

  const press = (fn: () => void) => (e: React.MouseEvent) => {
    e.preventDefault();
    fn();
  };

  const Bar = (
    <div className="kbd-bar">
      <span className="lbl">Teclado no ecrã</span>
      <div className="acts">
        <button type="button" onMouseDown={press(onClear)}>Limpar</button>
        <button type="button" onMouseDown={press(onHide)}>Esconder ▾</button>
      </div>
    </div>
  );

  if (layout === 'numeric') {
    return (
      <div className="kbd">
        {Bar}
        {NUMERIC_ROWS.map((row) => (
          <div className="kbd-row" key={row.join()}>
            {row.map((ch) => (
              <button type="button" className="key" key={ch} onMouseDown={press(() => onInsert(ch))}>{ch}</button>
            ))}
          </div>
        ))}
        <div className="kbd-row">
          <button type="button" className="key" onMouseDown={press(() => onInsert('.'))}>.</button>
          <button type="button" className="key" onMouseDown={press(() => onInsert('0'))}>0</button>
          <button type="button" className="key action" onMouseDown={press(onBackspace)}><IconBackspace size={22} /></button>
        </div>
        <div className="kbd-row">
          <button type="button" className="key accent" onMouseDown={press(onSubmit)}>{submitLabel}</button>
        </div>
      </div>
    );
  }

  const rows = mode === 'letters' ? LETTER_ROWS : SYMBOL_ROWS;
  const disp = (ch: string) => (mode === 'letters' && shift ? ch.toUpperCase() : ch);

  return (
    <div className="kbd">
      {Bar}
      <div className="kbd-row">
        {rows[0].map((ch) => (
          <button type="button" className="key" key={ch} onMouseDown={press(() => onInsert(disp(ch)))}>{disp(ch)}</button>
        ))}
      </div>
      <div className="kbd-row">
        {rows[1].map((ch) => (
          <button type="button" className="key" key={ch} onMouseDown={press(() => onInsert(disp(ch)))}>{disp(ch)}</button>
        ))}
      </div>
      <div className="kbd-row">
        {mode === 'letters' ? (
          <button type="button" className={`key wide-15 ${shift ? 'accent' : 'action'}`} onMouseDown={press(() => setShift((s) => !s))}>
            <IconShift size={20} />
          </button>
        ) : (
          <span className="key wide-15" style={{ visibility: 'hidden' }} />
        )}
        {rows[2].map((ch) => (
          <button type="button" className="key" key={ch} onMouseDown={press(() => onInsert(disp(ch)))}>{disp(ch)}</button>
        ))}
        <button type="button" className="key action wide-15" onMouseDown={press(onBackspace)}><IconBackspace size={22} /></button>
      </div>
      <div className="kbd-row">
        <button type="button" className="key action wide-16" onMouseDown={press(() => setMode((m) => (m === 'letters' ? 'symbols' : 'letters')))}>
          {mode === 'letters' ? '?123' : 'ABC'}
        </button>
        <button type="button" className="key" onMouseDown={press(() => onInsert(','))}>,</button>
        <button type="button" className="key wide-4" onMouseDown={press(() => onInsert(' '))}>espaço</button>
        <button type="button" className="key" onMouseDown={press(() => onInsert('.'))}>.</button>
        <button type="button" className="key accent wide-16" onMouseDown={press(onSubmit)}><IconCheck size={20} /></button>
      </div>
    </div>
  );
}
