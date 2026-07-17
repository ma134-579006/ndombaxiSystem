import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ManagerProduct, RecipeIngredient, RestaurantKitchenItem, RestaurantOrderDetail, RestaurantTableMapRow } from '../api/types';
import { confirmDialog, toast } from '../components/feedback';
import { IconPlus, IconSearch, IconTrash } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatKz } from '../format';

const KZ = (n: string | number) => formatKz(Number(n) || 0);
const KITCHEN_LABEL: Record<string, string> = { PENDING: 'Por preparar', PREPARING: 'Em preparação', READY: 'Pronto', SERVED: 'Servido' };
const NEXT: Record<string, string> = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };

/** Restauração: mapa de mesas + comanda (lançar itens, conta) e ecrã de cozinha (KDS). */
export function Restaurant({ onGo }: { onGo?: (section: string) => void }) {
  const [tab, setTab] = useState<'mesas' | 'cozinha' | 'receitas' | 'producao'>('mesas');
  // Deep-link do Centro de Comando: abre no separador pedido. NUM efeito (não no
  // inicializador do useState) — o StrictMode invoca o inicializador 2× e um
  // removeItem lá dentro consumia o valor no 1º e devolvia 'mesas' no 2º (usado).
  useEffect(() => {
    try {
      const t = sessionStorage.getItem('ndx_rest_tab');
      if (t === 'cozinha' || t === 'receitas' || t === 'mesas' || t === 'producao') { setTab(t); sessionStorage.removeItem('ndx_rest_tab'); }
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
    try {
      const id = t.order_id ?? (await api.restaurant.openOrder(t.id)).id;
      setDetail(await api.restaurant.order(id));
      await loadTables();
    } catch (e) { toast.error(e instanceof ApiError ? e.message : 'Falha ao abrir a mesa.'); }
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

  return (
    <>
      <div className="content-head">
        <h2>🍽️ Mesas & Comandas</h2>
        <span className="spacer" />
        <button className="btn ghost" onClick={() => setNewTable(true)}><IconPlus size={16} /> Nova mesa</button>
      </div>

      <div className="seg" style={{ marginBottom: 14, maxWidth: 620 }}>
        <button className={tab === 'mesas' ? 'active' : ''} onClick={() => setTab('mesas')}>Mesas</button>
        <button className={tab === 'cozinha' ? 'active' : ''} onClick={() => setTab('cozinha')}>Cozinha (KDS){kds.length ? ` · ${kds.length}` : ''}</button>
        <button className={tab === 'receitas' ? 'active' : ''} onClick={() => setTab('receitas')}>Receitas</button>
        <button className={tab === 'producao' ? 'active' : ''} onClick={() => setTab('producao')}>Produção</button>
      </div>

      {tab === 'producao' ? <ProductionTab products={products} onProduced={loadProducts} onGo={onGo} /> : tab === 'receitas' ? <RecipesTab products={products} /> : tab === 'mesas' ? (
        tables.length === 0 ? (
          <div className="card"><div className="empty"><p>Sem mesas. Cria a primeira mesa.</p></div></div>
        ) : (
          <div className="pgrid">
            {tables.map((t) => {
              const occupied = !!t.order_id;
              return (
                <button key={t.id} className={`pcard${occupied ? ' sel' : ''}`} onClick={() => void openTable(t)} disabled={busy}
                  style={{ textAlign: 'left', cursor: 'pointer' }}>
                  <div className="thumb" style={{ fontSize: 28, display: 'grid', placeItems: 'center', background: occupied ? 'color-mix(in srgb, var(--warning) 18%, transparent)' : 'color-mix(in srgb, var(--success) 14%, transparent)' }}>
                    {occupied ? '🟠' : '🟢'}
                  </div>
                  <div className="pinfo">
                    <div className="pname">{t.name}</div>
                    <div className="pcode">{t.area ? `${t.area} · ` : ''}{t.seats} lugares</div>
                    <div className="pfoot">
                      {occupied
                        ? <><span className="pprice">{KZ(t.order_total ?? 0)}</span><span className="pill off">Ocupada · {t.opened_at_label}</span></>
                        : <span className="pill on">Livre</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      ) : (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          {kds.length === 0 ? <div className="empty" style={{ padding: 26 }}><p>Sem itens por preparar 🎉</p></div>
            : kds.map((i) => (
              <div key={i.id} className="list-row" style={{ padding: '12px 16px' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ fontSize: 14 }}>{Number(i.quantity)}× {i.description}</strong>
                  <div className="muted" style={{ fontSize: 12.5 }}>{i.table_name ?? 'Mesa'} · {KITCHEN_LABEL[i.kitchen_status] ?? i.kitchen_status}{i.notes ? ` · ${i.notes}` : ''}</div>
                </div>
                <button className="btn sm" onClick={async () => { await api.restaurant.itemKitchen(i.id, NEXT[i.kitchen_status] ?? 'SERVED').catch(() => undefined); await loadKds(); }}>
                  {i.kitchen_status === 'PENDING' ? 'Iniciar' : 'Pronto ✓'}
                </button>
              </div>
            ))}
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
          <div className="pgrid" style={{ maxHeight: '26vh', overflowY: 'auto', marginBottom: 12 }}>
            {filtered.map((p) => (
              <button key={p.id} className="pcard" onClick={() => void addProduct(p.code)} style={{ cursor: 'pointer', textAlign: 'left' }}>
                <div className="pinfo"><div className="pname" style={{ fontSize: 13 }}>{p.name}</div><div className="pcode">{p.code}</div></div>
              </button>
            ))}
          </div>

          <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }}>
            {detail.items.length === 0 ? <div className="empty" style={{ padding: 18 }}><p>Comanda vazia — lança o 1.º item.</p></div>
              : detail.items.map((it) => (
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
          <button className="btn lg block" onClick={() => void closeOrder()} disabled={detail.items.length === 0}>Fechar conta</button>
        </Modal>
      ) : null}

      {newTable ? <NewTableModal onClose={() => setNewTable(false)} onCreated={() => { setNewTable(false); void loadTables(); }} /> : null}
    </>
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
            <div className="pgrid" style={{ maxHeight: '18vh', overflowY: 'auto', marginBottom: 10 }}>
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
          <button className="btn sm" onClick={() => onGo('restaurant-kds')} title="Terminaste a fornada? Volta à cozinha num clique">👨‍🍳 Voltar à cozinha</button>
        </div>
      ) : null}
      <div className="card" style={{ marginBottom: 12 }}>
        <p className="muted" style={{ margin: 0, fontSize: 13, lineHeight: 1.6 }}>
          🥖 <strong>Fornada</strong>: produz em lote para a prateleira (pães, bolos, pratos preparados).
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
                  <div className="thumb" style={{ fontSize: 26, display: 'grid', placeItems: 'center' }}>🥐</div>
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
            <h3 style={{ margin: 0 }}>🥐 {product.name}</h3>
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
              <strong>✓ Última fornada</strong>
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
