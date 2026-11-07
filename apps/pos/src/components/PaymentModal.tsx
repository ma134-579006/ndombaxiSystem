import React, { useMemo, useState } from 'react';
import type { PaymentType } from '../api/types';
import { formatKz, parseKz } from '../format';
import { KeyboardInput } from '../keyboard/KeyboardInput';

interface Line { name: string; qty: number; gross: number }

interface Props {
  total: number;
  /** Nome do cliente selecionado (obrigatório para venda a crédito). */
  customerName?: string | null;
  /** Medicamentos do carrinho sujeitos a receita (pede o nº da receita). */
  prescriptionItems?: string[];
  /** Linhas da venda (resumo à direita, como na referência). */
  lines?: Line[];
  /** Lápis do Cliente: abre a escolha de cliente. */
  onEditCustomer?(): void;
  onConfirm(p: { paymentType: PaymentType; tendered?: number; changeGiven?: number; prescriptionRef?: string; payments?: { type: Exclude<PaymentType, 'CREDIT'>; amount: number }[] }): void;
  onClose(): void;
  busy?: boolean;
}

const METHODS: { type: PaymentType; label: string }[] = [
  { type: 'CASH', label: 'Numerário' },
  { type: 'CARD', label: 'Multicaixa (TPA)' },
  { type: 'TRANSFER', label: 'Transferência Bancária' },
  { type: 'REFERENCE', label: 'Referência' },
  { type: 'EXPRESS', label: 'Multicaixa Express' },
  { type: 'CREDIT', label: 'Conta Corrente (a crédito)' },
];

const Pencil = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.7-10.2a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.83-1.83z" />
  </svg>
);

/**
 * Finalização no padrão do POS de referência: linhas Total / Cliente /
 * Pagamento (cada uma com lápis), "Mais opções", valor entregue + troco e
 * EMITIR DOCUMENTO; à direita, o resumo escuro da venda e Fechar.
 * As REGRAS são as de sempre: sem pagamento a menos em numerário, crédito só
 * com cliente, receita obrigatória para medicamentos sujeitos, misto válido.
 */
