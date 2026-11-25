import { toast } from '../components/feedback';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  SupplierRow, CreateSupplierInput, PurchaseOrderRow, PurchaseOrderLineInput,
  WarehouseRow, ManagerProduct, PayableSummary,
} from '../api/types';
import { Modal } from '../components/ui';
import { IconBuilding, IconCheck, IconPlus, IconReport, IconSearch, IconTrash, IconTruck } from '../components/Icons';
import { formatKz, formatDate } from '../format';

const PO_TONE: Record<string, string> = {
  DRAFT: 'var(--warning)', CONFIRMED: 'var(--primary)', RECEIVED: 'var(--success)', CANCELLED: 'var(--muted)',
};
const PO_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', CONFIRMED: 'Confirmada', RECEIVED: 'Recebida', CANCELLED: 'Cancelada',
};

/**
 * Compras no formato do Vendus (Gestão › Compras):
 *   • Fornecedores — caminho «Fornecedores / Listagem», Adicionar / Exportar, pesquisa,
 *     quadro «Dívidas a Fornecedores» (saldo, dívida corrente, dívida vencida) e tabela;
 *   • Encomendas — caminho «Encomendas / Listagem», Adicionar Encomenda, filtro por
 *     estado e tabela com Confirmar / Rececionar (rascunho → confirmada → entra em stock).
 *   As Faturas de fornecedores são a página «Contas a pagar» (secção payables).
 */
