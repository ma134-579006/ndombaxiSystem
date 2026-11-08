import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { IVA_RATE } from '../api/types';
import type { ManagerProduct, RecipeIngredient, RestaurantKitchenItem, RestaurantOrderDetail, RestaurantSalesReport, RestaurantTableMapRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';
import { UiIcon } from '../components/UiIcon';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const KITCHEN_LABEL: Record<string, string> = { PENDING: 'Por preparar', PREPARING: 'Em preparação', READY: 'Pronto', SERVED: 'Servido' };
const NEXT: Record<string, string> = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };

/** Restauração: mapa de mesas + comanda (lançar itens, conta) e ecrã de cozinha (KDS). */
/** Junta linhas iguais da comanda (mesmo prato, preço e estado) numa só, com a quantidade somada; remover tira a última linha do grupo. */
function groupItems<T extends { id: string; description: string; unit_price: string | number; kitchen_status: string; quantity: string | number }>(items: T[]): T[] {
  const out: T[] = [];
  const idx = new Map<string, number>();
  for (const it of items) {
    const k = `${it.description}|${it.unit_price}|${it.kitchen_status}`;
    const i = idx.get(k);
    if (i === undefined) { idx.set(k, out.length); out.push({ ...it }); }
    else out[i] = { ...out[i], id: it.id, quantity: Number(out[i].quantity) + Number(it.quantity) };
  }
  return out;
}

