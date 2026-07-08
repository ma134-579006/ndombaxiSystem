import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { RestaurantKitchenItem } from '../api/types';

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
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0); // força recalcular os tempos

  const load = useCallback(async () => {
    try { setItems(await api.restaurant.kitchen()); } catch { /* mantém o último estado */ }
    finally { setLoaded(true); }
  }, []);

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
    const byOrder = new Map<string, { table: string; orderId: string; items: RestaurantKitchenItem[]; oldest: number }>();
    for (const it of items) {
      const g = byOrder.get(it.order_id) ?? { table: it.table_name ?? 'Mesa', orderId: it.order_id, items: [], oldest: 0 };
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
        <span className="muted" style={{ fontSize: 13 }}>{totalItems ? `${totalItems} item(ns) · ${tickets.length} mesa(s)` : 'atualiza a cada 5 s'}</span>
      </div>

      {loaded && tickets.length === 0 ? (
        <div className="card"><div className="empty" style={{ padding: 40 }}>
          <div style={{ fontSize: 40 }}>🎉</div>
          <p>Sem pedidos na cozinha. Tudo em dia.</p>
          <p className="muted" style={{ fontSize: 12.5 }}>Os itens aparecem aqui quando se lançam numa comanda de mesa.</p>
        </div></div>
      ) : (
        <div className="pgrid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', alignItems: 'start' }}>
          {tickets.map((t) => {
            const tone = t.oldest >= 15 ? 'var(--danger, #e5484d)' : t.oldest >= 8 ? 'var(--warning)' : 'var(--success, #30a46c)';
            return (
              <div key={t.orderId} className="card" style={{ padding: 0, overflow: 'hidden', borderTop: `4px solid ${tone}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', borderBottom: '1px solid var(--border, #0002)' }}>
                  <strong style={{ fontSize: 15 }}>🪑 {t.table}</strong>
                  <span className="spacer" style={{ flex: 1 }} />
                  <span style={{ fontSize: 13, fontWeight: 700, color: tone }}>⏱ {t.oldest} min</span>
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
