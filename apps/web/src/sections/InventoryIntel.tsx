import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type {
  AbcReport, AuditFilters, AuditTrailRow, FraudReport, LocationRow, ManagerProduct,
  ReplenishmentReport, TransferRequestRow, ValuationReport, WarehouseRow,
} from '../api/types';
import { IconChart, IconCube, IconSearch, IconShield, IconTruck } from '../components/Icons';
import { formatKz } from '../format';

const isoMinusDays = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const todayISO = () => new Date().toISOString().slice(0, 10);
const fmtDT = (s: string) => { try { return new Date(s).toLocaleString('pt-PT'); } catch { return s; } };

type Tab = 'abc' | 'replenish' | 'valuation' | 'fraud' | 'transfers' | 'locations' | 'audit';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'abc', label: '📦 Curva ABC' },
  { id: 'replenish', label: '📈 Reposição' },
  { id: 'valuation', label: '💰 Valorização' },
  { id: 'fraud', label: '🚨 Antifraude' },
  { id: 'transfers', label: '🔄 Transferências' },
  { id: 'locations', label: '📍 Localização' },
  { id: 'audit', label: '📑 Auditoria' },
];

/**
 * Inventário PRO — análises empresariais por cima do stock existente:
 * Curva ABC, previsão de reposição/sugestão de compra, valorização
 * FIFO/LIFO/CMP, motor antifraude, transferências com aprovação,
 * mapa de localização e auditoria por funcionário.
 */
