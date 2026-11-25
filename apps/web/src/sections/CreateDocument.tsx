import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { CustomerRow, ManagerProduct } from '../api/types';
import { formatKz } from '../format';
import { invoicePdf } from '../components/InvoiceShare';
import { confirmDialog, toast } from '../components/feedback';

/**
 * Criar Documento (como no Vendus: Documentos → Criar Documento). Emite uma
 * Fatura (FT, a pagar até ao vencimento) ou uma Fatura-Recibo (FS, paga no ato)
 * diretamente no painel, sem abrir a Caixa. A emissão é a mesma da Caixa
 * (POST /pos/invoices): hash AGT, série, stock e conta corrente do cliente.
 */
type DocKind = 'FS' | 'FT';
type Pay = 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS';
interface Line { product: ManagerProduct; quantity: number; discountPct: number }

const IVA: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, OUT: 0 };
const PAY_LABEL: Record<Pay, string> = { CASH: 'Numerário', CARD: 'Multicaixa (TPA)', TRANSFER: 'Transferência', REFERENCE: 'Referência', EXPRESS: 'Multicaixa Express' };
const plusDays = (n: number) => { const d = new Date(Date.now() + n * 864e5); return d.toISOString().slice(0, 10); };
const r2 = (n: number) => Math.round(n * 100) / 100;