export function PaymentModal({ total, customerName, prescriptionItems = [], lines = [], onEditCustomer, onConfirm, onClose, busy }: Props) {
  const [type, setType] = useState<PaymentType>('CASH');
  const [tendered, setTendered] = useState('');
  const [rxRef, setRxRef] = useState('');
  const [view, setView] = useState<'main' | 'method'>('main');
  const [more, setMore] = useState(prescriptionItems.length > 0);
  const [quickOpen, setQuickOpen] = useState(false);
  // PAGAMENTO MISTO: parte em numerário + o resto noutro meio (TPA, transferência…).
  const [mixed, setMixed] = useState(false);
  const [mixCash, setMixCash] = useState('');
  const [mixOther, setMixOther] = useState<Exclude<PaymentType, 'CREDIT' | 'CASH'>>('CARD');
  const mixCashNum = Math.min(total, Math.max(0, parseKz(mixCash) || 0));
  const mixRest = Math.round((total - mixCashNum) * 100) / 100;
  const mixInvalid = mixed && (!(mixCashNum > 0) || !(mixRest > 0));
  const rxMissing = prescriptionItems.length > 0 && !rxRef.trim();

  const tenderedNum = parseKz(tendered) || 0;
  const change = useMemo(() => Math.max(0, tenderedNum - total), [tenderedNum, total]);
  const insufficient = type === 'CASH' && !mixed && tendered !== '' && tenderedNum < total;
  const creditNoCustomer = type === 'CREDIT' && !customerName;

  // Atalhos: o valor exato e as próximas notas/valores redondos ACIMA do total.
  const quick = (() => {
    const out = [total];
    for (const step of [500, 1000, 2000, 5000, 10000, 20000, 50000]) {
      const v = Math.ceil(total / step) * step;
      if (v > total && !out.includes(v)) out.push(v);
      if (out.length >= 5) break;
    }
    return out;
  })();

  const blocked = busy || (!mixed && (insufficient || creditNoCustomer)) || rxMissing || mixInvalid;
  const confirm = () => {
    // GUARDA: o Enter do teclado chama confirm() diretamente — bloqueia aqui também
    // (antes contornava o botão desativado e emitia com pagamento a menos).
    if (blocked) return;
    const rx = prescriptionItems.length ? { prescriptionRef: rxRef.trim() } : {};
    if (mixed) {
      onConfirm({ paymentType: 'CASH', tendered: mixCashNum, changeGiven: 0, payments: [{ type: 'CASH', amount: mixCashNum }, { type: mixOther, amount: mixRest }], ...rx });
      return;
    }
    if (type === 'CASH') onConfirm({ paymentType: 'CASH', tendered: tenderedNum || total, changeGiven: change, ...rx });
    else onConfirm({ paymentType: type, ...rx });
  };

  const methodLabel = mixed
    ? `Misto (Numerário + ${METHODS.find((m) => m.type === mixOther)?.label})`
    : METHODS.find((m) => m.type === type)?.label;

  return (
    <div className="vfin-bg" role="dialog" aria-modal="true" aria-label="Finalizar venda">
      <div className="vfin">
        <div className="vfin-main">
          {view === 'method' ? (
            <div className="vfin-scroll vfin-in">
              <button className="vfin-back" onClick={() => setView('main')} aria-label="Voltar">←</button>
              <div className="vfin-row"><span>Pagamento</span><b>{methodLabel}</b><button className="vfin-edit" onClick={() => setView('main')} aria-label="Fechar escolha"><Pencil /></button></div>
              <div className="vfin-list" role="radiogroup" aria-label="Método de pagamento">
                {METHODS.map((m) => {
                  const on = !mixed && type === m.type;
                  return (
                    <button key={m.type} role="radio" aria-checked={on} className={on ? 'on' : ''}
                      onClick={() => { setMixed(false); setType(m.type); setView('main'); }}>
                      <span className="rd" aria-hidden="true" />{m.label}
                    </button>
                  );
                })}
                <button role="radio" aria-checked={mixed} className={mixed ? 'on' : ''} onClick={() => { setMixed(true); setView('main'); setMore(true); }}>
                  <span className="rd" aria-hidden="true" />Misto (Numerário + outro)
                </button>
              </div>
            </div>
          ) : (
            <div className="vfin-scroll vfin-in">
              <div className="vfin-row"><span>Total</span><b>{formatKz(total)}</b><span className="vfin-edit ghost" /></div>
              <div className="vfin-row"><span>Cliente</span><b className={creditNoCustomer ? 'bad' : ''}>{customerName || 'Consumidor Final'}</b>
                <button className="vfin-edit" onClick={onEditCustomer} disabled={!onEditCustomer} aria-label="Escolher cliente"><Pencil /></button></div>
              <div className="vfin-row"><span>Pagamento</span><b>{methodLabel}</b>
                <button className="vfin-edit" onClick={() => setView('method')} aria-label="Escolher método de pagamento"><Pencil /></button></div>
              <button className="vfin-more" onClick={() => setMore((v) => !v)} aria-expanded={more}>{more ? '▴' : '▾'} Mais Opções</button>
              {more ? (
                <div className="vfin-extra vfin-in">
                  {prescriptionItems.length ? (
                    <div className="vfin-field">
                      <KeyboardInput label={`Nº da receita médica (${prescriptionItems.join(', ')})`} value={rxRef} onChange={setRxRef} placeholder="Ex.: RX/2026/0012" />
                      {rxMissing ? <small className="bad">Medicamento sujeito a receita: indique o nº da receita.</small> : null}
                    </div>
                  ) : null}
                  {mixed ? (
                    <div className="vfin-field">
                      <KeyboardInput label="Parte em numerário (Kz)" value={mixCash} onChange={setMixCash} numeric placeholder="0" onSubmit={confirm} />
                      <div className="vfin-chips">
                        {METHODS.filter((m) => m.type !== 'CASH' && m.type !== 'CREDIT').map((m) => (
                          <button key={m.type} className={mixOther === m.type ? 'on' : ''} onClick={() => setMixOther(m.type as Exclude<PaymentType, 'CREDIT' | 'CASH'>)}>{m.label}</button>
                        ))}
                      </div>
                      <div className="vfin-row sm"><span>Restante</span><b className={mixInvalid ? 'bad' : ''}>{mixInvalid ? 'Indique a parte em numerário' : formatKz(mixRest)}</b><span className="vfin-edit ghost" /></div>
                    </div>
                  ) : null}
                  {type === 'CREDIT' && !mixed ? (
                    <div className="vfin-row sm"><span>Vencimento</span><b>{customerName ? '30 dias · Contas a Receber' : 'Selecione um cliente'}</b><span className="vfin-edit ghost" /></div>
                  ) : null}
                  {!prescriptionItems.length && !mixed && type !== 'CREDIT' ? <div className="vfin-row sm"><span>Observações</span><b>N/D</b><span className="vfin-edit ghost" /></div> : null}
                </div>
              ) : null}
            </div>
          )}

          <div className="vfin-foot">
            <div className={`vfin-cash${type !== 'CASH' || mixed ? ' off' : ''}${insufficient ? ' bad' : ''}`}>
              <span className="cur">Kz</span>
              <input inputMode="decimal" value={type === 'CASH' && !mixed ? tendered : ''} placeholder={String(total)} disabled={type !== 'CASH' || mixed}
                onChange={(e) => setTendered(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') confirm(); }} aria-label="Valor entregue" />
              <button className="calc" onClick={() => setQuickOpen((v) => !v)} disabled={type !== 'CASH' || mixed} aria-label="Valores rápidos" aria-expanded={quickOpen}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="4" y="2" width="16" height="20" rx="2" /><path d="M8 6h8M8 11h.01M12 11h.01M16 11h.01M8 15h.01M12 15h.01M16 15h.01M8 19h.01M12 19h4" /></svg>
              </button>
              <div className="troco"><b className={insufficient ? 'bad' : ''}>{insufficient ? 'Insuficiente' : formatKz(type === 'CASH' && !mixed ? change : 0)}</b><small>TROCO</small></div>
              {quickOpen && type === 'CASH' && !mixed ? (
                <div className="vfin-quick vfin-in">
                  {quick.map((v) => <button key={v} onClick={() => { setTendered(String(v)); setQuickOpen(false); }}>{formatKz(v)}</button>)}
                </div>
              ) : null}
            </div>
            <button className="vfin-emit" onClick={confirm} disabled={blocked}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h5" /></svg>
              {busy ? 'A EMITIR…' : 'EMITIR DOCUMENTO'}
            </button>
          </div>
        </div>

        <aside className="vfin-side">
          <div className="vfin-side-h"><span>Produto</span><span>Qtd</span><span>Preço</span></div>
          <div className="vfin-side-lines">
            {lines.map((l, i) => (
              <div key={i} className="vfin-side-l"><span title={l.name}>{l.name}</span><span>{l.qty.toLocaleString('pt-PT')}</span><span>{formatKz(l.gross)}</span></div>
            ))}
          </div>
          <button className="vfin-close" onClick={onClose} disabled={busy}>✕ Fechar</button>
        </aside>
      </div>
    </div>
  );
}