export function Purchasing({ view = 'orders', onGo }: { view?: 'orders' | 'suppliers'; onGo?: (s: string) => void } = {}) {
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [debts, setDebts] = useState<PayableSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState(false);
  const [newOrder, setNewOrder] = useState(false);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, w, p, o] = await Promise.all([
        api.purchasing.listSuppliers(),
        api.purchasing.warehouses(),
        api.products.list(),
        api.purchasing.listOrders(),
      ]);
      setSuppliers(s); setWarehouses(w); setProducts(p); setOrders(o); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally { setLoading(false); }
    api.payables.summary().then(setDebts).catch(() => setDebts(null));
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast.success(ok); await load(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Operação falhou.'); }
  };

  const term = q.trim().toLowerCase();
  const supList = suppliers.filter((x) => !term || `${x.name} ${x.nif ?? ''} ${x.code}`.toLowerCase().includes(term));
  const ordList = orders.filter((o) => {
    const d = String(o.order_date).slice(0, 10);
    return (!status || o.status === status) && (!from || d >= from) && (!to || d <= to)
      && (!term || `${o.number} ${o.supplier_name}`.toLowerCase().includes(term));
  });
  const clearFilters = () => { setQ(''); setStatus(''); setFrom(''); setTo(''); };
  const exportSuppliers = () => {
    const esc = (v: unknown) => { const t = String(v ?? ''); return /[";\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    const lines = suppliers.map((x) => [x.name, x.nif ?? '', x.phone ?? '', x.email ?? ''].map(esc).join(';'));
    const blob = new Blob(['﻿' + ['Nome;NIF;Telemóvel;E-mail', ...lines].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const el = document.createElement('a'); el.href = URL.createObjectURL(blob); el.download = 'fornecedores.csv'; el.click();
    setTimeout(() => URL.revokeObjectURL(el.href), 2000);
  };
  const isSup = view === 'suppliers';
  const current = Math.max(0, (debts?.outstanding ?? 0) - (debts?.overdue ?? 0));

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>{isSup ? 'Fornecedores' : 'Encomendas'}</span><span className="sep">/</span><span>Listagem</span></p>
        <span className="spacer" />
        {isSup ? (
          <>
            <button className="vd-btn" onClick={() => setNewSupplier(true)}><IconPlus size={16} /> Adicionar Fornecedor</button>
            <button className="vd-btn outline" onClick={exportSuppliers} disabled={suppliers.length === 0}>Exportar Fornecedores</button>
          </>
        ) : (
          <button className="vd-btn" onClick={() => setNewOrder(true)} disabled={suppliers.length === 0 || warehouses.length === 0}>
            <IconPlus size={16} /> Adicionar encomenda
          </button>
        )}
      </div>

      <form className="vd-card vd-filters" onSubmit={(e) => e.preventDefault()}>
        <div className="vd-frow" style={{ alignItems: 'center' }}>
          <label className="vd-f grow"><input className="vd-in" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={isSup ? 'Pesquisa por Nome ou NIF' : 'Pesquisa por Número ou Fornecedor'} aria-label="Pesquisar" /></label>
          {!isSup ? (
            <label className="vd-f"><select className="vd-in" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Estado">
              <option value="">Todas</option>
              {Object.entries(PO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          ) : null}
          {!isSup ? (
            <div className="vd-f pu-dates"><div className="vd-range">
              <span className="mid">Data</span>
              <input type="date" className="vd-in" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="De" />
              <span className="mid">até</span>
              <input type="date" className="vd-in" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Até" />
            </div></div>
          ) : null}
        </div>
        <div className="vd-frow">
          <button type="submit" className="vd-btn"><IconSearch size={15} /> Pesquisar</button>
          <button type="button" className="vd-btn outline" onClick={clearFilters}>✕ Limpar Filtro</button>
        </div>
      </form>

      {error ? <div className="vd-err" role="alert">{error}</div> : null}
      {!isSup && (suppliers.length === 0 || warehouses.length === 0) && !loading ? (
        <div className="vd-err" role="status">Para criar encomendas precisa de pelo menos um <strong>fornecedor</strong> e um <strong>armazém</strong>.</div>
      ) : null}

      {isSup ? (
        <section className="vd-card pu-debts" aria-label="Dívidas a Fornecedores">
          <div className="pu-debts-h"><span>Dívidas a Fornecedores</span>
            {onGo ? <button className="vd-btn pu-consult" onClick={() => onGo('payables')}><IconReport size={16} /> Consultar</button> : null}</div>
          <div className="pu-debts-b">
            <div><small>Saldo</small><b className={(debts?.outstanding ?? 0) > 0 ? 'neg' : 'ok'}>{formatKz(debts?.outstanding ?? 0)}</b><span>Valor que deve aos Fornecedores</span></div>
            <div><small>Dívida Corrente</small><b className={current > 0 ? 'neg' : 'ok'}>{formatKz(current)}</b><span>{current > 0 ? 'Pagamentos dentro do prazo' : 'Não existem pagamentos pendentes'}</span></div>
            <div><small>Dívida Vencida</small><b className={(debts?.overdue ?? 0) > 0 ? 'neg' : 'ok'}>{formatKz(debts?.overdue ?? 0)}</b><span>Valor que já deveria ter sido pago</span></div>
          </div>
        </section>
      ) : null}

      <div className="vd-card vd-tablecard">
        {loading ? <div className="vd-empty">A carregar…</div> : isSup ? (
          supList.length === 0 ? (term ? <div className="vd-empty">Sem resultados.</div> : (
            <div className="pu-noreg"><IconBuilding size={56} /><strong>Não existem registos</strong><span>Ainda não adicionou nenhum registo em Fornecedores?</span>
              <button className="vd-btn outline" onClick={() => setNewSupplier(true)}>Adicionar fornecedor</button></div>
          )) : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead><tr><th>Fornecedores</th><th>NIF</th><th>Telemóvel</th><th>E-mail</th><th>Código</th><th aria-label="Ações" /></tr></thead>
                <tbody>
                  {supList.map((x) => (
                    <tr key={x.id}>
                      <td><strong>{x.name}</strong>{x.address ? <span className="sub">{x.address}</span> : null}</td>
                      <td>{x.nif ?? '—'}</td><td>{x.phone ?? '—'}</td><td>{x.email ?? '—'}</td><td>{x.code}</td>
                      <td className="num">{warehouses.length > 0 ? <button className="vd-btn plain sm" onClick={() => setNewOrder(true)}>Encomendar</button> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          ordList.length === 0 ? (term || status || from || to ? <div className="vd-empty">Sem resultados.</div> : (
            <div className="pu-noreg"><IconTruck size={56} /><strong>Não existem registos</strong><span>Ainda não adicionou nenhum registo em Encomendas?</span>
              <button className="vd-btn outline" onClick={() => setNewOrder(true)} disabled={suppliers.length === 0 || warehouses.length === 0}>Adicionar encomenda</button></div>
          )) : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead><tr><th>Número</th><th>Fornecedor</th><th>Data</th><th>Data prevista</th><th className="num">Total</th><th>Estado</th><th aria-label="Ações" /></tr></thead>
                <tbody>
                  {ordList.map((o) => (
                    <tr key={o.id}>
                      <td><strong>{o.number}</strong></td>
                      <td>{o.supplier_name}</td>
                      <td>{formatDate(o.order_date)}</td>
                      <td>{o.expected_date ? formatDate(o.expected_date) : '—'}</td>
                      <td className="num">{formatKz(o.gross_total)}</td>
                      <td><span className="vd-tag" style={{ color: PO_TONE[o.status] ?? 'var(--muted)', borderColor: 'currentColor' }}>{PO_LABEL[o.status] ?? o.status}</span></td>
                      <td className="num">
                        {o.status === 'DRAFT' ? <button className="vd-btn outline sm" onClick={() => act(() => api.purchasing.confirmOrder(o.id), 'Encomenda confirmada.')}>Confirmar</button> : null}
                        {o.status === 'CONFIRMED' ? <button className="vd-btn sm" onClick={() => act(() => api.purchasing.receiveOrder(o.id), 'Encomenda rececionada — stock actualizado.')}><IconCheck size={14} /> Rececionar</button> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </div>

      {newSupplier ? <SupplierModal onClose={() => setNewSupplier(false)} onSaved={load} /> : null}
      {newOrder ? (
        <OrderModal
          suppliers={suppliers} warehouses={warehouses} products={products}
          onClose={() => setNewOrder(false)} onSaved={load}
        />
      ) : null}
    </div>
  );
}

function SupplierModal({ onClose, onSaved }: { onClose(): void; onSaved(): Promise<void> | void }) {
  const [f, setF] = useState<CreateSupplierInput>({ code: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    if (!f.code.trim() || !f.name.trim()) { setErr('Código e nome são obrigatórios.'); return; }
    setBusy(true); setErr(null);
    try { await api.purchasing.createSupplier(f); await onSaved(); onClose(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao gravar.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Novo fornecedor" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="grid-2">
        <div className="field"><label>Código *</label>
          <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="FORN-001" /></div>
        <div className="field"><label>Nome *</label>
          <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Distribuidora Lda" /></div>
        <div className="field"><label>NIF</label>
          <input value={f.nif ?? ''} onChange={(e) => setF({ ...f, nif: e.target.value })} /></div>
        <div className="field"><label>Telefone</label>
          <input value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      </div>
      <div className="field"><label>Email</label>
        <input value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="compras@fornecedor.ao" /></div>
      <div className="field"><label>Morada</label>
        <input value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
      <button className="btn lg block" style={{ marginTop: 6 }} onClick={submit} disabled={busy}>
        {busy ? 'A gravar…' : 'Criar fornecedor'}
      </button>
    </Modal>
  );
}

function OrderModal({
  suppliers, warehouses, products, onClose, onSaved,
}: {
  suppliers: SupplierRow[]; warehouses: WarehouseRow[]; products: ManagerProduct[];
  onClose(): void; onSaved(): Promise<void> | void;
}) {
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<PurchaseOrderLineInput[]>([]);
  const [pCode, setPCode] = useState(products[0]?.code ?? '');
  const [qty, setQty] = useState('1');
  const [cost, setCost] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const byCode = useMemo(() => new Map(products.map((p) => [p.code, p])), [products]);
  const netTotal = useMemo(() => lines.reduce((a, l) => a + l.quantity * l.unitCost, 0), [lines]);

  const pickProduct = (code: string) => {
    setPCode(code);
    const p = byCode.get(code);
    if (p && !cost) setCost(p.cost_price || '');
  };

  const addLine = () => {
    const p = byCode.get(pCode);
    if (!p) { setErr('Escolha um produto.'); return; }
    const q = Number(qty); const c = Number(cost);
    if (!(q > 0)) { setErr('Quantidade inválida.'); return; }
    if (!(c >= 0)) { setErr('Custo inválido.'); return; }
    setErr(null);
    setLines((prev) => {
      const i = prev.findIndex((l) => l.productCode === pCode);
      if (i >= 0) { const copy = [...prev]; copy[i] = { productCode: pCode, quantity: q, unitCost: c }; return copy; }
      return [...prev, { productCode: pCode, quantity: q, unitCost: c }];
    });
    setQty('1'); setCost('');
  };

  const submit = async () => {
    if (!supplierId || !warehouseId) { setErr('Escolha fornecedor e armazém.'); return; }
    if (lines.length === 0) { setErr('Adicione pelo menos uma linha.'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.purchasing.createOrder({
        supplierId, warehouseId,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        lines,
      });
      await onSaved();
      onClose();
      toast.success(`Encomenda ${r.number} criada (rascunho). Confirme e depois rececione para dar entrada em stock.`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao criar encomenda.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Nova encomenda de compra" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="grid-2">
        <div className="field"><label>Fornecedor *</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div className="field"><label>Armazém de entrada *</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (principal)' : ''}</option>)}
          </select></div>
        <div className="field"><label>Data prevista</label>
          <input type="date" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} /></div>
        <div className="field"><label>Notas</label>
          <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observações" /></div>
      </div>

      <h4 style={{ margin: '6px 0 8px' }}>Linhas</h4>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: '2 1 180px', marginBottom: 0 }}><label>Produto</label>
          <select value={pCode} onChange={(e) => pickProduct(e.target.value)}>
            {products.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.code})</option>)}
          </select></div>
        <div className="field" style={{ flex: '1 1 70px', marginBottom: 0 }}><label>Qtd</label>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
        <div className="field" style={{ flex: '1 1 110px', marginBottom: 0 }}><label>Custo unit. (Kz)</label>
          <input inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder="0" /></div>
        <button className="btn ghost" type="button" onClick={addLine}><IconPlus size={16} /> Add</button>
      </div>

      {lines.length > 0 ? (
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {lines.map((l) => {
            const p = byCode.get(l.productCode);
            return (
              <div key={l.productCode} className="list-row" style={{ padding: '8px 0' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{p?.name ?? l.productCode}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{l.quantity} × {formatKz(l.unitCost)}</div>
                </div>
                <strong>{formatKz(l.quantity * l.unitCost)}</strong>
                <button className="icon-btn" style={{ width: 32, height: 32 }} onClick={() => setLines((prev) => prev.filter((x) => x.productCode !== l.productCode))}>
                  <IconTrash size={15} />
                </button>
              </div>
            );
          })}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 10, marginTop: 4 }}>
            <span className="muted">Subtotal (sem IVA)</span><strong>{formatKz(netTotal)}</strong>
          </div>
        </div>
      ) : <p className="muted" style={{ fontSize: 13 }}>Ainda sem linhas. O IVA é calculado automaticamente por produto.</p>}

      <button className="btn lg block" style={{ marginTop: 14 }} onClick={submit} disabled={busy}>
        {busy ? 'A criar…' : 'Criar encomenda (rascunho)'}
      </button>
    </Modal>
  );
}
