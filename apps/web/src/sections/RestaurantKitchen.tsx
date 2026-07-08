import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { toast } from '../components/feedback';
import type { RestaurantKitchenItem, RestaurantOnlineTicket } from '../api/types';

const KITCHEN_LABEL: Record<string, string> = { PENDING: 'Por preparar', PREPARING: 'Em preparação', READY: 'Pronto', SERVED: 'Servido' };
const NEXT: Record<string, string> = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
const NEXT_LABEL: Record<string, string> = { PENDING: 'Iniciar', PREPARING: 'Pronto ✓', READY: 'Servir' };

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

/**
 * COZINHA (KDS) — destino de 1.ª classe do restaurante. Quadro de passe: um
 * bilhete por mesa/comanda, com os itens por preparar/em preparação, o tempo de
 * espera (cor por antiguidade) e botões grandes para avançar o estado. Atualiza
 * sozinho de 5 em 5 s. Consome o mesmo endpoint /restaurant/kitchen (só leitura
 * + avanço de estado; nenhuma lógica de venda/stock tocada).
 */
export function RestaurantKitchen() {
  const [items, setItems] = useState<RestaurantKitchenItem[]>([]);
  const [online, setOnline] = useState<RestaurantOnlineTicket[]>([]);
  const [etaDraft, setEtaDraft] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0); // força recalcular os tempos

  const load = useCallback(async () => {
    try { setItems(await api.restaurant.kitchen()); } catch { /* mantém o último estado */ }
    try { setOnline(await api.restaurant.onlineQueue()); } catch { /* loja pode estar desligada */ }
    finally { setLoaded(true); }
  }, []);

  const giveEta = async (t: RestaurantOnlineTicket) => {
    const m = Math.max(1, Math.min(240, Math.floor(Number(etaDraft[t.id]) || 0)));
    if (!m) { toast.warning('Indica o tempo estimado (min).'); return; }
    try { await api.restaurant.setOnlineEta(t.id, m); toast.success(`Tempo dado à ${t.orderNumber}: ~${m} min.`); await load(); }
    catch { toast.error('Falha ao dar o tempo.'); }
  };
  const markOnlineReady = async (t: RestaurantOnlineTicket) => {
    setOnline((prev) => prev.filter((x) => x.id !== t.id)); // otimista
    await api.restaurant.advanceOnline(t.id, 'READY').catch(() => undefined);
    await load();
  };

  // Cozinha dá o TEMPO ESTIMADO de uma comanda de mesa/balcão.
  const giveTicketEta = async (orderId: string) => {
    const m = Math.max(1, Math.min(240, Math.floor(Number(etaDraft[orderId]) || 0)));
    if (!m) { toast.warning('Indica o tempo estimado (min).'); return; }
    try { await api.restaurant.setOrderEta(orderId, m); toast.success(`Tempo dado: ~${m} min.`); await load(); }
    catch { toast.error('Falha ao dar o tempo.'); }
  };

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000);
    const c = window.setInterval(() => setTick((x) => x + 1), 30000);
    return () => { window.clearInterval(t); window.clearInterval(c); };
  }, [load]);

  const advance = async (it: RestaurantKitchenItem) => {
    const next = NEXT[it.kitchen_status] ?? 'SERVED';
    // Otimista: PENDING→PREPARING fica na lista; READY/SERVED saem (o KDS só
    // mostra por preparar/em preparação). Confirma no servidor e recarrega.
    setItems((prev) => next === 'PREPARING'
      ? prev.map((x) => (x.id === it.id ? { ...x, kitchen_status: next } : x))
      : prev.filter((x) => x.id !== it.id));
    await api.restaurant.itemKitchen(it.id, next).catch(() => undefined);
    await load();
  };

  // Agrupar por comanda (order_id) → bilhetes.
  const tickets = useMemo(() => {
    void tick; // dependência para recalcular tempos
    const byOrder = new Map<string, { table: string; orderId: string; items: RestaurantKitchenItem[]; oldest: number; eta: number | null; isCounter: boolean }>();
    for (const it of items) {
      const g = byOrder.get(it.order_id) ?? { table: it.table_name ?? 'Mesa', orderId: it.order_id, items: [], oldest: 0, eta: it.prep_eta_min ?? null, isCounter: !!it.is_counter };
      g.items.push(it);
      g.oldest = Math.max(g.oldest, minutesSince(it.created_at));
      byOrder.set(it.order_id, g);
    }
    return [...byOrder.values()].sort((a, b) => b.oldest - a.oldest);
  }, [items, tick]);

  const totalItems = items.length;

  return (
    <>
      <div className="content-head">
        <h2>👨‍🍳 Cozinha (KDS)</h2>
        <span className="spacer" />
        <span className="muted" style={{ fontSize: 13 }}>{totalItems || online.length ? `${totalItems} item(ns) · ${tickets.length} mesa(s)${online.length ? ` · ${online.length} online` : ''}` : 'atualiza a cada 5 s'}</span>
      </div>

      {/* ── Encomendas ONLINE (loja) — o cozinheiro dá o tempo e produz ── */}
      {online.length > 0 ? (
        <>
          <h3 style={{ margin: '4px 0 10px', fontSize: 14 }}>🛵 Encomendas online <span className="muted" style={{ fontWeight: 400 }}>· {online.length}</span></h3>
          <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', alignItems: 'start', marginBottom: 18 }}>
            {online.map((t) => {
              const isNew = t.kitchenStatus === 'NEW';
              const tone = t.waitMin >= 15 ? 'var(--danger, #e5484d)' : t.waitMin >= 8 ? 'var(--warning)' : 'var(--primary)';
              return (
                <div key={t.id} className="card" style={{ padding: 0, overflow: 'hidden', borderTop: `4px solid ${tone}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
                    <strong style={{ fontSize: 14 }}>🛵 {t.customerName || 'Cliente'}</strong>
                    <span className="pill on" style={{ fontSize: 10 }}>ONLINE</span>
                    <span className="spacer" style={{ flex: 1 }} />
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>⏱ {t.waitMin}m</span>
                  </div>
                  <div style={{ padding: '4px 14px' }}>
                    <div className="muted" style={{ fontSize: 11.5, marginBottom: 4 }}>{t.orderNumber} · {t.paymentStatus === 'PAID' ? 'Pago ✓' : 'Aguarda pagamento'}</div>
                    {t.items.map((it, i) => (
                      <div key={i} style={{ fontSize: 13.5, padding: '2px 0' }}>{Number(it.quantity)}× {it.description}</div>
                    ))}
                  </div>
                  <div style={{ padding: '10px 14px', borderTop: '1px solid var(--border, #0002)' }}>
                    {isNew ? (
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <input value={etaDraft[t.id] ?? ''} onChange={(e) => setEtaDraft((d) => ({ ...d, [t.id]: e.target.value.replace(/[^\d]/g, '') }))}
                          inputMode="numeric" placeholder="min" style={{ width: 70 }} />
                        <button className="btn sm" onClick={() => void giveEta(t)}>Aceitar · dar tempo</button>
                      </div>
                    ) : (
                      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>👨‍🍳 Em preparação{t.etaMin ? ` · ~${t.etaMin} min` : ''}</span>
                        <button className="btn sm" onClick={() => void markOnlineReady(t)}>Pronto ✓</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <h3 style={{ margin: '4px 0 10px', fontSize: 14 }}>🍽️ Mesas</h3>
        </>
      ) : null}

      {loaded && tickets.length === 0 && online.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: 40 }}>
          <div style={{ fontSize: 40 }}>🎉</div>
          <p>Sem pedidos na cozinha. Tudo em dia.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Aparecem aqui os itens das comandas de mesa e as encomendas da loja online.</p>
        </div></div>
      ) : tickets.length === 0 ? null : (
        <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', alignItems: 'start' }}>
          {tickets.map((t) => {
            const tone = t.oldest >= 15 ? 'var(--danger, #e5484d)' : t.oldest >= 8 ? 'var(--warning)' : 'var(--success, #30a46c)';
            return (
              <div key={t.orderId} className="card" style={{ padding: 0, overflow: 'hidden', borderTop: `4px solid ${tone}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
                  <strong style={{ fontSize: 15 }}>{t.isCounter ? '🛍️' : '🪑'} {t.table}</strong>
                  {t.isCounter ? <span className="pill on" style={{ fontSize: 10 }}>BALCÃO</span> : null}
                  <span className="spacer" style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: tone }}>⏱ {t.oldest} min</span>
                </div>
                {/* Cozinha dá o tempo estimado (útil sobretudo no balcão/takeaway). */}
                <div className="row" style={{ gap: 8, alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
                  {t.eta ? (
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--primary)' }}>⏲ Tempo dado: ~{t.eta} min</span>
                  ) : (
                    <>
                      <input value={etaDraft[t.orderId] ?? ''} onChange={(e) => setEtaDraft((d) => ({ ...d, [t.orderId]: e.target.value.replace(/[^\d]/g, '') }))}
                        inputMode="numeric" placeholder="min" style={{ width: 64 }} />
                      <button className="btn sm ghost" onClick={() => void giveTicketEta(t.orderId)}>Dar tempo</button>
                    </>
                  )}
                </div>
                {t.items.map((it) => (
                  <div key={it.id} className="list-row" style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong style={{ fontSize: 14 }}>{Number(it.quantity)}× {it.description}</strong>
                      <div className="muted" style={{ fontSize: 12 }}>
                        {KITCHEN_LABEL[it.kitchen_status] ?? it.kitchen_status}{it.notes ? ` · ${it.notes}` : ''}
                      </div>
                    </div>
                    <button
                      className={`btn sm${it.kitchen_status === 'PREPARING' ? '' : ' ghost'}`}
                      onClick={() => void advance(it)}
                    >
                      {NEXT_LABEL[it.kitchen_status] ?? 'Servir'}
                    </button>
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
