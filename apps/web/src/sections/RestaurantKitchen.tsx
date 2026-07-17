import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import { confirmDialog, toast } from '../components/feedback';
import type { RestaurantKitchenItem, RestaurantOnlineTicket } from '../api/types';

const KITCHEN_LABEL: Record<string, string> = { PENDING: 'Por preparar', PREPARING: 'Em preparação', READY: 'Pronto', SERVED: 'Servido' };
const NEXT: Record<string, string> = { PENDING: 'PREPARING', PREPARING: 'READY', READY: 'SERVED' };
const NEXT_LABEL: Record<string, string> = { PENDING: 'Iniciar', PREPARING: 'Pronto ✓', READY: 'Servir' };

function minutesSince(iso: string): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

/** Tempo de espera humanizado: "42 min" · "3 h 20" · "9 d". Nunca "13437 min". */
function fmtWait(min: number): string {
  if (min < 60) return `${min} min`;
  if (min < 1440) { const h = Math.floor(min / 60); const m = min % 60; return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`; }
  return `${Math.floor(min / 1440)} d`;
}

/**
 * COZINHA (KDS) — destino de 1.ª classe do restaurante. Quadro de passe: um
 * bilhete por mesa/comanda, com os itens por preparar/em preparação, o tempo de
 * espera (cor por antiguidade) e botões grandes para avançar o estado. Atualiza
 * sozinho de 5 em 5 s. Consome o mesmo endpoint /restaurant/kitchen (só leitura
 * + avanço de estado; nenhuma lógica de venda/stock tocada).
 */
export function RestaurantKitchen({ onGo }: { onGo?: (section: string) => void }) {
  // Manda a cozinheira à PRODUÇÃO (fornadas) e volta em 1 clique. Usa o mesmo
  // deep-link de separador do Centro de Comando (lido no useEffect do Restaurant).
  const goToProduction = () => {
    try { sessionStorage.setItem('ndx_rest_tab', 'producao'); } catch { /* indisponível */ }
    onGo?.('restaurant');
  };
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
    // GATE: "Pronto" avisa a encomenda e liberta o responsável para continuar.
    // Não deve ser clicado sem os pratos estarem MESMO prontos — confirma antes.
    const ok = await confirmDialog({
      message: `Confirmas que a encomenda ${t.orderNumber} (${t.customerName || 'cliente'}) está MESMO pronta? Só depois disto o responsável pode continuar a encomenda.`,
      confirmLabel: 'Sim, está pronta',
    });
    if (!ok) return;
    setOnline((prev) => prev.filter((x) => x.id !== t.id)); // otimista
    await api.restaurant.advanceOnline(t.id, 'READY').catch(() => undefined);
    toast.success(`${t.orderNumber} marcada pronta — responsável notificado.`);
    await load();
  };

  // Cozinha dá o TEMPO ESTIMADO de uma comanda de mesa/balcão.
  const giveTicketEta = async (orderId: string) => {
    const m = Math.max(1, Math.min(240, Math.floor(Number(etaDraft[orderId]) || 0)));
    if (!m) { toast.warning('Indica o tempo estimado (min).'); return; }
    try { await api.restaurant.setOrderEta(orderId, m); toast.success(`Tempo dado: ~${m} min.`); await load(); }
    catch { toast.error('Falha ao dar o tempo.'); }
  };

  // Central de Produção: marca/desmarca um pedido como URGENTE (sobe na fila).
  const toggleUrgent = async (orderId: string, priority: number) => {
    try { await api.restaurant.setPriority(orderId, priority); toast.success(priority ? '🔴 Marcado urgente.' : 'Urgência removida.'); await load(); }
    catch { toast.error('Falha ao mudar a prioridade.'); }
  };

  useEffect(() => {
    void load();
    const t = window.setInterval(load, 5000);
    const c = window.setInterval(() => setTick((x) => x + 1), 30000);
    return () => { window.clearInterval(t); window.clearInterval(c); };
  }, [load]);

  const advance = async (it: RestaurantKitchenItem) => {
    const next = NEXT[it.kitchen_status] ?? 'SERVED';
    // GATE do "Pronto": marcar pronto notifica a comanda/encomenda e liberta
    // quem serve. Confirma antes para não marcar pronto sem estar mesmo pronto.
    if (next === 'READY') {
      const ok = await confirmDialog({
        message: `Confirmas que "${it.description}" está MESMO pronto? Depois disto o pedido é dado como pronto para servir/entregar.`,
        confirmLabel: 'Sim, está pronto',
      });
      if (!ok) return;
    }
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
    const byOrder = new Map<string, { table: string; orderId: string; items: RestaurantKitchenItem[]; oldest: number; eta: number | null; isCounter: boolean; priority: number }>();
    for (const it of items) {
      const g = byOrder.get(it.order_id) ?? { table: it.table_name ?? 'Mesa', orderId: it.order_id, items: [], oldest: 0, eta: it.prep_eta_min ?? null, isCounter: !!it.is_counter, priority: Number(it.priority) || 0 };
      g.items.push(it);
      g.oldest = Math.max(g.oldest, minutesSince(it.created_at));
      g.priority = Math.max(g.priority, Number(it.priority) || 0);
      byOrder.set(it.order_id, g);
    }
    // Central de Produção: URGENTES primeiro, depois por antiguidade.
    return [...byOrder.values()].sort((a, b) => b.priority - a.priority || b.oldest - a.oldest);
  }, [items, tick]);

  const totalItems = items.length;

  return (
    <>
      <div className="content-head">
        <h2>👨‍🍳 Cozinha (KDS)</h2>
        <span className="spacer" />
        {onGo ? <button className="btn sm" onClick={goToProduction} title="Produzir as fornadas e voltar à cozinha num clique">🏭 Ir para produção</button> : null}
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
                    <span style={{ fontSize: 12.5, fontWeight: 700, color: tone }}>⏱ {fmtWait(t.waitMin)}</span>
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
            const urgent = t.priority > 0;
            const tone = urgent ? 'var(--danger, #e5484d)' : t.oldest >= 15 ? 'var(--danger, #e5484d)' : t.oldest >= 8 ? 'var(--warning)' : 'var(--success, #30a46c)';
            return (
              <div key={t.orderId} className="card" style={{ padding: 0, overflow: 'hidden', borderTop: `4px solid ${tone}`, boxShadow: urgent ? '0 0 0 2px var(--danger, #e5484d)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
                  <strong style={{ fontSize: 15 }}>{t.isCounter ? '🛍️' : '🪑'} {t.table}</strong>
                  {t.isCounter ? <span className="pill on" style={{ fontSize: 10 }}>BALCÃO</span> : null}
                  {urgent ? <span className="pill" style={{ fontSize: 10, background: 'var(--danger, #e5484d)', color: '#fff' }}>🔴 URGENTE</span> : null}
                  <span className="spacer" style={{ flex: 1 }} />
                  <button className="btn sm ghost" title={urgent ? 'Remover urgência' : 'Marcar urgente'} onClick={() => void toggleUrgent(t.orderId, urgent ? 0 : 1)}>{urgent ? '↩' : '🔴'}</button>
                  <span style={{ fontSize: 13, fontWeight: 700, color: tone }}>⏱ {fmtWait(t.oldest)}</span>
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