export function InventoryIntel({ role }: { role?: string }) {
  const [tab, setTab] = useState<Tab>('abc');
  const [stores, setStores] = useState<WarehouseRow[]>([]);
  useEffect(() => { api.inventory.warehouses().then(setStores).catch(() => undefined); }, []);

  return (
    <>
      <div className="content-head">
        <h2>Inventário PRO</h2>
        <span className="spacer" />
      </div>
      <div className="chip-row no-print" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn sm ${tab === t.id ? '' : 'ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'abc' ? <AbcTab stores={stores} /> : null}
      {tab === 'replenish' ? <ReplenishTab stores={stores} /> : null}
      {tab === 'valuation' ? <ValuationTab stores={stores} /> : null}
      {tab === 'fraud' ? <FraudTab /> : null}
      {tab === 'transfers' ? <TransfersTab stores={stores} role={role} /> : null}
      {tab === 'locations' ? <LocationsTab stores={stores} /> : null}
      {tab === 'audit' ? <AuditTab /> : null}
    </>
  );
}

function ErrorBanner({ msg }: { msg: string | null }) {
  return msg ? <div className="banner danger" style={{ marginBottom: 12 }}>{msg}</div> : null;
}
function StoreSelect({ stores, value, onChange }: { stores: WarehouseRow[]; value: string; onChange(v: string): void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Todas as lojas</option>
      {stores.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
    </select>
  );
}

// ── 📦 Curva ABC ─────────────────────────────────────────────
function AbcTab({ stores }: { stores: WarehouseRow[] }) {
  const [from, setFrom] = useState(isoMinusDays(90));
  const [to, setTo] = useState(todayISO());
  const [storeId, setStoreId] = useState('');
  const [data, setData] = useState<AbcReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setBusy(true); setErr(null);
    try { setData(await api.inventoryIntel.abc({ from, to, storeId: storeId || undefined })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao gerar a curva ABC.'); }
    finally { setBusy(false); }
  };

  const s = data?.summary;
  const cls = (c: string) => c === 'A' ? 'pill on' : c === 'B' ? 'pill warn' : 'pill';
  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>De</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Até</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        <div className="field"><label>Loja</label><StoreSelect stores={stores} value={storeId} onChange={setStoreId} /></div>
        <button className="btn" onClick={() => void load()} disabled={busy}><IconSearch size={16} /> {busy ? 'A calcular…' : 'Gerar curva ABC'}</button>
      </div>
      {data && s ? (
        <>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi-card"><div className="kpi-label">Classe A (80% do valor)</div><div className="kpi-value">{s.aCount}</div><div className="kpi-sub">{formatKz(s.aValue)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Classe B (80–95%)</div><div className="kpi-value">{s.bCount}</div><div className="kpi-sub">{formatKz(s.bValue)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Classe C (resto)</div><div className="kpi-value">{s.cCount}</div><div className="kpi-sub">{formatKz(s.cValue)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Vendas no período</div><div className="kpi-value">{formatKz(s.totalSales)}</div><div className="kpi-sub">{data.period.from} → {data.period.to}</div></div>
          </div>
          <div className="card">
            {data.rows.length === 0 ? <div className="empty"><IconCube size={36} /><p>Sem vendas no período.</p></div> : (
              <table className="ptable stack">
                <thead><tr><th>Classe</th><th>Produto</th><th>Vendas</th><th>% valor</th><th>% acum.</th><th>Unid.</th><th>Stock</th><th>Rotação</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.productId}>
                      <td data-label="Classe"><span className={cls(r.abcClass)}>{r.abcClass}</span></td>
                      <td data-label="Produto">{r.name} <span className="muted">({r.code})</span></td>
                      <td data-label="Vendas">{formatKz(r.salesValue)}</td>
                      <td data-label="% valor">{r.sharePct}%</td>
                      <td data-label="% acum.">{r.cumulativePct}%</td>
                      <td data-label="Unid.">{r.unitsSold}</td>
                      <td data-label="Stock">{r.stockQty}</td>
                      <td data-label="Rotação">{r.rotation != null ? `${r.rotation}×` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : <div className="card"><div className="empty"><IconChart size={36} /><p>Escolha o período e clique <strong>Gerar curva ABC</strong>.</p></div></div>}
    </>
  );
}

// ── 📈 Reposição + sugestão de compra ────────────────────────
function ReplenishTab({ stores }: { stores: WarehouseRow[] }) {
  const [storeId, setStoreId] = useState('');
  const [days, setDays] = useState(30);
  const [coverage, setCoverage] = useState(30);
  const [onlySuggested, setOnlySuggested] = useState(true);
  const [data, setData] = useState<ReplenishmentReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setBusy(true); setErr(null);
    try { setData(await api.inventoryIntel.replenishment({ days, coverage, storeId: storeId || undefined })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao calcular a reposição.'); }
    finally { setBusy(false); }
  };

  const rows = (data?.rows ?? []).filter((r) => !onlySuggested || r.suggestedQty > 0);
  const totalCost = rows.reduce((s, r) => s + r.suggestedCost, 0);
  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>Loja</label><StoreSelect stores={stores} value={storeId} onChange={setStoreId} /></div>
          <div className="field"><label>Histórico (dias)</label>
            <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={14}>14</option><option value={30}>30</option><option value={60}>60</option><option value={90}>90</option>
            </select></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Cobertura da compra (dias)</label>
            <select value={coverage} onChange={(e) => setCoverage(Number(e.target.value))}>
              <option value={15}>15</option><option value={30}>30</option><option value={45}>45</option><option value={60}>60</option>
            </select></div>
          <div className="field"><label>Mostrar</label>
            <select value={onlySuggested ? '1' : '0'} onChange={(e) => setOnlySuggested(e.target.value === '1')}>
              <option value="1">Só sugestões de compra</option>
              <option value="0">Todos os produtos</option>
            </select></div>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}><IconSearch size={16} /> {busy ? 'A calcular…' : 'Calcular reposição'}</button>
      </div>
      {data ? (
        <div className="card">
          {rows.length === 0 ? <div className="empty"><IconCube size={36} /><p>Nada a repor — stock saudável. 👍</p></div> : (
            <>
              <div className="muted" style={{ marginBottom: 8 }}>
                Sugestão total: <strong>{formatKz(totalCost)}</strong> (custo estimado) · previsão pelo consumo dos últimos {data.params.days} dias, cobertura {data.params.coverage} dias.
              </div>
              <table className="ptable stack">
                <thead><tr><th>Produto</th><th>Loja</th><th>Stock</th><th>Mín.</th><th>Venda/dia</th><th>Dias rest.</th><th>Comprar</th><th>Custo est.</th><th>Motivo</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>
                      <td data-label="Produto">{r.name} <span className="muted">({r.code})</span></td>
                      <td data-label="Loja">{r.storeName}</td>
                      <td data-label="Stock"><span className={r.quantity <= r.minQty ? 'pill off' : 'pill on'}>{r.quantity}</span></td>
                      <td data-label="Mín.">{r.minQty}</td>
                      <td data-label="Venda/dia">{r.perDay}</td>
                      <td data-label="Dias rest.">{r.daysLeft != null ? `${r.daysLeft} d` : '—'}</td>
                      <td data-label="Comprar" style={{ fontWeight: 700 }}>{r.suggestedQty > 0 ? r.suggestedQty : '—'}</td>
                      <td data-label="Custo est.">{r.suggestedCost > 0 ? formatKz(r.suggestedCost) : '—'}</td>
                      <td data-label="Motivo">{r.reason === 'STOCK_MINIMO' ? 'No mínimo' : r.reason === 'ACABA_ANTES_DO_LEAD' ? 'Acaba em breve' : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      ) : <div className="card"><div className="empty"><IconChart size={36} /><p>Clique <strong>Calcular reposição</strong> para ver as sugestões de compra.</p></div></div>}
    </>
  );
}

// ── 💰 Valorização FIFO / LIFO / CMP ─────────────────────────
function ValuationTab({ stores }: { stores: WarehouseRow[] }) {
  const [method, setMethod] = useState<'FIFO' | 'LIFO' | 'CMP'>('CMP');
  const [storeId, setStoreId] = useState('');
  const [data, setData] = useState<ValuationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    setBusy(true); setErr(null);
    try { setData(await api.inventoryIntel.valuation(method, storeId || undefined)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao valorizar o stock.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>Método</label>
            <select value={method} onChange={(e) => setMethod(e.target.value as 'FIFO' | 'LIFO' | 'CMP')}>
              <option value="CMP">Custo Médio Ponderado (política do ERP)</option>
              <option value="FIFO">FIFO (primeiro a entrar, primeiro a sair)</option>
              <option value="LIFO">LIFO (último a entrar, primeiro a sair)</option>
            </select></div>
          <div className="field"><label>Loja</label><StoreSelect stores={stores} value={storeId} onChange={setStoreId} /></div>
        </div>
        <button className="btn" onClick={() => void load()} disabled={busy}><IconSearch size={16} /> {busy ? 'A valorizar…' : 'Valorizar stock'}</button>
      </div>
      {data ? (
        <>
          <div className="kpi-grid" style={{ marginBottom: 12 }}>
            <div className="kpi-card"><div className="kpi-label">FIFO</div><div className="kpi-value">{formatKz(data.totals.FIFO)}</div></div>
            <div className="kpi-card"><div className="kpi-label">LIFO</div><div className="kpi-value">{formatKz(data.totals.LIFO)}</div></div>
            <div className="kpi-card"><div className="kpi-label">Custo Médio Ponderado</div><div className="kpi-value">{formatKz(data.totals.CMP)}</div></div>
          </div>
          <div className="card">
            {data.rows.length === 0 ? <div className="empty"><IconCube size={36} /><p>Sem stock positivo para valorizar.</p></div> : (
              <table className="ptable stack">
                <thead><tr><th>Produto</th><th>Qtd.</th><th>Valor ({data.method})</th><th>Unit.</th><th>FIFO</th><th>LIFO</th><th>CMP</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.productId}>
                      <td data-label="Produto">{r.name} <span className="muted">({r.code})</span></td>
                      <td data-label="Qtd.">{r.quantity}</td>
                      <td data-label="Valor" style={{ fontWeight: 700 }}>{formatKz(r.value)}</td>
                      <td data-label="Unit.">{formatKz(r.unitValue)}</td>
                      <td data-label="FIFO">{formatKz(r.valueFIFO)}</td>
                      <td data-label="LIFO">{formatKz(r.valueLIFO)}</td>
                      <td data-label="CMP">{formatKz(r.valueCMP)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      ) : <div className="card"><div className="empty"><IconChart size={36} /><p>Escolha o método e clique <strong>Valorizar stock</strong>.</p></div></div>}
    </>
  );
}

// ── 🚨 Motor antifraude ──────────────────────────────────────
function FraudTab() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<FraudReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async (d: number) => {
    setBusy(true); setErr(null);
    try { setData(await api.inventoryIntel.fraudSignals(d)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao analisar os sinais.'); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void load(days); }, [load, days]);

  const sev = (s: string) => s === 'HIGH' ? 'pill off' : s === 'MEDIUM' ? 'pill warn' : 'pill';
  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <IconShield size={18} />
        <span className="muted">Sinais de controlo interno para investigação — não são acusações.</span>
        <span className="spacer" />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>Últimos 7 dias</option>
          <option value={30}>Últimos 30 dias</option>
          <option value={90}>Últimos 90 dias</option>
        </select>
      </div>
      <div className="card">
        {busy ? <div className="empty"><p>A analisar…</p></div>
          : !data || data.signals.length === 0 ? <div className="empty"><IconShield size={36} /><p>Sem sinais suspeitos nos últimos {days} dias. ✅</p></div>
          : (
            <table className="ptable stack">
              <thead><tr><th>Gravidade</th><th>Sinal</th><th>Detalhe</th><th>Ocorrências</th></tr></thead>
              <tbody>
                {data.signals.map((s, i) => (
                  <tr key={i}>
                    <td data-label="Gravidade"><span className={sev(s.severity)}>{s.severity === 'HIGH' ? 'Alta' : s.severity === 'MEDIUM' ? 'Média' : 'Baixa'}</span></td>
                    <td data-label="Sinal" style={{ fontWeight: 700 }}>{s.title}</td>
                    <td data-label="Detalhe">{s.detail}</td>
                    <td data-label="Ocorrências">{s.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </>
  );
}

// ── 🔄 Transferências com aprovação ──────────────────────────
function TransfersTab({ stores, role }: { stores: WarehouseRow[]; role?: string }) {
  const [rows, setRows] = useState<TransferRequestRow[]>([]);
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const canApprove = role === 'COMPANY_ADMIN' || role === 'SUPER_ADMIN';

  // Formulário do pedido.
  const [productId, setProductId] = useState('');
  const [fromStoreId, setFromStoreId] = useState('');
  const [toStoreId, setToStoreId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try { setRows(await api.inventoryIntel.transfers()); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar transferências.'); }
  }, []);
  useEffect(() => {
    void load();
    api.products.list().then(setProducts).catch(() => undefined);
  }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); setMsg(ok); await load(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha na operação.'); }
    finally { setBusy(false); }
  };

  const request = () => {
    if (!productId || !fromStoreId || !toStoreId) { setErr('Escolha o produto e as duas lojas.'); return; }
    void act(
      () => api.inventoryIntel.requestTransfer({ productId, fromStoreId, toStoreId, quantity, note: note || undefined }),
      'Pedido de transferência criado — aguarda aprovação do administrador.',
    );
  };

  const pill = (st: string) =>
    st === 'RECEIVED' ? 'pill on' : st === 'APPROVED' ? 'pill warn' : st === 'PENDING' ? 'pill' : 'pill off';
  const stLabel = (st: string) =>
    st === 'PENDING' ? 'Pendente' : st === 'APPROVED' ? 'Aprovada (por rececionar)' : st === 'RECEIVED' ? 'Recebida' : st === 'REJECTED' ? 'Rejeitada' : st;

  return (
    <>
      <ErrorBanner msg={err} />
      {msg ? <div className="banner success" style={{ marginBottom: 12 }}>{msg}</div> : null}
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <h3 style={{ marginTop: 0 }}>Pedir transferência <span className="muted" style={{ fontWeight: 400 }}>(gestor pede → administrador aprova → loja destino receciona)</span></h3>
        <div className="grid-2">
          <div className="field"><label>Produto</label>
            <select value={productId} onChange={(e) => setProductId(e.target.value)}>
              <option value="">— escolher —</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select></div>
          <div className="field"><label>Quantidade</label>
            <input type="number" min={0.001} step="any" value={quantity} onChange={(e) => setQuantity(Number(e.target.value) || 0)} /></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>Da loja</label>
            <select value={fromStoreId} onChange={(e) => setFromStoreId(e.target.value)}>
              <option value="">— origem —</option>
              {stores.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
          <div className="field"><label>Para a loja</label>
            <select value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
              <option value="">— destino —</option>
              {stores.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
        </div>
        <div className="field"><label>Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: reforço para o fim de semana" /></div>
        <button className="btn" onClick={request} disabled={busy}><IconTruck size={16} /> {busy ? 'A enviar…' : 'Pedir transferência'}</button>
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty"><IconTruck size={36} /><p>Sem pedidos de transferência.</p></div> : (
          <table className="ptable stack">
            <thead><tr><th>Estado</th><th>Produto</th><th>Qtd.</th><th>Origem → Destino</th><th>Pedido por</th><th>Data</th><th>Ações</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Estado"><span className={pill(r.status)}>{stLabel(r.status)}</span>
                    {r.reject_reason ? <div className="muted" style={{ fontSize: 12 }}>{r.reject_reason}</div> : null}</td>
                  <td data-label="Produto">{r.product_name} <span className="muted">({r.product_code})</span></td>
                  <td data-label="Qtd.">{r.quantity}</td>
                  <td data-label="Origem → Destino">{r.from_store} → {r.to_store}</td>
                  <td data-label="Pedido por">{r.requested_by_name || '—'}
                    {r.approved_by_name ? <div className="muted" style={{ fontSize: 12 }}>aprov.: {r.approved_by_name}</div> : null}
                    {r.received_by_name ? <div className="muted" style={{ fontSize: 12 }}>receb.: {r.received_by_name}</div> : null}</td>
                  <td data-label="Data">{fmtDT(r.created_at)}</td>
                  <td data-label="Ações">
                    {r.status === 'PENDING' && canApprove ? (
                      <span style={{ display: 'inline-flex', gap: 6 }}>
                        <button className="btn sm" disabled={busy}
                          onClick={() => void act(() => api.inventoryIntel.approveTransfer(r.id), 'Transferência aprovada — a loja destino pode rececionar.')}>Aprovar</button>
                        <button className="btn sm ghost" disabled={busy}
                          onClick={() => { const reason = window.prompt('Motivo da rejeição (opcional):') ?? undefined; void act(() => api.inventoryIntel.rejectTransfer(r.id, reason), 'Pedido rejeitado.'); }}>Rejeitar</button>
                      </span>
                    ) : r.status === 'PENDING' ? <span className="muted">aguarda administrador</span> : null}
                    {r.status === 'APPROVED' ? (
                      <button className="btn sm" disabled={busy}
                        onClick={() => void act(() => api.inventoryIntel.receiveTransfer(r.id), 'Receção confirmada — stock movido entre as lojas.')}>✔ Rececionar</button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── 📍 Mapa de localização ───────────────────────────────────
function LocationsTab({ stores }: { stores: WarehouseRow[] }) {
  const [storeId, setStoreId] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<LocationRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try { setRows(await api.inventoryIntel.locations({ storeId: storeId || undefined, q: q || undefined })); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar o mapa.'); }
  }, [storeId, q]);
  useEffect(() => { void load(); }, [load]);

  const keyOf = (r: LocationRow) => `${r.product_id}:${r.store_id}`;
  const save = async (r: LocationRow) => {
    const k = keyOf(r);
    const loc = editing[k] ?? r.location ?? '';
    setBusyKey(k); setErr(null);
    try {
      await api.inventoryIntel.setLocation(r.product_id, r.store_id, loc);
      setEditing((s) => { const n = { ...s }; delete n[k]; return n; });
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao guardar a localização.'); }
    finally { setBusyKey(null); }
  };

  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>Loja</label><StoreSelect stores={stores} value={storeId} onChange={setStoreId} /></div>
          <div className="field"><label>Pesquisar</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="produto, código ou corredor…" /></div>
        </div>
        <div className="muted">Formato sugerido: <strong>Corredor 3 · Prateleira B</strong> — a pesquisa também encontra por localização.</div>
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty"><IconCube size={36} /><p>Sem produtos para os filtros.</p></div> : (
          <table className="ptable stack">
            <thead><tr><th>Produto</th><th>Loja</th><th>Stock</th><th>Localização</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const k = keyOf(r);
                return (
                  <tr key={k}>
                    <td data-label="Produto">{r.name} <span className="muted">({r.code})</span></td>
                    <td data-label="Loja">{r.store_name}</td>
                    <td data-label="Stock">{r.quantity}</td>
                    <td data-label="Localização">
                      <input value={editing[k] ?? r.location ?? ''} placeholder="ex.: Corredor 3 · Prateleira B"
                        onChange={(e) => setEditing((s) => ({ ...s, [k]: e.target.value }))} style={{ width: '100%', maxWidth: 260 }} />
                    </td>
                    <td data-label="">
                      {editing[k] != null && editing[k] !== (r.location ?? '') ? (
                        <button className="btn sm" disabled={busyKey === k} onClick={() => void save(r)}>{busyKey === k ? '…' : 'Guardar'}</button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

// ── 📑 Auditoria por funcionário ─────────────────────────────
function AuditTab() {
  const [filters, setFilters] = useState<AuditFilters | null>(null);
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState(isoMinusDays(30));
  const [to, setTo] = useState(todayISO());
  const [rows, setRows] = useState<AuditTrailRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.inventoryIntel.auditFilters().then(setFilters).catch(() => undefined); }, []);
  const load = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      setRows(await api.inventoryIntel.auditTrail({
        actorId: actorId || undefined, action: action || undefined, from, to,
      }));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar a auditoria.'); }
    finally { setBusy(false); }
  }, [actorId, action, from, to]);
  useEffect(() => { void load(); }, [load]);

  return (
    <>
      <ErrorBanner msg={err} />
      <div className="card no-print" style={{ marginBottom: 12 }}>
        <div className="grid-2">
          <div className="field"><label>Funcionário</label>
            <select value={actorId} onChange={(e) => setActorId(e.target.value)}>
              <option value="">Todos</option>
              {(filters?.actors ?? []).map((a) => a.id ? <option key={a.id} value={a.id}>{a.name || a.id}</option> : null)}
            </select></div>
          <div className="field"><label>Ação</label>
            <select value={action} onChange={(e) => setAction(e.target.value)}>
              <option value="">Todas</option>
              {(filters?.actions ?? []).map((a) => <option key={a} value={a}>{a}</option>)}
            </select></div>
        </div>
        <div className="grid-2">
          <div className="field"><label>De</label><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div className="field"><label>Até</label><input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
        </div>
        {busy ? <span className="muted">A carregar…</span> : null}
      </div>
      <div className="card">
        {rows.length === 0 ? <div className="empty"><IconShield size={36} /><p>Sem eventos para os filtros.</p></div> : (
          <table className="ptable stack">
            <thead><tr><th>Data</th><th>Funcionário</th><th>Ação</th><th>Detalhes</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.seq}>
                  <td data-label="Data">{fmtDT(r.timestamp)}</td>
                  <td data-label="Funcionário">{r.actor_name || '—'}</td>
                  <td data-label="Ação"><span className="pill">{r.action}</span></td>
                  <td data-label="Detalhes" style={{ maxWidth: 420, overflowWrap: 'anywhere', fontSize: 12.5 }}>
                    {r.details ? JSON.stringify(r.details) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