export function Restaurant({ onGo }: { onGo?: (section: string) => void }) {
  const [tab, setTab] = useState<'mesas' | 'cozinha' | 'receitas' | 'producao' | 'relatorios'>('mesas');
  // Deep-link do Centro de Comando: abre no separador pedido. NUM efeito (não no
  // inicializador do useState) — o StrictMode invoca o inicializador 2× e um
  // removeItem lá dentro consumia o valor no 1º e devolvia 'mesas' no 2º (usado).
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('ndx_rest_tab');
      if (t === 'cozinha' || t === 'receitas' || t === 'mesas' || t === 'producao' || t === 'relatorios') { setTab(t); sessionStorage.removeItem('ndx_rest_tab'); }
    } catch { /* sessionStorage indisponível */ }
  }, []);
  const [tables, setTables] = useState<RestaurantTableMapRow[]>([]);
  const [products, setProducts] = useState<ManagerProduct[]>([]);
  const [detail, setDetail] = useState<RestaurantOrderDetail | null>(null);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [newTable, setNewTable] = useState(false);
  const [kds, setKds] = useState<RestaurantKitchenItem[]>([]);

  const loadTables = useCallback(async () => { try { setTables(await api.restaurant.tableMap()); } catch { /* */ } }, []);
  const loadKds = useCallback(async () => { try { setKds(await api.restaurant.kitchen()); } catch { /* */ } }, []);
  const loadProducts = useCallback(() => { void api.products.list().then(setProducts).catch(() => undefined); }, []);
  useEffect(() => { void loadTables(); loadProducts(); }, [loadTables, loadProducts]);
  useEffect(() => {
    if (tab !== 'cozinha') return;
    void loadKds(); const t = window.setInterval(loadKds, 5000); return () => window.clearInterval(t);
  }, [tab, loadKds]);

  const openTable = async (t: RestaurantTableMapRow) => {
    setBusy(true);
    setCancelOpen(false); setCancelReason('');
    try {
      const id = t.order_id ?? (await api.restaurant.openOrder(t.id)).id;
      setDetail(await api.restaurant.order(id));
      await loadTables();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir a mesa.'); }
    finally { setBusy(false); }
  };

  // CANCELAMENTO c/ motivo obrigatório (fatia 6): o motivo + quem cancelou ficam
  // na auditoria (Caixa & Auditoria) e na própria comanda.
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const cancelOrder = async () => {
    if (!detail) return;
    const motivo = cancelReason.trim();
    if (motivo.length < 3) { toast.warning('Indica o motivo do cancelamento (mínimo 3 caracteres).'); return; }
    setBusy(true);
    try {
      await api.restaurant.cancelOrder(detail.order.id, motivo);
      toast.success(`Comanda da ${detail.order.table_name ?? 'mesa'} cancelada — motivo registado na auditoria.`);
      setCancelOpen(false); setCancelReason('');
      setDetail(null);
      await loadTables();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao cancelar a comanda.'); }
    finally { setBusy(false); }
  };
  const refreshDetail = async (id: string) => { setDetail(await api.restaurant.order(id)); await loadTables(); };
  const addProduct = async (code: string) => {
    if (!detail) return;
    try { await api.restaurant.addItem(detail.order.id, code, 1); await refreshDetail(detail.order.id); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao lançar.'); }
  };
  const removeItem = async (itemId: string) => {
    if (!detail) return;
    await api.restaurant.removeItem(itemId).catch(() => undefined);
    await refreshDetail(detail.order.id);
  };
  // FATURAR A COMANDA: emite a fatura a partir dos artigos e fecha-a ligada a ela
  // (antes "Fechar conta" só mudava o estado e a cobrança no caixa ficava à parte).
  const [payOpen, setPayOpen] = useState(false);
  const [payType, setPayType] = useState('CASH');
  const [paying, setPaying] = useState(false);
  const invoiceOrder = async () => {
    if (!detail || paying) return;
    setPaying(true);
    try {
      const r = await api.restaurant.invoiceOrder(detail.order.id, { paymentType: payType });
      toast.success(`Fatura ${r.invoiceNumber} emitida — ${KZ(r.grossTotal)}. Comanda fechada.`);
      setPayOpen(false); setDetail(null); await loadTables();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao faturar.'); }
    finally { setPaying(false); }
  };
  // TRANSFERIR MESA e DIVIDIR CONTA (como na referência).
  const [transferOpen, setTransferOpen] = useState(false);
  const transfer = async (toId: string) => {
    if (!detail) return;
    setBusy(true);
    try {
      const r = await api.restaurant.transferOrder(detail.order.id, toId);
      toast.success(`Comanda transferida para a ${r.tableName}.`);
      setTransferOpen(false); await refreshDetail(detail.order.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao transferir.'); }
    finally { setBusy(false); }
  };
  const [splitOpen, setSplitOpen] = useState(false);
  const [splitQty, setSplitQty] = useState<Record<string, number>>({});
  const splitTotal = detail ? detail.items.reduce((s2, it) => s2 + (splitQty[it.id] ?? 0) * Number(it.unit_price), 0) : 0;
  const doSplit = async () => {
    if (!detail || paying) return;
    const items = Object.entries(splitQty).filter(([, q]) => q > 0).map(([itemId, quantity]) => ({ itemId, quantity }));
    if (!items.length) { toast.warning('Escolha os artigos a pagar.'); return; }
    setPaying(true);
    try {
      const r = await api.restaurant.splitInvoice(detail.order.id, { paymentType: payType, items });
      toast.success(`Fatura ${r.invoiceNumber} emitida — ${KZ(r.grossTotal)}. O resto fica na mesa.`);
      setSplitOpen(false); setSplitQty({}); await refreshDetail(detail.order.id);
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao dividir a conta.'); }
    finally { setPaying(false); }
  };
  /** Consulta de mesa: talão (80 mm) com os artigos e o total — não é fatura. */
  const printCheck = () => {
    if (!detail) return;
    const esc = (x: string) => x.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    const lines = groupItems(detail.items).map((it) => `<tr><td>${Number(it.quantity)}</td><td>${esc(it.description)}</td><td class="r">${KZ(Number(it.unit_price) * Number(it.quantity))}</td></tr>`).join('');
    const w = window.open('', '_blank', 'width=380,height=640');
    if (!w) { toast.warning('Permita janelas para imprimir.'); return; }
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Consulta de mesa</title><style>
      @page{size:80mm auto;margin:0}body{width:72mm;margin:4mm;font:12px/1.35 monospace;color:#000}
      h1{font-size:14px;text-align:center;margin:0 0 6px}p{margin:2px 0;text-align:center}table{width:100%;border-collapse:collapse;margin:8px 0}
      td{padding:2px 0;vertical-align:top}td:first-child{width:22px}.r{text-align:right;white-space:nowrap}hr{border:0;border-top:1px dashed #000}
      .t{display:flex;justify-content:space-between;font-weight:700;font-size:14px}</style></head><body>
      <h1>CONSULTA DE MESA</h1><p>${esc(detail.order.table_name ?? 'Mesa')}</p><p>${new Date().toLocaleString('pt-PT')}</p><hr>
      <table>${lines}</table><hr><div class="t"><span>TOTAL</span><span>${KZ(detail.order.total)}</span></div><hr>
      <p>Este documento não serve de fatura</p><script>window.onload=()=>{window.print();setTimeout(()=>window.close(),300)}<\/script></body></html>`);
    w.document.close();
  };
  const closeOrder = async () => {
    if (!detail) return;
    if (!(await confirmDialog({ message: `Fechar a conta da ${detail.order.table_name}? Total ${KZ(detail.order.total)}.` }))) return;
    await api.restaurant.closeOrder(detail.order.id).catch(() => undefined);
    toast.success('Conta fechada. Cobre no caixa.');
    setDetail(null); await loadTables();
  };

  const filtered = q.trim()
    ? products.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 30)
    : products.slice(0, 24);

  const areas = [...new Set(tables.map((t) => t.area || 'Sala'))];
  const [area, setArea] = useState<string>('ALL');
  const [tableState, setTableState] = useState<'ALL' | 'FREE' | 'BUSY'>('ALL');
  const shownTables = tables.filter((t) => (area === 'ALL' || (t.area || 'Sala') === area)
    && (tableState === 'ALL' || (tableState === 'BUSY' ? !!t.order_id : !t.order_id)));
  const TABS = [['mesas', 'Mesas'], ['cozinha', `Cozinha${kds.length ? ` (${kds.length})` : ''}`], ['receitas', 'Receitas'], ['producao', 'Produção'], ['relatorios', 'Relatórios']] as const;

  return (
    <div className="vd-page">
      <div className="vd-head">
        <p className="vd-crumb"><span style={{ color: 'var(--primary)' }}>Restauração</span><span className="sep">/</span><span>{TABS.find(([k]) => k === tab)?.[1].replace(/ \(\d+\)$/, '')}</span></p>
        <span className="spacer" />
        {tab === 'mesas' ? <button className="vd-btn" onClick={() => setNewTable(true)}><IconPlus size={16} /> Adicionar Mesa</button> : null}
      </div>

      <div className="vd-tabs" role="tablist" aria-label="Restauração">
        {TABS.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'relatorios' ? <ReportsTab /> : tab === 'producao' ? <ProductionTab products={products} onProduced={loadProducts} onGo={onGo} /> : tab === 'receitas' ? <RecipesTab products={products} /> : tab === 'mesas' ? (
        <>
          <div className="vd-card vd-filters">
            <div className="vd-frow" style={{ alignItems: 'center' }}>
              <div className="vd-seg" role="tablist" aria-label="Sala">
                <button type="button" className={area === 'ALL' ? 'on' : ''} aria-selected={area === 'ALL'} onClick={() => setArea('ALL')}>Todas as salas</button>
                {areas.map((a) => <button key={a} type="button" className={area === a ? 'on' : ''} aria-selected={area === a} onClick={() => setArea(a)}>{a}</button>)}
              </div>
              <div className="vd-seg" role="tablist" aria-label="Estado">
                {([['ALL', 'Todas'], ['FREE', 'Livres'], ['BUSY', 'Ocupadas']] as const).map(([k, l]) => (
                  <button key={k} type="button" className={tableState === k ? 'on' : ''} aria-selected={tableState === k} onClick={() => setTableState(k)}>{l}</button>
                ))}
              </div>
              <span className="spacer" />
              <div className="vd-sum">
                <span>Livres <b>{tables.filter((t) => !t.order_id).length}</b></span>
                <span>Ocupadas <b>{tables.filter((t) => !!t.order_id).length}</b></span>
                <span>Em aberto <b>{KZ(tables.reduce((sum, t) => sum + Number(t.order_total ?? 0), 0))}</b></span>
              </div>
            </div>
          </div>
          {shownTables.length === 0 ? (
            <div className="vd-card"><div className="vd-empty">{tables.length === 0 ? 'Ainda não há mesas.' : 'Sem mesas.'}</div></div>
          ) : (
            <div className="vd-card">
              <div className="rt-grid vd-tables">
                {shownTables.map((t) => {
                  const occupied = !!t.order_id;
                  return (
                    <button key={t.id} className={`rt-table${occupied ? ' busy' : ' free'}`} onClick={() => void openTable(t)} disabled={busy}
                      aria-label={`${t.name} — ${occupied ? 'ocupada' : 'livre'}`}>
                      <div className="rt-top">
                        <span className="rt-num">{(t.code && t.code !== t.name ? t.code : t.name.replace(/\D+/g, '')) || t.name.slice(0, 3)}</span>
                        <span className="rt-state">{occupied ? 'Ocupada' : 'Livre'}</span>
                      </div>
                      <div className="rt-name">{t.name}</div>
                      <div className="rt-meta">
                        <UiIcon e="users" size={14} /> {occupied && t.guests ? `${t.guests}/${t.seats}` : `${t.seats} lugares`}
                        {t.area ? <span className="rt-area">· {t.area}</span> : null}
                      </div>
                      <div className="rt-foot">
                        {occupied
                          ? <><span className="rt-total">{KZ(t.order_total ?? 0)}</span><span className="rt-time"><UiIcon e="clock" size={13} /> {t.opened_at_label}</span></>
                          : <span className="rt-open">Abrir mesa</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      ) : (
        <div className="vd-card vd-tablecard">
          <div className="vd-tbar"><span>{kds.length} por preparar</span></div>
          {kds.length === 0 ? <div className="vd-empty">Sem pedidos por preparar.</div> : (
            <div className="vd-tablewrap">
              <table className="vd-table">
                <thead><tr><th className="num">Qtd.</th><th>Artigo</th><th>Mesa</th><th>Notas</th><th className="ctr">Estado</th><th aria-label="Ação" /></tr></thead>
                <tbody>
                  {kds.map((i) => (
                    <tr key={i.id}>
                      <td className="num"><b>{Number(i.quantity)}</b></td>
                      <td><strong>{i.description}</strong></td>
                      <td>{i.table_name ?? 'Balcão'}</td>
                      <td>{i.notes || '—'}</td>
                      <td className="ctr"><span className={`vd-badge${i.kitchen_status === 'PENDING' ? ' warn' : ''}`}>{KITCHEN_LABEL[i.kitchen_status] ?? i.kitchen_status}</span></td>
                      <td className="num">
                        <button className="vd-btn sm" onClick={async () => { await api.restaurant.itemKitchen(i.id, NEXT[i.kitchen_status] ?? 'SERVED').catch(() => undefined); await loadKds(); }}>
                          {i.kitchen_status === 'PENDING' ? 'Iniciar' : i.kitchen_status === 'PREPARING' ? 'Pronto' : 'Servido'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Comanda da mesa */}
      {detail ? (
        <Modal title={`Comanda — ${detail.order.table_name ?? 'Mesa'}`} onClose={() => setDetail(null)}>
          <div className="card" style={{ padding: '2px 12px', marginBottom: 10 }}>
            <div className="row"><IconSearch size={18} />
              <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '11px 0', color: 'var(--text)' }}
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar prato/produto para lançar…" />
            </div>
          </div>
          <div className="rt-menu">
            {filtered.map((p) => (
              <button key={p.id} className="rt-dish" onClick={() => void addProduct(p.code)} title={`Lançar ${p.name}`}>
                <span className="rt-dish-name">{p.name}</span>
                <span className="rt-dish-price">{KZ(Number(p.unit_price) * (1 + (IVA_RATE[p.iva_code] ?? 0) / 100))}</span>
                <span className="rt-dish-add" aria-hidden="true"><IconPlus size={14} /></span>
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            {detail.items.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Comanda vazia — lança o 1.º item.</p></div>
              : groupItems(detail.items).map((it) => (
                <div key={it.id} className="list-row" style={{ padding: '10px 14px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong style={{ fontSize: 13.5 }}>{Number(it.quantity)}× {it.description}</strong>
                    <div className="muted" style={{ fontSize: 12 }}>{KZ(it.unit_price)} · {KITCHEN_LABEL[it.kitchen_status] ?? it.kitchen_status}</div>
                  </div>
                  <span style={{ fontWeight: 700, marginRight: 8 }}>{KZ(Number(it.unit_price) * Number(it.quantity))}</span>
                  <button className="btn sm ghost" onClick={() => void removeItem(it.id)} title="Remover"><IconTrash size={14} /></button>
                </div>
              ))}
          </div>

          <div className="row" style={{ alignItems: 'center', marginBottom: 12 }}>
            <strong style={{ fontSize: 16 }}>Total</strong><span className="spacer" style={{ flex: 1 }} />
            <strong style={{ fontSize: 20 }}>{KZ(detail.order.total)}</strong>
          </div>
          {cancelOpen ? (
            <div className="card" style={{ marginBottom: 4, border: '1px solid var(--danger)' }}>
              <div className="field" style={{ marginBottom: 8 }}>
                <label>Motivo do cancelamento (obrigatório — fica na auditoria)</label>
                <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} autoFocus
                  placeholder="ex.: cliente desistiu, lançamento errado, mesa duplicada…" />
              </div>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn danger" style={{ flex: 1 }} onClick={() => void cancelOrder()} disabled={busy}>
                  {busy ? 'A cancelar…' : 'Confirmar cancelamento'}
                </button>
                <button className="btn ghost" onClick={() => { setCancelOpen(false); setCancelReason(''); }}>Voltar</button>
              </div>
            </div>
          ) : (
            <div className="rt-actions">
              {payOpen ? (
                <>
                  <select aria-label="Meio de pagamento" value={payType} onChange={(e) => setPayType(e.target.value)} style={{ flex: 1 }}>
                    <option value="CASH">Numerário</option>
                    <option value="CARD">Multicaixa (TPA)</option>
                    <option value="TRANSFER">Transferência</option>
                    <option value="EXPRESS">Multicaixa Express</option>
                    <option value="REFERENCE">Referência</option>
                  </select>
                  <button className="btn lg" onClick={() => void invoiceOrder()} disabled={paying}>{paying ? 'A faturar…' : `Faturar ${KZ(detail.order.total)}`}</button>
                </>
              ) : (
                <button className="btn lg rt-pay" onClick={() => setPayOpen(true)} disabled={detail.items.length === 0}>Faturar e fechar</button>
              )}
              <button className="btn ghost" onClick={() => void closeOrder()} disabled={detail.items.length === 0} title="Fechar sem faturar aqui (cobrança no caixa)">Fechar (cobrar no caixa)</button>
              <button className="btn ghost" onClick={() => setCancelOpen(true)} title="Cancelar a comanda com motivo (auditado)">Cancelar comanda</button>
            </div>
          )}
          {!cancelOpen ? (
            <div className="row" style={{ gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              <button className="vd-btn outline sm" onClick={printCheck} disabled={detail.items.length === 0}>Consulta de mesa</button>
              <button className="vd-btn outline sm" onClick={() => { setTransferOpen((v) => !v); setSplitOpen(false); }}>Transferir mesa</button>
              <button className="vd-btn outline sm" onClick={() => { setSplitOpen((v) => !v); setTransferOpen(false); setSplitQty({}); }} disabled={detail.items.length === 0}>Dividir conta</button>
            </div>
          ) : null}
          {transferOpen ? (
            <div className="vd-card" style={{ marginTop: 10 }}>
              <div className="vd-lbl" style={{ marginBottom: 8 }}>Mesa de destino</div>
              {tables.some((t) => !t.order_id) ? (
                <div className="vd-seg" style={{ flexWrap: 'wrap' }}>
                  {tables.filter((t) => !t.order_id).map((t) => <button key={t.id} type="button" onClick={() => void transfer(t.id)} disabled={busy}>{t.name}</button>)}
                </div>
              ) : <div className="vd-empty">Sem mesas livres.</div>}
            </div>
          ) : null}
          {splitOpen ? (
            <div className="vd-card" style={{ marginTop: 10 }}>
              <table className="vd-table">
                <thead><tr><th>Artigo</th><th className="num">Na mesa</th><th className="num">Pagar agora</th></tr></thead>
                <tbody>
                  {detail.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.description}<span className="sub">{KZ(it.unit_price)}</span></td>
                      <td className="num">{Number(it.quantity)}</td>
                      <td className="num">
                        <input className="vd-in" style={{ width: 70, textAlign: 'right' }} inputMode="decimal" value={splitQty[it.id] ?? ''} placeholder="0"
                          onChange={(e) => { const v = Math.min(Number(it.quantity), Math.max(0, Number(e.target.value.replace(',', '.')) || 0)); setSplitQty({ ...splitQty, [it.id]: v }); }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="row" style={{ gap: 8, marginTop: 10, alignItems: 'center' }}>
                <select aria-label="Meio de pagamento" value={payType} onChange={(e) => setPayType(e.target.value)} style={{ flex: 1 }}>
                  <option value="CASH">Numerário</option><option value="CARD">Multicaixa (TPA)</option><option value="TRANSFER">Transferência</option>
                  <option value="EXPRESS">Multicaixa Express</option><option value="REFERENCE">Referência</option>
                </select>
                <button className="vd-btn" onClick={() => void doSplit()} disabled={paying || splitTotal <= 0}>{paying ? 'A faturar…' : `Faturar ${KZ(splitTotal)}`}</button>
              </div>
            </div>
          ) : null}
        </Modal>
      ) : null}

      {newTable ? <NewTableModal onClose={() => setNewTable(false)} onCreated={() => { setNewTable(false); void loadTables(); }} /> : null}
    </div>
  );
}

/** Fichas técnicas: define os ingredientes (do stock) que cada prato consome. */
function RecipesTab({ products }: { products: ManagerProduct[] }) {
  const [dishId, setDishId] = useState('');
  const [rows, setRows] = useState<{ ingredientCode: string; quantity: string; wastePct: string }[]>([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  // Ingredientes (matéria-prima) — lista separada dos pratos vendíveis.
  const [ingredients, setIngredients] = useState<ManagerProduct[]>([]);
  useEffect(() => { void api.products.ingredients().then(setIngredients).catch(() => setIngredients([])); }, []);
  const dish = products.find((p) => p.id === dishId);
  const loadRecipe = useCallback(async (id: string) => {
    try {
      const r: RecipeIngredient[] = await api.restaurant.recipe(id);
      setRows(r.map((x) => ({
        ingredientCode: x.ingredient_code,
        quantity: String(Number(x.quantity)),
        wastePct: Number(x.waste_pct ?? 0) > 0 ? String(Number(x.waste_pct)) : '',
      })));
    } catch { setRows([]); }
  }, []);
  useEffect(() => { if (dishId) void loadRecipe(dishId); else setRows([]); }, [dishId, loadRecipe]);

  const addIngredient = (code: string) => {
    if (rows.some((r) => r.ingredientCode === code)) return;
    setRows([...rows, { ingredientCode: code, quantity: '1', wastePct: '' }]);
  };
  const save = async () => {
    if (!dishId) { toast.warning('Escolha o prato.'); return; }
    setBusy(true);
    try {
      await api.restaurant.setRecipe(dishId, rows.map((r) => ({
        ingredientCode: r.ingredientCode,
        quantity: Number(r.quantity) || 0,
        wastePct: Math.min(90, Math.max(0, Number(r.wastePct) || 0)),
      })).filter((r) => r.quantity > 0));
      toast.success('Receita guardada. O stock dos ingredientes baixa ao fechar a comanda.');
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao guardar.'); } finally { setBusy(false); }
  };
  const nameOf = (code: string) => ingredients.find((p) => p.code === code)?.name ?? products.find((p) => p.code === code)?.name ?? code;
  // Unidade de medida do ingrediente (kg, g, ml, fatia…) — mostra ao lado da quantidade.
  const unitOf = (code: string) => ingredients.find((p) => p.code === code)?.unit ?? products.find((p) => p.code === code)?.unit ?? null;
  const ingFiltered = q.trim() ? ingredients.filter((p) => p.id !== dishId && `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 16) : [];

  const recompute = async () => {
    try { await api.restaurant.recomputeCosts(); toast.success('Custos das fichas técnicas recalculados.'); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha.'); }
  };
  return (
    <>
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="row" style={{ alignItems: 'flex-end', gap: 10 }}>
          <div className="field" style={{ flex: 1, margin: 0 }}><label>Prato (produto de produção)</label>
            <select value={dishId} onChange={(e) => setDishId(e.target.value)}>
              <option value="">— escolher prato —</option>
              {/* Ficha técnica só para produtos de PRODUÇÃO (ou que já tenham receita,
                  para não perder fichas existentes). Ative "Produção" no produto. */}
              {products.filter((p) => p.is_production || p.has_recipe).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.code})</option>)}
            </select></div>
          <button className="btn ghost sm" onClick={() => void recompute()} title="Recalcular o custo dos pratos a partir do custo atual dos ingredientes">↻ Recalcular custos</button>
        </div>
        <p className="muted" style={{ fontSize: 12, margin: '8px 0 0' }}>O custo do prato = soma do custo dos ingredientes. Ao vender no caixa, baixa o stock dos ingredientes e o lucro = preço − custo da ficha técnica.</p>
      </div>
      {dish ? (
        <>
          <div className="card" style={{ padding: '2px 12px', marginBottom: 8 }}>
            <div className="row"><IconSearch size={18} /><input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '10px 0', color: 'var(--text)' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar ingrediente (do stock)…" /></div>
          </div>
          {ingFiltered.length > 0 ? (
            <div className="pgrid" style={{ maxHeight: 'calc(18vh / var(--uz, 1))', overflowY: 'auto', marginBottom: 10 }}>
              {ingFiltered.map((p) => (
                <button key={p.id} className="pcard" onClick={() => addIngredient(p.code)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                  <div className="pinfo"><div className="pname" style={{ fontSize: 13 }}>{p.name}</div><div className="pcode">{p.code}{p.unit ? ` · ${p.unit}` : ''}</div></div>
                </button>
              ))}
            </div>
          ) : null}
          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            {rows.length === 0 ? <div className="empty" style={{ padding: 16 }}><p>Sem ingredientes. Procura e adiciona acima.</p></div>
              : rows.map((r, i) => (
                <div key={r.ingredientCode} className="list-row" style={{ padding: '8px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{nameOf(r.ingredientCode)}</span>
                  <input value={r.quantity} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setRows(rows.map((x, j) => j === i ? { ...x, quantity: v } : x)); }} inputMode="decimal" style={{ width: 80 }} />
                  {unitOf(r.ingredientCode) ? <span className="muted" style={{ fontSize: 12.5, minWidth: 34 }}>{unitOf(r.ingredientCode)}</span> : null}
                  {/* Quebra/desperdício %: aparas, encolhimento — consumo e custo reais = qtd × (1+q%) */}
                  <input value={r.wastePct} onChange={(e) => { const v = e.target.value.replace(/[^\d.]/g, ''); setRows(rows.map((x, j) => j === i ? { ...x, wastePct: v } : x)); }}
                    inputMode="decimal" placeholder="0" title="Quebra/desperdício em % (aparas, encolhimento)" style={{ width: 56 }} />
                  <span className="muted" style={{ fontSize: 12.5 }}>% quebra</span>
                  <button className="btn sm ghost" onClick={() => setRows(rows.filter((_, j) => j !== i))}><IconTrash size={14} /></button>
                </div>
              ))}
          </div>
          <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A guardar…' : 'Guardar receita'}</button>
        </>
      ) : <div className="card"><div className="empty"><p>Escolhe um prato para definir a ficha técnica.</p></div></div>}
    </>
  );
}

/**
 * PRODUÇÃO (fornada) — padaria/pastelaria/produção em lote. Escolhe um produto
 * com ficha técnica, vê os ingredientes que a fornada consome (com quebra) e o
 * máximo produzível com o stock atual, e regista a fornada: consome os
 * ingredientes e dá entrada do produto acabado ao custo real (CMP). Nativo do
 * restaurante — não é o ecrã de produtos do retalho.
 */
function ProductionTab({ products, onProduced, onGo }: { products: ManagerProduct[]; onProduced?(): void; onGo?: (section: string) => void }) {
  const [ingredients, setIngredients] = useState<ManagerProduct[]>([]);
  const [productId, setProductId] = useState('');
  const [recipe, setRecipe] = useState<RecipeIngredient[]>([]);
  const [qty, setQty] = useState('1');
  const [note, setNote] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ produced: number; unitCost: number; costPrice: number; stockAfter: number } | null>(null);

  const loadIngredients = useCallback(() => { void api.products.ingredients().then(setIngredients).catch(() => setIngredients([])); }, []);
  useEffect(() => { loadIngredients(); }, [loadIngredients]);
  useEffect(() => { if (productId) void api.restaurant.recipe(productId).then(setRecipe).catch(() => setRecipe([])); else setRecipe([]); }, [productId]);
  // SELEÇÃO AUTOMÁTICA vinda da Cozinha (fornada obrigatória): o KDS deixa o id
  // do produto em falta no sessionStorage — ao abrir, fica logo selecionado.
  // Lido num efeito dependente de products (a lista chega async; StrictMode-safe).
  useEffect(() => {
    try {
      const pid = sessionStorage.getItem('ndx_rest_prod');
      if (pid && products.some((p) => p.id === pid)) {
        setProductId(pid);
        setLast(null);
        sessionStorage.removeItem('ndx_rest_prod');
      }
    } catch { /* indisponível */ }
  }, [products]);

  const producibles = products.filter((p) => p.has_recipe);
  const product = products.find((p) => p.id === productId);
  const filtered = q.trim()
    ? producibles.filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 18)
    : producibles.slice(0, 18);

  const ingOf = (code: string) => ingredients.find((i) => i.code === code);
  const rows = recipe.map((r) => {
    const per = Number(r.quantity) * (1 + (Number(r.waste_pct) || 0) / 100);
    const ing = ingOf(r.ingredient_code);
    const stock = Number(ing?.stock_qty ?? 0);
    return { name: r.ingredient_name, per, stock, unit: r.ingredient_unit ?? ing?.unit ?? '', max: per > 0 ? Math.floor(stock / per) : Infinity };
  });
  const maxProducible = rows.length ? Math.min(...rows.map((r) => r.max)) : 0;
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  const enough = n > 0 && n <= maxProducible;

  const produce = async () => {
    if (!product) { toast.warning('Escolhe o produto a produzir.'); return; }
    if (n <= 0) { toast.warning('Indica a quantidade da fornada.'); return; }
    setBusy(true);
    try {
      const r = await api.products.produce({ productCode: product.code, quantity: n, note: note.trim() || undefined });
      setLast(r);
      setNote('');
      toast.success(`Fornada registada: ${r.produced}× ${product.name} · custo unit. ${KZ(r.unitCost)} · em stock ${r.stockAfter}.`);
      loadIngredients();
      onProduced?.(); // atualiza o stock de prateleira no KPI (produtos do pai)
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao registar a fornada.'); }
    finally { setBusy(false); }
  };

  return (
    <>
      {onGo ? (
        <div className="row" style={{ marginBottom: 10 }}>
          <span className="spacer" style={{ flex: 1 }} />
          <button className="btn sm" onClick={() => onGo('restaurant-kds')} title="Terminaste a fornada? Volta à cozinha num clique">Voltar à cozinha</button>
        </div>
      ) : null}
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          <strong>Fornada</strong>: produz em lote para a prateleira (pães, bolos, pratos preparados).
          Consome os ingredientes da ficha técnica (com quebra) e dá entrada do produto acabado ao custo real.
          A partir daí o balcão vende da prateleira.
        </p>
      </div>

      {!product ? (
        <>
          <div className="card" style={{ padding: '2px 12px', marginBottom: 10 }}>
            <div className="row"><IconSearch size={18} />
              <input style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '11px 0', color: 'var(--text)' }}
                value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar produto a produzir (com ficha técnica)…" />
            </div>
          </div>
          {producibles.length === 0 ? (
            <div className="card"><div className="empty"><p>Nenhum produto tem ficha técnica ainda. Define receitas no separador <strong>Receitas</strong> para poder produzir.</p></div></div>
          ) : (
            <div className="pgrid">
              {filtered.map((p) => (
                <button key={p.id} className="pcard" onClick={() => { setProductId(p.id); setLast(null); }} style={{ cursor: 'pointer', textAlign: 'left' }}>
                  <div className="thumb ui-thumb"><UiIcon e="layers" size={24} /></div>
                  <div className="pinfo">
                    <div className="pname" style={{ fontSize: 13.5 }}>{p.name}</div>
                    <div className="pcode">{p.code}</div>
                    <div className="pfoot"><span className="pill on">{Number(p.stock_qty) > 0 ? `${Number(p.stock_qty)} na prateleira` : 'Sob encomenda'}</span></div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="content-head" style={{ marginTop: 0 }}>
            <h3 style={{ margin: 0 }}>{product.name}</h3>
            <span className="spacer" />
            <button className="btn ghost sm" onClick={() => { setProductId(''); setQ(''); }}>← Escolher outro</button>
          </div>

          <div className="kpi-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div className="card" style={{ padding: '10px 12px' }}><div className="muted" style={{ fontSize: 12 }}>Na prateleira</div><div style={{ fontSize: 20, fontWeight: 800 }}>{Number(product.stock_qty)}</div></div>
            <div className="card" style={{ padding: '10px 12px' }}><div className="muted" style={{ fontSize: 12 }}>Máx. produzível agora</div><div style={{ fontSize: 20, fontWeight: 800, color: maxProducible > 0 ? 'var(--text)' : 'var(--warning)' }}>{Number.isFinite(maxProducible) ? maxProducible : '—'}</div><div className="muted" style={{ fontSize: 11 }}>com o stock de ingredientes</div></div>
            <div className="card" style={{ padding: '10px 12px' }}><div className="muted" style={{ fontSize: 12 }}>Custo atual (ficha)</div><div style={{ fontSize: 20, fontWeight: 800 }}>{KZ(product.cost_price)}</div></div>
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            <div className="list-row" style={{ padding: '8px 14px', fontWeight: 700, fontSize: 12.5, opacity: 0.7 }}>
              <span style={{ flex: 1 }}>Ingrediente</span><span style={{ width: 90, textAlign: 'right' }}>Por fornada</span><span style={{ width: 90, textAlign: 'right' }}>Em stock</span>
            </div>
            {rows.length === 0 ? <div className="empty" style={{ padding: 16 }}><p>A carregar a ficha técnica…</p></div>
              : rows.map((r, i) => {
                const need = r.per * n;
                const short = need > r.stock;
                return (
                  <div key={i} className="list-row" style={{ padding: '8px 14px' }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 13.5 }}>{r.name}</span>
                    <span style={{ width: 90, textAlign: 'right', fontSize: 13, color: short ? 'var(--warning)' : 'var(--text)' }}>{Math.round(need * 1000) / 1000} {r.unit}</span>
                    <span style={{ width: 90, textAlign: 'right', fontSize: 13 }} className="muted">{Math.round(r.stock * 1000) / 1000} {r.unit}</span>
                  </div>
                );
              })}
          </div>

          <div className="row" style={{ alignItems: 'flex-end', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0, width: 120 }}><label>Quantidade</label>
              <input value={qty} onChange={(e) => setQty(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" /></div>
            <div className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}><label>Nota (opcional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="ex.: fornada da manhã" /></div>
          </div>
          {n > maxProducible ? <div className="banner warn" style={{ marginBottom: 10 }}>Ingredientes insuficientes para {n} — máximo agora: {Number.isFinite(maxProducible) ? maxProducible : 0}.</div> : null}
          <button className="btn lg block" onClick={() => void produce()} disabled={busy || !enough}>{busy ? 'A produzir…' : `Registar fornada de ${n || 0}`}</button>

          {last ? (
            <div className="card" style={{ marginTop: 12, borderLeft: '4px solid var(--success)' }}>
              <strong>Última fornada</strong>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {last.produced}× produzido(s) · custo unitário {KZ(last.unitCost)} · custo médio agora {KZ(last.costPrice)} · em stock {last.stockAfter}.
              </div>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

function NewTableModal({ onClose, onCreated }: { onClose(): void; onCreated(): void }) {
  const [name, setName] = useState('');
  const [area, setArea] = useState('');
  const [seats, setSeats] = useState('4');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!name.trim()) { toast.warning('Indique o nome da mesa.'); return; }
    setBusy(true);
    try { await api.restaurant.createTable({ name: name.trim(), area: area.trim() || undefined, seats: Number(seats) || 4 }); toast.success('Mesa criada.'); onCreated(); }
    catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao criar a mesa.'); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Nova mesa" onClose={onClose}>
      <div className="field"><label>Nome</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex.: Mesa 1" /></div>
      <div className="grid-2">
        <div className="field"><label>Área (opcional)</label><input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Salão / Esplanada" /></div>
        <div className="field"><label>Lugares</label><input value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} inputMode="numeric" /></div>
      </div>
      <button className="btn lg block" onClick={() => void save()} disabled={busy}>{busy ? 'A criar…' : 'Criar mesa'}</button>
    </Modal>
  );
}

/** RELATÓRIOS — vendas comerciais vs PRODUÇÃO (receita, margem, top produtos).
 *  Só leitura (GET /restaurant/reports); a margem usa o custo congelado na venda. */
function ReportsTab() {
  const [days, setDays] = useState(7);
  const [rep, setRep] = useState<RestaurantSalesReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    api.restaurant.report(days)
      .then((r) => { if (alive) setRep(r); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Falha ao carregar o relatório.'); });
    return () => { alive = false; };
  }, [days]);

  const Group = ({ title, icon, g, accent }: { title: string; icon: string; g: RestaurantSalesReport['commercial']; accent: string }) => (
    <div className="card" style={{ flex: '1 1 260px', borderTop: `3px solid ${accent}` }}>
      <h3 className="ui-h3" style={{ margin: '0 0 10px' }}><UiIcon e={icon} size={18} /> {title}</h3>
      <div className="kpi-grid" style={{ gridTemplateColumns: '1fr 1fr', margin: 0 }}>
        <div className="kpi-card"><div className="kpi-label">Receita</div>
          <div className="kpi-value" style={{ fontSize: 19 }}>{KZ(g.revenue)}</div>
          <div className="kpi-sub">{g.qty} un. · {g.lines} linha(s)</div></div>
        <div className="kpi-card"><div className="kpi-label">Margem</div>
          <div className="kpi-value" style={{ fontSize: 19, color: g.margin < 0 ? 'var(--danger)' : 'var(--success)' }}>{KZ(g.margin)}</div>
          <div className="kpi-sub">{g.marginPct}% · custo {KZ(g.cost)}</div></div>
      </div>
      {g.top.length > 0 ? (
        <div style={{ marginTop: 10 }}>
          <div className="muted" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>Mais vendidos</div>
          {g.top.map((t, i) => (
            <div key={i} className="row" style={{ justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid var(--border-soft, #0001)', fontSize: 13.5 }}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.description}</span>
              <span className="muted" style={{ flex: 'none', marginLeft: 8 }}>{t.qty}× · {KZ(t.revenue)}</span>
            </div>
          ))}
        </div>
      ) : <p className="muted" style={{ fontSize: 13, marginTop: 10 }}>Sem vendas no período.</p>}
    </div>
  );

  return (
    <>
      <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        {[{ d: 1, l: 'Hoje' }, { d: 7, l: '7 dias' }, { d: 30, l: '30 dias' }].map((o) => (
          <button key={o.d} className={`btn sm${days === o.d ? '' : ' ghost'}`} onClick={() => setDays(o.d)}>{o.l}</button>
        ))}
        <span className="spacer" style={{ flex: 1 }} />
        {rep ? <span className="muted" style={{ fontSize: 12.5, alignSelf: 'center' }}>Faturado nos últimos {rep.days === 1 ? 'hoje' : `${rep.days} dias`} · comercial + produção = total</span> : null}
      </div>
      {err ? <div className="banner danger">{err}</div> : !rep ? (
        <div className="card"><p className="muted" style={{ margin: 0 }}>A carregar o relatório…</p></div>
      ) : (
        <div className="row" style={{ gap: 12, alignItems: 'stretch', flexWrap: 'wrap' }}>
          <Group title="Comercial (revenda)" icon="🛒" g={rep.commercial} accent="var(--primary)" />
          <Group title="Produção (fabricado)" icon="🏭" g={rep.production} accent="var(--warning)" />
        </div>
      )}
    </>
  );
}