export function CreateDocument({ onDone }: { onDone?: () => void }) {
  const [kind, setKind] = useState<DocKind>('FS');
  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [custQ, setCustQ] = useState('');
  const [custList, setCustList] = useState<CustomerRow[]>([]);
  const [prodQ, setProdQ] = useState('');
  const [prodList, setProdList] = useState<ManagerProduct[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [pay, setPay] = useState<Pay>('CASH');
  const [due, setDue] = useState(plusDays(30));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<{ id: string; number: string; total: number } | null>(null);
  const opId = useRef<string>(crypto.randomUUID());

  // Pesquisa no servidor (catálogos e carteiras grandes: nunca a lista inteira).
  useEffect(() => {
    const q = custQ.trim(); if (q.length < 2) { setCustList([]); return; }
    const t = window.setTimeout(() => { api.customers.list({ q, limit: 8 }).then(setCustList).catch(() => setCustList([])); }, 250);
    return () => window.clearTimeout(t);
  }, [custQ]);
  useEffect(() => {
    const q = prodQ.trim(); if (q.length < 1) { setProdList([]); return; }
    const t = window.setTimeout(() => {
      api.products.list({ q, limit: 10 }).then((r) => setProdList(r.filter((p) => (p as { is_active?: boolean }).is_active !== false))).catch(() => setProdList([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [prodQ]);

  const add = (p: ManagerProduct) => {
    setLines((ls) => { const i = ls.findIndex((l) => l.product.id === p.id); if (i >= 0) { const n = [...ls]; n[i] = { ...n[i], quantity: n[i].quantity + 1 }; return n; } return [...ls, { product: p, quantity: 1, discountPct: 0 }]; });
    setProdQ(''); setProdList([]);
  };
  const totals = useMemo(() => {
    let net = 0, iva = 0;
    for (const l of lines) {
      const base = Number(l.product.unit_price) * l.quantity * (1 - l.discountPct / 100);
      net += base; iva += base * (IVA[l.product.iva_code] ?? 0) / 100;
    }
    return { net: r2(net), iva: r2(iva), gross: r2(net + iva) };
  }, [lines]);

  const emit = async () => {
    setErr(null);
    if (!lines.length) { setErr('Acrescente pelo menos um artigo.'); return; }
    if (lines.some((l) => !(l.quantity > 0))) { setErr('Há linhas com quantidade inválida.'); return; }
    if (kind === 'FT' && !customer) { setErr('A Fatura (a pagar depois) precisa de um cliente identificado.'); return; }
    const label = kind === 'FT' ? 'Fatura' : 'Fatura-Recibo';
    if (!(await confirmDialog({ title: `Emitir ${label}?`, message: `${label} de ${formatKz(totals.gross)} para ${customer?.name ?? 'Consumidor final'}. Depois de emitido, o documento é comunicado à AGT e não pode ser apagado (só anulado).`, confirmLabel: 'Emitir' }))) return;
    setBusy(true);
    try {
      const r = await api.invoices.emit({
        docType: kind, // FS = Fatura-Recibo (pago no ato); FT = Fatura (a crédito, com vencimento).
        customerId: customer?.id,
        paymentType: kind === 'FT' ? 'CREDIT' : pay,
        ...(kind === 'FT' ? { dueDate: due } : {}),
        clientOpId: opId.current,
        lines: lines.map((l) => ({ productCode: l.product.code, quantity: l.quantity, ...(l.discountPct > 0 ? { discountRate: Math.min(0.9999, l.discountPct / 100) } : {}) })),
      });
      setDone({ id: r.id, number: r.number, total: Number(r.grossTotal ?? totals.gross) });
      toast.success(`${label} ${r.number} emitida.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Não foi possível emitir o documento.');
    } finally { setBusy(false); }
  };
  const novo = () => { setDone(null); setLines([]); setCustomer(null); setCustQ(''); setErr(null); opId.current = crypto.randomUUID(); };

  if (done) {
    return (
      <div className="vd-card cd-done">
        <h3>Documento emitido</h3>
        <p className="cd-big">{done.number}</p>
        <p className="muted">Total {formatKz(done.total)} · {customer?.name ?? 'Consumidor final'}</p>
        <div className="cd-actions">
          <button className="vd-btn" onClick={() => void invoicePdf(done.id)}>Imprimir / PDF</button>
          <button className="vd-btn ghost" onClick={novo}>Criar outro documento</button>
          {onDone ? <button className="vd-btn ghost" onClick={onDone}>Ver documentos</button> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="cd-grid">
      <section className="vd-card cd-main">
        <p className="vd-sect">Tipo de documento</p>
        <div className="cd-kinds" role="radiogroup" aria-label="Tipo de documento">
          <button role="radio" aria-checked={kind === 'FS'} className={kind === 'FS' ? 'on' : ''} onClick={() => setKind('FS')}><b>Fatura-Recibo</b><small>Pago no momento</small></button>
          <button role="radio" aria-checked={kind === 'FT'} className={kind === 'FT' ? 'on' : ''} onClick={() => setKind('FT')}><b>Fatura</b><small>A pagar até ao vencimento</small></button>
        </div>

        <p className="vd-sect">Cliente</p>
        {customer ? (
          <div className="cd-chip"><span><b>{customer.name}</b>{customer.tax_id ? <small>NIF {customer.tax_id}</small> : null}</span><button type="button" onClick={() => setCustomer(null)} aria-label="Remover cliente">×</button></div>
        ) : (
          <div className="cd-search">
            <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Consumidor final — ou pesquise por nome, NIF ou telefone" aria-label="Cliente" />
            {custList.length ? <ul className="cd-drop">{custList.map((c) => <li key={c.id}><button type="button" onClick={() => { setCustomer(c); setCustQ(''); setCustList([]); }}><b>{c.name}</b>{c.tax_id ? <small>NIF {c.tax_id}</small> : null}</button></li>)}</ul> : null}
          </div>
        )}

        <p className="vd-sect">Artigos</p>
        <div className="cd-search">
          <input value={prodQ} onChange={(e) => setProdQ(e.target.value)} placeholder="Pesquisar artigo por nome, código ou código de barras" aria-label="Artigo" />
          {prodList.length ? <ul className="cd-drop">{prodList.map((p) => <li key={p.id}><button type="button" onClick={() => add(p)}><b>{p.name}</b><small>{p.code} · {formatKz(Number(p.unit_price))} s/ IVA</small></button></li>)}</ul> : null}
        </div>
        {lines.length ? (
          <ul className="cd-lines">
            {lines.map((l, i) => (
              <li key={l.product.id}>
                <span className="nm"><b>{l.product.name}</b><small>{l.product.code} · IVA {IVA[l.product.iva_code] ?? 0}%</small></span>
                <label><span>Qtd.</span><input type="number" min={0.001} step="any" inputMode="decimal" value={l.quantity} onChange={(e) => { const v = Number(e.target.value); setLines((ls) => ls.map((x, j) => (j === i ? { ...x, quantity: v } : x))); }} /></label>
                <label><span>Desc. %</span><input type="number" min={0} max={99} step="any" inputMode="decimal" value={l.discountPct} onChange={(e) => { const v = Math.max(0, Math.min(99, Number(e.target.value) || 0)); setLines((ls) => ls.map((x, j) => (j === i ? { ...x, discountPct: v } : x))); }} /></label>
                <button type="button" className="rm" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label={`Remover ${l.product.name}`}>×</button>
              </li>
            ))}
          </ul>
        ) : <p className="muted cd-empty">Ainda sem artigos.</p>}
      </section>

      <aside className="vd-card cd-side" aria-label="Resumo">
        <p className="vd-sect">Resumo</p>
        <dl className="cd-tot">
          <div><dt>Ilíquido</dt><dd>{formatKz(totals.net)}</dd></div>
          <div><dt>IVA</dt><dd>{formatKz(totals.iva)}</dd></div>
          <div className="g"><dt>Total</dt><dd>{formatKz(totals.gross)}</dd></div>
        </dl>
        {kind === 'FS' ? (
          <label className="vd-f"><span>Pagamento</span><select value={pay} onChange={(e) => setPay(e.target.value as Pay)}>
            {(Object.keys(PAY_LABEL) as Pay[]).map((k) => <option key={k} value={k}>{PAY_LABEL[k]}</option>)}
          </select></label>
        ) : (
          <label className="vd-f"><span>Vencimento</span><input type="date" value={due} min={plusDays(0)} onChange={(e) => setDue(e.target.value)} /></label>
        )}
        {err ? <div className="banner danger" role="alert">{err}</div> : null}
        <button className="vd-btn block" disabled={busy || !lines.length} onClick={() => void emit()}>{busy ? 'A emitir…' : 'Emitir documento'}</button>
        <p className="muted cd-note">O total final é calculado pelo servidor (promoções, grupo de preço do cliente e arredondamentos AGT).</p>
      </aside>
    </div>
  );
}
