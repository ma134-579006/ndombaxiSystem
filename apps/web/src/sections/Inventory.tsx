import { confirmDialog, toast } from '../components/feedback';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { DashLowStock, ExpiringBatch, ManagerProduct, StockCountDetail, StockCountRow, WarehouseRow } from '../api/types';
import { Modal } from '../components/ui';
import { ProductPicker } from '../components/ProductPicker';
import { BarcodeScanner } from '../components/BarcodeScanner';
import { IconCheck, IconCube, IconPlus, IconTruck, IconTrash, IconReceipt } from '../components/Icons';
import { formatKz, formatDate } from '../format';

/** Inventário profissional: entrada de stock (custo/lucro), contagens e baixas. */
export function Inventory() {
  const [counts, setCounts] = useState<StockCountRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openCount, setOpenCount] = useState<StockCountDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [entering, setEntering] = useState(false);
  const [writingOff, setWritingOff] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [batches, setBatches] = useState<ExpiringBatch[]>([]);
  const [lowStock, setLowStock] = useState<DashLowStock[]>([]);
  const [woInit, setWoInit] = useState<{ productId: string; quantity?: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [c, w, p, b, ls] = await Promise.all([
        api.inventory.listCounts(),
        api.inventory.warehouses(),
        api.products.list(),
        api.inventory.expiringBatches(60).catch(() => [] as ExpiringBatch[]),
        api.dashboard.lowStock().catch(() => [] as DashLowStock[]),
      ]);
      setCounts(c); setWarehouses(w); setProducts(p); setBatches(b); setLowStock(ls); setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar.');
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Guarda anti-duplo-clique: evita criar 2 contagens (0001+0002) se o
  // utilizador clicar de novo enquanto a API (lenta no arranque) responde.
  const creatingRef = useRef(false);
  const create = async (warehouseId: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setCreating(false); // fecha o modal já, para o botão não ser clicável outra vez
    try {
      const r = await api.inventory.createCount(warehouseId);
      const detail = await api.inventory.getCount(r.id);
      setOpenCount(detail);
      await load();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao criar contagem.');
    } finally {
      creatingRef.current = false;
    }
  };

  return (
    <>
      <div className="content-head">
        <h2>Inventário</h2>
        <span className="spacer" />
        <button className="btn" onClick={() => setEntering(true)} disabled={warehouses.length === 0 || products.length === 0}>
          <IconTruck size={16} /> Entrada de stock
        </button>
        <button className="btn ghost" onClick={() => setWritingOff(true)} disabled={warehouses.length === 0 || products.length === 0}>
          <IconTrash size={16} /> Baixa de stock
        </button>
        {warehouses.length > 1 ? (
          <button className="btn ghost" onClick={() => setTransferring(true)} disabled={products.length === 0}>
            <IconTruck size={16} /> Transferir entre lojas
          </button>
        ) : null}
        <button className="btn ghost" onClick={() => setCreating(true)} disabled={warehouses.length === 0}>
          <IconPlus size={16} /> Nova contagem
        </button>
      </div>
      {error ? <div className="banner danger">{error}</div> : null}
      {(warehouses.length === 0 || products.length === 0) && !loading ? (
        <div className="banner" style={{ marginBottom: 12 }}>
          Para dar entrada de stock precisa de uma <strong>loja</strong> e pelo menos um <strong>produto</strong>.
        </div>
      ) : null}
      {lowStock.length > 0 ? (
        <div className="banner warning" style={{ marginBottom: 12, flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700 }}>
            <span>⚠️</span><span>{lowStock.length} produto(s) abaixo do stock mínimo</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {lowStock.slice(0, 10).map((l, i) => (
              <span key={`${l.productCode}-${i}`} className="alert-chip" title={`${l.productName} — ${l.quantity}/${l.minQty}`}>
                {l.productName} · {l.quantity}/{l.minQty}
              </span>
            ))}
            {lowStock.length > 10 ? <span className="alert-chip">+{lowStock.length - 10}</span> : null}
          </div>
        </div>
      ) : null}
      {batches.filter((b) => b.days_left <= 60).length > 0 ? (
        <div className="banner warning" style={{ marginBottom: 12 }}>
          <span>⏰</span>
          <span><strong>{batches.filter((b) => b.days_left <= 60).length} lote(s)</strong> a expirar nos próximos 60 dias — ver a secção “Lotes &amp; validade” abaixo.</span>
        </div>
      ) : null}

      <div className="card">
        <h3>Contagens de inventário</h3>
        {loading ? <div className="loading">A carregar…</div> : counts.length === 0 ? (
          <div className="empty"><IconCube size={40} /><p>Sem contagens. Crie uma para conferir o stock.</p></div>
        ) : counts.map((c) => (
          <div className="list-row" key={c.id} style={{ cursor: 'pointer' }} onClick={async () => setOpenCount(await api.inventory.getCount(c.id))}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{c.reference} <span className="muted" style={{ fontWeight: 500 }}>· {c.warehouse_name}</span></div>
              <div className="muted" style={{ fontSize: 13 }}>{c.items} artigos · {new Date(c.created_at).toLocaleDateString('pt-PT')}</div>
            </div>
            <span className="badge" style={{ color: c.status === 'CLOSED' ? 'var(--success)' : 'var(--warning)', borderColor: 'currentColor' }}>
              {c.status === 'CLOSED' ? 'Fechada' : 'A contar'}
            </span>
          </div>
        ))}
      </div>

      {/* Lotes & validade (FEFO) */}
      <div className="card">
        <div className="row" style={{ marginBottom: 6 }}>
          <h3 style={{ margin: 0 }}>Lotes &amp; validade</h3>
          <span className="spacer" />
          <span className="muted" style={{ fontSize: 12 }}>a expirar (60 dias) / expirados</span>
        </div>
        {loading ? <div className="loading">A carregar…</div> : batches.length === 0 ? (
          <div className="empty"><IconReceipt size={36} /><p>Sem lotes a expirar. Indique o lote e a validade na <strong>Entrada de stock</strong> para controlar validades (FEFO).</p></div>
        ) : batches.map((b) => {
          const expired = b.days_left <= 0;
          const prod = products.find((x) => x.name === b.product_name);
          return (
            <div className="list-row" key={b.id}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700 }}>{b.product_name}{b.batch_code ? <span className="muted" style={{ fontWeight: 500 }}> · lote {b.batch_code}</span> : null}</div>
                <div className="muted" style={{ fontSize: 13 }}>{Number(b.quantity)} un. · validade {formatDate(b.expiry_date)}</div>
              </div>
              <span className="badge" style={{ color: expired ? 'var(--danger)' : b.days_left <= 14 ? 'var(--warning)' : 'var(--muted)', borderColor: 'currentColor' }}>
                {expired ? `Expirado há ${-b.days_left}d` : `faltam ${b.days_left}d`}
              </span>
              {prod ? (
                <button className="btn sm ghost" onClick={() => setWoInit({ productId: prod.id, quantity: Number(b.quantity) })} title="Dar baixa por caducidade">
                  Baixa
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      {creating ? (
        <Modal title="Nova contagem de inventário" onClose={() => setCreating(false)}>
          <p className="muted" style={{ marginTop: 0 }}>Escolha a loja a inventariar:</p>
          {warehouses.map((w) => (
            <button key={w.id} className="btn ghost block" style={{ marginBottom: 8 }} onClick={() => create(w.id)}>
              {w.name} {w.is_default ? '(principal)' : ''}
            </button>
          ))}
        </Modal>
      ) : null}

      {entering ? (
        <StockEntryModal
          products={products}
          warehouses={warehouses}
          onClose={() => setEntering(false)}
          onSaved={() => { setEntering(false); void load(); }}
        />
      ) : null}
      {writingOff || woInit ? (
        <WriteOffModal
          products={products}
          warehouses={warehouses}
          initial={woInit ?? undefined}
          onClose={() => { setWritingOff(false); setWoInit(null); }}
          onSaved={() => { setWritingOff(false); setWoInit(null); void load(); }}
        />
      ) : null}
      {transferring ? (
        <TransferModal
          products={products}
          warehouses={warehouses}
          onClose={() => setTransferring(false)}
          onSaved={() => { setTransferring(false); void load(); }}
        />
      ) : null}
      {openCount ? <CountSheet detail={openCount} products={products} onClose={() => { setOpenCount(null); void load(); }} /> : null}
    </>
  );
}

/** Transferência de stock entre duas lojas. */
function TransferModal({
  products, warehouses, onClose, onSaved,
}: {
  products: ManagerProduct[];
  warehouses: WarehouseRow[];
  onClose(): void;
  onSaved(): void;
}) {
  const [productId, setProductId] = useState('');
  const [fromStoreId, setFromStoreId] = useState(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [toStoreId, setToStoreId] = useState(warehouses.find((w) => !w.is_default)?.id ?? '');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const q = Number(qty) || 0;
  const submit = async () => {
    setErr(null); setOk(null);
    if (!productId) { setErr('Escolha o produto.'); return; }
    if (!fromStoreId || !toStoreId) { setErr('Escolha as lojas de origem e destino.'); return; }
    if (fromStoreId === toStoreId) { setErr('A origem e o destino têm de ser lojas diferentes.'); return; }
    if (!(q > 0)) { setErr('Indique a quantidade a transferir.'); return; }
    setBusy(true);
    try {
      const r = await api.inventory.transfer({ productId, fromStoreId, toStoreId, quantity: q, note: note.trim() || undefined });
      setOk(`Transferido. Saldo origem: ${r.fromBalance} · destino: ${r.toBalance}.`);
      setTimeout(onSaved, 900);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao transferir.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Transferir stock entre lojas" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {ok ? <div className="banner success" style={{ marginBottom: 12 }}>{ok}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Move unidades de uma loja para outra. O total da empresa não muda — só a distribuição por loja. Fica registado na auditoria.
      </p>
      <div className="field"><label>Produto</label>
        <ProductPicker products={products} value={productId} onChange={setProductId} /></div>
      <div className="grid-2">
        <div className="field"><label>De (origem)</label>
          <select value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (principal)' : ''}</option>)}
          </select></div>
        <div className="field"><label>Para (destino)</label>
          <select value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
            <option value="">Escolher…</option>
            {warehouses.filter((w) => w.id !== fromStoreId).map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (principal)' : ''}</option>)}
          </select></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Quantidade</label>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="ex.: 5" /></div>
        <div className="field"><label>Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: reposição loja talatona" /></div>
      </div>
      <button className="btn lg block" onClick={submit} disabled={busy}>
        {busy ? 'A transferir…' : 'Confirmar transferência'}
      </button>
    </Modal>
  );
}

const WRITEOFF_REASONS = ['Caducidade / validade', 'Dano / quebra', 'Roubo / perda', 'Amostra / oferta', 'Outro'];

/** Baixa de stock: retira unidades por caducidade, dano, perda, etc. (auditado). */
function WriteOffModal({
  products, warehouses, initial, onClose, onSaved,
}: {
  products: ManagerProduct[];
  warehouses: WarehouseRow[];
  initial?: { productId?: string; quantity?: number };
  onClose(): void;
  onSaved(): void;
}) {
  const [productId, setProductId] = useState(initial?.productId || products[0]?.id || '');
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [qty, setQty] = useState(initial?.quantity != null ? String(initial.quantity) : '');
  const [reason, setReason] = useState(WRITEOFF_REASONS[0]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    setErr(null);
    const q = Number(qty);
    if (!productId || !warehouseId) { setErr('Escolha o produto e a loja.'); return; }
    if (!(q > 0)) { setErr('Indique a quantidade a dar baixa.'); return; }
    setBusy(true);
    try {
      await api.inventory.writeOff(productId, warehouseId, q, note.trim() ? `${reason} — ${note.trim()}` : reason);
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao dar baixa.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Baixa de stock" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
        Retira unidades do stock por <strong>caducidade</strong>, dano, perda, etc. Fica registado na auditoria.
      </p>
      <div className="grid-2">
        <div className="field"><label>Produto</label>
          <ProductPicker products={products} value={productId} onChange={setProductId} /></div>
        <div className="field"><label>Loja</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (principal)' : ''}</option>)}
          </select></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Quantidade</label>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="ex.: 3" /></div>
        <div className="field"><label>Motivo</label>
          <select value={reason} onChange={(e) => setReason(e.target.value)}>
            {WRITEOFF_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
          </select></div>
      </div>
      <div className="field"><label>Nota (opcional)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: lote vencido a 30/06" /></div>
      <button className="btn lg block danger" onClick={submit} disabled={busy}>
        {busy ? 'A dar baixa…' : 'Confirmar baixa'}
      </button>
    </Modal>
  );
}

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Entrada de stock em lote com cálculo automático de custo unitário e lucro. */
function StockEntryModal({
  products, warehouses, onClose, onSaved,
}: {
  products: ManagerProduct[];
  warehouses: WarehouseRow[];
  onClose(): void;
  onSaved(): void;
}) {
  const [productId, setProductId] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouses.find((w) => w.is_default)?.id ?? warehouses[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [totalCost, setTotalCost] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [batchCode, setBatchCode] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [minQty, setMinQty] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const product = useMemo(() => products.find((p) => p.id === productId), [products, productId]);
  // Preenche o preço de venda com o atual do produto, se ainda vazio.
  useEffect(() => {
    if (product && salePrice === '') setSalePrice(product.unit_price || '');
  }, [product]); // eslint-disable-line react-hooks/exhaustive-deps

  const q = Number(qty) || 0;
  const tc = Number(totalCost) || 0;
  const sp = Number(salePrice) || 0;
  const unitCost = q > 0 ? tc / q : 0;
  const unitProfit = sp - unitCost;
  const totalProfit = unitProfit * q;
  const margin = sp > 0 ? (unitProfit / sp) * 100 : 0;

  const submit = async () => {
    setErr(null);
    if (!productId || !warehouseId) { setErr('Escolha o produto e a loja.'); return; }
    if (!(q > 0)) { setErr('Indique a quantidade.'); return; }
    if (!(tc >= 0) || totalCost === '') { setErr('Indique o custo total.'); return; }
    setBusy(true);
    try {
      await api.inventory.stockEntry({
        productId, warehouseId, quantity: q,
        unitCost: Math.round(unitCost * 100) / 100,
        salePrice: salePrice !== '' ? sp : undefined,
        batchCode: batchCode.trim() || undefined,
        expiryDate: expiryDate || undefined,
        minQty: minQty !== '' ? Number(minQty) : undefined,
      });
      onSaved();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao dar entrada.'); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="Entrada de stock" onClose={onClose}>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      <div className="grid-2">
        <div className="field"><label>Produto</label>
          <ProductPicker products={products} value={productId} onChange={(id) => { setProductId(id); setSalePrice(''); }} /></div>
        <div className="field"><label>Loja</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="ALL">Todas as lojas (stock partilhado)</option>
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}{w.is_default ? ' (principal)' : ''}</option>)}
          </select></div>
      </div>
      <div className="grid-2">
        <div className="field"><label>Quantidade que entrou</label>
          <input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="ex.: 10" /></div>
        <div className="field"><label>Custo total pago (Kz)</label>
          <input inputMode="decimal" value={totalCost} onChange={(e) => setTotalCost(e.target.value)} placeholder="ex.: 40000" /></div>
      </div>
      <div className="field"><label>Preço de venda por unidade (Kz)</label>
        <input inputMode="decimal" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} placeholder="ex.: 5000" /></div>
      <div className="grid-2">
        <div className="field"><label>Código do lote (opcional)</label>
          <input value={batchCode} onChange={(e) => setBatchCode(e.target.value)} placeholder="ex.: L-2026-07" /></div>
        <div className="field"><label>Validade (opcional)</label>
          <input type="date" value={expiryDate} min={todayISO()} onChange={(e) => setExpiryDate(e.target.value)} /></div>
      </div>
      <div className="field"><label>Stock mínimo (alerta de reposição)</label>
        <input inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="ex.: 5 — avisa quando o stock descer a este nível" /></div>

      {/* Cálculo automático */}
      <div className="kpi-grid" style={{ margin: '6px 0 8px', gridTemplateColumns: '1fr 1fr' }}>
        <div className="kpi-card">
          <div className="kpi-label">Custo unitário</div>
          <div className="kpi-value" style={{ fontSize: 19 }}>{q > 0 ? formatKz(unitCost) : '—'}</div>
          <div className="kpi-sub">{q > 0 ? `${tc ? formatKz(tc) : '0'} ÷ ${q}` : 'custo total ÷ quantidade'}</div>
        </div>
        <div className={`kpi-card ${totalProfit < 0 ? 'danger' : 'success'}`}>
          <div className="kpi-label">Lucro por unidade</div>
          <div className="kpi-value" style={{ fontSize: 19, color: q > 0 && sp > 0 ? (unitProfit < 0 ? 'var(--danger)' : 'var(--success)') : undefined }}>
            {q > 0 && sp > 0 ? formatKz(unitProfit) : '—'}
          </div>
          <div className="kpi-sub">{q > 0 && sp > 0 ? `margem ${margin.toFixed(0)}%` : 'preço − custo unitário'}</div>
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'space-between', padding: '4px 2px 10px', fontSize: 14 }}>
        <span className="muted">Lucro total estimado ({q || 0} un.)</span>
        <strong style={{ fontSize: 17, color: totalProfit < 0 ? 'var(--danger)' : 'var(--success)' }}>
          {q > 0 && sp > 0 ? formatKz(totalProfit) : '—'}
        </strong>
      </div>

      <button className="btn lg block" onClick={submit} disabled={busy}>
        {busy ? 'A dar entrada…' : 'Dar entrada e atualizar preços'}
      </button>
    </Modal>
  );
}

function CountSheet({ detail, products, onClose }: { detail: StockCountDetail; products: ManagerProduct[]; onClose(): void }) {
  const [items, setItems] = useState(detail.items);
  const [status, setStatus] = useState(detail.status);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [flashId, setFlashId] = useState<string | null>(null);

  // Pesquisa por nome OU código de barras (à medida que escreve).
  const norm = (s: string) => s.toLowerCase().trim();
  const filtered = q.trim()
    ? items.filter((it) => norm(it.description).includes(norm(q)) || norm(it.product_code).includes(norm(q)))
    : items;

  // Scanner pela câmara (igual ao caixa): encontra o produto e realça-o.
  const onScan = (code: string) => {
    const hit = items.find((it) => it.product_code === code)
      ?? items.find((it) => norm(it.product_code) === norm(code));
    if (hit) {
      setQ(code);
      setFlashId(hit.id);
      window.setTimeout(() => setFlashId(null), 2400);
    } else {
      setQ(code); // mostra "sem resultados" — produto não está nesta contagem
    }
  };

  const costOf = (productId: string) => Number(products.find((p) => p.id === productId)?.cost_price ?? 0);

  const printInventory = () => {
    const rows = items.map((it) => {
      const sys = Number(it.system_qty);
      const cnt = it.counted_qty != null && it.counted_qty !== '' ? Number(it.counted_qty) : null;
      const diff = cnt != null ? cnt - sys : null;
      const lossVal = diff != null && diff < 0 ? Math.abs(diff) * costOf(it.product_id) : 0;
      return { code: it.product_code, name: it.description, sys, cnt, diff, lossVal };
    });
    const totalLoss = rows.reduce((s, r) => s + r.lossVal, 0);
    const divergent = rows.filter((r) => r.diff != null && r.diff !== 0).length;
    const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const fmt = (n: number) => new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 2 }).format(n) + ' Kz';
    const body = rows.map((r) => `
      <tr>
        <td>${esc(r.code)}</td><td>${esc(r.name)}</td>
        <td class="r">${r.sys}</td>
        <td class="r">${r.cnt != null ? r.cnt : '—'}</td>
        <td class="r ${r.diff != null && r.diff < 0 ? 'neg' : r.diff ? 'pos' : ''}">${r.diff != null ? (r.diff > 0 ? '+' : '') + r.diff : '—'}</td>
        <td class="r neg">${r.lossVal > 0 ? fmt(r.lossVal) : '—'}</td>
      </tr>`).join('');
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Inventário ${esc(detail.reference)}</title>
      <style>
        body{font-family:Arial,Helvetica,sans-serif;color:#111;padding:24px;font-size:13px}
        h1{font-size:18px;margin:0 0 2px} .sub{color:#666;margin:0 0 14px}
        table{width:100%;border-collapse:collapse} th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}
        th{background:#f3f3f3} .r{text-align:right} .neg{color:#c0262c;font-weight:700} .pos{color:#b06a00;font-weight:700}
        tfoot td{font-weight:700;background:#fafafa}
        .summary{display:flex;gap:24px;margin:10px 0 16px}
        .summary div{font-size:13px} .summary b{display:block;font-size:16px}
      </style></head><body>
      <h1>Inventário · ${esc(detail.reference)}</h1>
      <p class="sub">Data: ${new Date().toLocaleString('pt-PT')} · Estado: ${status === 'CLOSED' ? 'Fechada' : 'Em curso'}</p>
      <div class="summary">
        <div>Itens<b>${rows.length}</b></div>
        <div>Divergências<b>${divergent}</b></div>
        <div>Perda total (a custo)<b class="neg">${fmt(totalLoss)}</b></div>
      </div>
      <table>
        <thead><tr><th>Código</th><th>Produto</th><th class="r">Sistema</th><th class="r">Contado</th><th class="r">Diferença</th><th class="r">Perda (Kz)</th></tr></thead>
        <tbody>${body}</tbody>
        <tfoot><tr><td colspan="5" class="r">Perda total</td><td class="r neg">${fmt(totalLoss)}</td></tr></tfoot>
      </table>
      <script>window.onload=function(){window.print();}<\/script>
      </body></html>`;
    const w = window.open('', '_blank', 'width=900,height=700');
    if (!w) { toast.error('Permita popups para imprimir o inventário.'); return; }
    w.document.write(html); w.document.close();
  };

  const setCounted = async (productId: string, value: string) => {
    const counted = Number(value);
    setItems((prev) => prev.map((it) => it.product_id === productId
      ? { ...it, counted_qty: value, difference: String(counted - Number(it.system_qty)) } : it));
    if (value !== '') {
      try { await api.inventory.countItem(detail.id, productId, counted); } catch { /* best-effort */ }
    }
  };

  const close = async () => {
    if (!(await confirmDialog({ message: 'Fechar a contagem e aplicar os ajustes ao stock?' }))) return;
    setBusy(true);
    try {
      const r = await api.inventory.closeCount(detail.id);
      toast.error(`Contagem fechada. ${r.adjusted} produto(s) ajustado(s).`);
      setStatus('CLOSED');
      onClose();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Falha ao fechar.');
    } finally { setBusy(false); }
  };

  const counted = items.filter((i) => i.counted_qty != null && i.counted_qty !== '').length;
  const divergent = items.filter((i) => i.difference != null && Number(i.difference) !== 0).length;

  return (
    <Modal title={`Contagem ${detail.reference}`} onClose={onClose}>
      {/* Estado + imprimir (linha 1, embrulha em ecrãs estreitos) */}
      <div className="row" style={{ gap: 12, marginBottom: 10, fontSize: 13, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="pill">{counted}/{items.length} contados</span>
        <span className={`pill ${divergent ? '' : 'on'}`} style={divergent ? { color: 'var(--warning)', borderColor: 'currentColor' } : undefined}>
          {divergent} divergências
        </span>
        <span className="spacer" />
        <button className="btn ghost sm" onClick={printInventory}><IconReceipt size={15} /> Imprimir (perdas)</button>
      </div>

      {/* Pesquisa por nome/código + leitor pela câmara (linha 2) */}
      <div className="row" style={{ gap: 8, marginBottom: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Procurar produto por nome ou código de barras…"
          style={{ flex: '1 1 200px', minWidth: 0, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', color: 'var(--text)', fontSize: 14 }}
        />
        {q ? <button className="btn sm ghost" onClick={() => setQ('')}>Limpar</button> : null}
        <BarcodeScanner onDetected={onScan} />
      </div>

      <div style={{ maxHeight: '46vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {filtered.length === 0 ? (
          <div className="empty" style={{ padding: '22px 0' }}>
            <p className="muted" style={{ margin: 0 }}>Nenhum produto corresponde a «{q}».</p>
          </div>
        ) : filtered.map((it) => {
          const diff = it.difference != null && it.counted_qty != null && it.counted_qty !== '' ? Number(it.difference) : null;
          return (
            <div key={it.id} className="list-row" style={{
              padding: '8px 10px', flexWrap: 'wrap', borderRadius: 10,
              background: flashId === it.id ? 'var(--primary-soft)' : undefined,
              border: flashId === it.id ? '1px solid var(--primary)' : '1px solid transparent',
              transition: 'background .4s, border-color .4s',
            }}>
              <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.description}</div>
                <div className="muted" style={{ fontSize: 12 }}>{it.product_code} · sistema {Number(it.system_qty)}</div>
              </div>
              {diff != null && diff !== 0 ? (
                <span style={{ fontSize: 12, fontWeight: 700, color: diff < 0 ? 'var(--danger)' : 'var(--warning)', flex: 'none' }}>{diff > 0 ? '+' : ''}{diff}</span>
              ) : null}
              <input
                disabled={status === 'CLOSED'}
                style={{ width: 86, flex: 'none', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 10px', color: 'var(--text)', textAlign: 'right' }}
                inputMode="decimal" placeholder="—"
                defaultValue={it.counted_qty ?? ''}
                onBlur={(e) => setCounted(it.product_id, e.target.value)}
              />
            </div>
          );
        })}
      </div>
      {status !== 'CLOSED' ? (
        <button className="btn lg block" style={{ marginTop: 14 }} onClick={close} disabled={busy}>
          <IconCheck size={18} /> {busy ? 'A fechar…' : 'Fechar contagem e ajustar stock'}
        </button>
      ) : <div className="banner success" style={{ marginTop: 14 }}>Contagem fechada.</div>}
    </Modal>
  );
}
