import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { formatKz } from '../format';
import { IconClose, IconReceipt } from './Icons';

export type ReadyKitchenOrder = {
  id: string; label: string; total: string; etaMin: number | null; waitMin: number; ready: boolean;
  items: { productCode: string; description: string; unitPrice: string; quantity: string; kitchenStatus: string }[];
};

/**
 * Pedidos de BALCÃO na cozinha — o caixa envia o pedido para a cozinha, a cozinha
 * produz e dá o tempo, e aqui o caixa vê o estado e, quando pronto, CHAMA o pedido
 * ao caixa para o vender (carrega no carrinho). Atualiza sozinho de 5 em 5 s.
 */
export function KitchenOrdersModal({ onClose, onRecall }: { onClose(): void; onRecall(o: ReadyKitchenOrder): void }) {
  const [orders, setOrders] = useState<ReadyKitchenOrder[]>([]);
  const [loaded, setLoaded] = useState(false);
  const load = useCallback(() => {
    api.readyKitchenOrders().then((r) => { setOrders(r); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 520, maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
        <div className="row" style={{ padding: 16, borderBottom: '1px solid var(--border)', gap: 10 }}>
          <IconReceipt size={20} />
          <h2 style={{ margin: 0, fontSize: 18 }}>🍳 Pedidos da cozinha{orders.length ? <span className="muted"> · {orders.length}</span> : null}</h2>
          <span className="spacer" />
          <button className="trash" onClick={onClose} aria-label="Fechar"><IconClose size={22} /></button>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, overflow: 'auto' }}>
          {loaded && orders.length === 0 ? (
            <p className="muted" style={{ textAlign: 'center', padding: 20 }}>
              Sem pedidos de balcão. Monta um pedido no caixa e toca em <strong>“🍳 Enviar para cozinha”</strong> — aparece aqui e podes chamá-lo quando estiver pronto.
            </p>
          ) : orders.map((o) => (
            <div key={o.id} className="card" style={{ padding: 12, borderLeft: `4px solid ${o.ready ? 'var(--success, #30a46c)' : 'var(--warning)'}` }}>
              <div className="row" style={{ alignItems: 'center', gap: 8 }}>
                <strong>{o.label}</strong>
                <span className="spacer" style={{ flex: 1 }} />
                <span style={{ fontWeight: 700 }}>{formatKz(Number(o.total))}</span>
              </div>
              <div className="muted" style={{ fontSize: 12.5, margin: '4px 0' }}>
                {o.ready ? '✅ Pronto para vender' : `👨‍🍳 Em preparação${o.etaMin ? ` · ~${o.etaMin} min` : ''}`} · há {o.waitMin} min
              </div>
              {o.items.map((it, i) => <div key={i} style={{ fontSize: 13 }}>{Number(it.quantity)}× {it.description}</div>)}
              <button className="btn success block" style={{ marginTop: 10 }} disabled={!o.ready} onClick={() => onRecall(o)}>
                {o.ready ? 'Chamar ao caixa e vender' : 'Aguarda a cozinha…'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
