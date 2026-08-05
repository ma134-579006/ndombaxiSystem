import React, { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Dialog, EmptyState, Skeleton } from '@nexus/ui';
import { api } from '../api/client';
import { formatKz } from '../format';
import { IconReceipt } from './Icons';

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
    <Dialog
      open
      onClose={onClose}
      title={`🍳 Pedidos da cozinha${orders.length ? ` · ${orders.length}` : ''}`}
    >
      {/* Enquanto a primeira leitura não chega, o esqueleto segura o espaço.
          Antes o diálogo abria vazio e só depois saltava com os pedidos. */}
      {!loaded ? (
        <Skeleton lines={3} height={64} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<IconReceipt size={26} />}
          title="Sem pedidos de balcão"
          text="Monta um pedido no caixa e toca em “🍳 Enviar para cozinha” — aparece aqui e podes chamá-lo quando estiver pronto."
        />
      ) : (
        /* A lista muda sozinha de 5 em 5 s: `aria-live` faz com que um pedido
           que fica pronto seja anunciado, em vez de passar despercebido. */
        <div className="nx-stack" aria-live="polite">
          {orders.map((o) => (
            <article
              key={o.id}
              className="nx-card"
              style={{
                padding: 'var(--nx-space-3)',
                gap: 'var(--nx-space-2)',
                borderLeft: `4px solid ${o.ready ? 'var(--nx-c-success)' : 'var(--nx-c-warning)'}`,
              }}
            >
              <div className="nx-row">
                <strong>{o.label}</strong>
                <span className="nx-spacer" />
                <span className="nx-num" style={{ fontWeight: 700 }}>{formatKz(Number(o.total))}</span>
              </div>

              <div className="nx-row">
                <Badge dot tone={o.ready ? 'success' : 'warning'}>
                  {o.ready ? 'Pronto para vender' : `Em preparação${o.etaMin ? ` · ~${o.etaMin} min` : ''}`}
                </Badge>
                <span className="nx-caption">há {o.waitMin} min</span>
              </div>

              <ul className="nx-stack-2" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {o.items.map((it, i) => (
                  <li key={i} className="nx-body-sm">
                    <span className="nx-num">{Number(it.quantity)}×</span> {it.description}
                  </li>
                ))}
              </ul>

              <Button variant="primary" block disabled={!o.ready} onClick={() => onRecall(o)}>
                {o.ready ? 'Chamar ao caixa e vender' : 'Aguarda a cozinha…'}
              </Button>
            </article>
          ))}
        </div>
      )}
    </Dialog>
  );
}
