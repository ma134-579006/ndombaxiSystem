import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  SupplierRow, CreateSupplierInput, PurchaseOrderRow, PurchaseOrderLineInput,
  WarehouseRow, ManagerProduct,
} from '../api/types';
import { Modal } from '../components/ui';
import { IconPlus, IconTruck, IconCheck, IconBuilding, IconTrash } from '../components/Icons';
import { formatKz, formatDate } from '../format';

const PO_TONE: Record<string, string> = {
  DRAFT: 'var(--warning)', CONFIRMED: 'var(--primary)', RECEIVED: 'var(--success)', CANCELLED: 'var(--muted)',
};
const PO_LABEL: Record<string, string> = {
  DRAFT: 'Rascunho', CONFIRMED: 'Confirmada', RECEIVED: 'Recebida', CANCELLED: 'Cancelada',
};

/** Compras: fornecedores + encomendas de compra (rascunho → confirmar → rececionar → entra em stock). */
export function Purchasing() {
  const [tab, setTab] = useState<'orders' | 'suppliers'>('orders');
  const [suppliers, setSuppliers] = useState<SupplierRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [orders, setOrders] = useState<PurchaseOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newSupplier, setNewSupplier] = useState(false);
  const [newOrder, setNewOrder] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
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
  }, []);

  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) alert(ok); await load(); }
    catch (e) { alert(e instanceof ApiError ? e.message : 'Operação falhou.'); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Compras</h2>
        <span className="spacer" />
        {tab === 'suppliers' ? (
          <button className="btn" onClick={() => setNewSupplier(true)}><IconPlus size={16} /> Novo fornecedor</button>
        ) : (
          <button className="btn" onClick={() => setNewOrder(true)} disabled={suppliers.length === 0 || warehouses.length === 0}>
            <IconPlus size={16} /> Nova encomenda
          </button>
        )}
      </div>

      <div className="seg" style={{ maxWidth: 380, marginBottom: 14 }}>
        <button className={tab === 'orders' ? 'on' : ''} onClick={() => setTab('orders')}>Encomendas de compra</button>
        <button className={tab === 'suppliers' ? 'on' : ''} onClick={() => setTab('suppliers')}>Fornecedores</button>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}
      {(suppliers.length === 0 || warehouses.length === 0) && !loading ? (
        <div className="banner" style={{ marginBottom: 12 }}>
          Para criar encomendas precisa de pelo menos um <strong>fornecedor</strong> e um <strong>armazém</strong>.
        </div>
      ) : null}

      {tab === 'orders' ? (
        <div className="card">
          <h3>Encomendas de compra</h3>
          {loading ? <div className="loading">A carregar…</div> : orders.length === 0 ? (
            <div className="empty"><IconTruck size={40} /><p>Sem encomendas. Crie uma para repor stock junto de um fornecedor.</p></div>
          ) : orders.map((o) => (
            <div className="list-row" key={o.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{o.number} <span className="muted" style={{ fontWeight: 500 }}>· {o.supplier_name}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {formatKz(o.gross_total)} · {formatDate(o.order_date)}
                  {o.expected_date ? ` · prevista ${formatDate(o.expected_date)}` : ''}
                </div>
              </div>
              <span className="badge" style={{ color: PO_TONE[o.status] ?? 'var(--muted)', borderColor: 'currentColor' }}>
                {PO_LABEL[o.status] ?? o.status}
              </span>
              {o.status === 'DRAFT' ? (
                <button className="btn sm ghost" onClick={() => act(() => api.purchasing.confirmOrder(o.id))}>Confirmar</button>
              ) : null}
              {o.status === 'CONFIRMED' ? (
                <button className="btn sm" onClick={() => act(
                  () => api.purchasing.receiveOrder(o.id),
                  'Encomenda rececionada — stock actualizado.',
                )}><IconCheck size={14} /> Rececionar</button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <h3>Fornecedores</h3>
          {loading ? <div className="loading">A carregar…</div> : suppliers.length === 0 ? (
            <div className="empty"><IconBuilding size={40} /><p>Sem fornecedores registados.</p></div>
          ) : suppliers.map((s) => (
            <div className="list-row" key={s.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{s.name} <span className="muted" style={{ fontWeight: 500 }}>· {s.code}</span></div>
                <div className="muted" style={{ fontSize: 13 }}>
                  {[s.nif ? `NIF ${s.nif}` : null, s.phone, s.email].filter(Boolean).join(' · ') || 'Sem contactos'}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {newSupplier ? <SupplierModal onClose={() => setNewSupplier(false)} onSaved={load} /> : null}
      {newOrder ? (
        <OrderModal
          suppliers={suppliers} warehouses={warehouses} products={products}
          onClose={() => setNewOrder(false)} onSaved={load}
        />
      ) : null}
    </>
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
      alert(`Encomenda ${r.number} criada (rascunho). Confirme e depois rececione para dar entrada em stock.`);
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
