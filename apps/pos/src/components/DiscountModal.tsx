import React, { useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatKz, parseKz } from '../format';
import { KeyboardInput } from '../keyboard/KeyboardInput';
import { IconClose } from './Icons';

/** Papéis que dão desconto manual sem pedir o PIN de outra pessoa. */
const SELF_APPROVE = new Set(['COMPANY_ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'SHIFT_SUPERVISOR']);

/**
 * Desconto manual num artigo do carrinho. Em percentagem ou em valor (Kz).
 * Um caixa precisa do PIN de um supervisor/gerente; a aprovação vale para o
 * resto desta venda e o servidor volta a confirmá-la ao emitir (e audita).
 */
export function DiscountModal({ name, lineGross, current, promoRate, role, approvedBy, onApply, onClose }: {
  name: string;
  /** Total da linha antes de descontos (com IVA). */
  lineGross: number;
  /** Desconto manual atual (fração). */
  current: number;
  /** Desconto da promoção já aplicado (fração) — o manual tem de o ultrapassar. */
  promoRate: number;
  role?: string | null;
  approvedBy: string | null;
  onApply(rate: number, approval?: { pin: string; name: string }): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<'PCT' | 'KZ'>('PCT');
  const [value, setValue] = useState(current > 0 ? String(Math.round(current * 10000) / 100).replace('.', ',') : '');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needPin = !SELF_APPROVE.has(role ?? '') && !approvedBy;

  const n = parseKz(value) || 0;
  const rate = mode === 'PCT' ? n / 100 : lineGross > 0 ? n / lineGross : 0;
  const after = Math.max(0, lineGross * (1 - rate));

  const apply = async () => {
    setError(null);
    if (rate <= 0) { onApply(0); return; }
    if (rate >= 1) { setError('O desconto não pode ser de 100 % ou mais.'); return; }
    if (rate <= promoRate + 0.005) { setError('A promoção deste artigo já dá esse desconto (ou mais).'); return; }
    if (!needPin) { onApply(Math.round(rate * 10000) / 10000); return; }
    if (pin.trim().length < 4) { setError('Peça ao supervisor ou gerente para escrever o PIN dele.'); return; }
    setBusy(true);
    try {
      const r = await api.approveDiscount(pin.trim());
      onApply(Math.round(rate * 10000) / 10000, { pin: pin.trim(), name: r.approverName });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Sem ligação: o desconto manual precisa de rede para ser aprovado.');
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, padding: 22 }}>
        <div className="row" style={{ marginBottom: 6 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Desconto no artigo</h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose} aria-label="Fechar"><IconClose size={22} /></button>
        </div>
        <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{name} · {formatKz(lineGross)}</p>
        {error ? <div className="banner danger" style={{ marginBottom: 12 }}>{error}</div> : null}
        <div className="seg" role="tablist" style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <button className={`btn ${mode === 'PCT' ? '' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('PCT')}>Percentagem (%)</button>
          <button className={`btn ${mode === 'KZ' ? '' : 'ghost'}`} style={{ flex: 1 }} onClick={() => setMode('KZ')}>Valor (Kz)</button>
        </div>
        <KeyboardInput label={mode === 'PCT' ? 'Desconto (%)' : 'Desconto (Kz)'} value={value} onChange={setValue} numeric placeholder="0" onSubmit={apply} autoFocus />
        <div className="kv" style={{ marginTop: 8 }}>
          <span className="k">Fica a pagar</span>
          <span className="v" style={{ fontWeight: 800 }}>{formatKz(after)}{rate > 0 ? ` (−${(Math.round(rate * 1000) / 10).toLocaleString('pt-PT')} %)` : ''}</span>
        </div>
        {needPin ? (
          <KeyboardInput label="PIN do supervisor ou gerente" value={pin} onChange={setPin} type="password" numeric placeholder="••••" onSubmit={apply} />
        ) : approvedBy ? (
          <p className="muted" style={{ fontSize: 12.5 }}>Aprovado por {approvedBy} para esta venda.</p>
        ) : null}
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          {current > 0 ? <button className="btn ghost lg" style={{ flex: 1 }} onClick={() => onApply(0)}>Remover</button> : null}
          <button className="btn success lg" style={{ flex: 2 }} onClick={() => void apply()} disabled={busy}>
            {busy ? 'A confirmar…' : 'Aplicar desconto'}
          </button>
        </div>
      </div>
    </div>
  );
}
