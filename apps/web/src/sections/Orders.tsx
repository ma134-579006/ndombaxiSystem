import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OrderStatus, WebOrder, WebOrderDetail } from '../api/types';
import { IconTruck } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatDate, formatKz, statusLabel } from '../format';

const FILTERS: { key: '' | OrderStatus; label: string }[] = [
  { key: '', label: 'Todas' },
  { key: 'PENDING', label: 'Pendentes' },
  { key: 'PAID', label: 'Pagas' },
  { key: 'SHIPPED', label: 'Expedidas' },
  { key: 'DELIVERED', label: 'Entregues' },
];

const STATUS_TONE: Record<string, string> = {
  PENDING: 'var(--warning)',
  PAID: 'var(--primary)',
  SHIPPED: 'var(--violet, #a855f7)',
  DELIVERED: 'var(--success)',
  CANCELLED: 'var(--muted)',
};

function OrderBadge({ status }: { status: string }) {
  const color = STATUS_TONE[status] ?? 'var(--muted)';
  return (
    <span className="badge" style={{ color, borderColor: color }}>
      <span className="dot" /> {statusLabel(status)}
    </span>
  );
}

export function Orders() {
  const [orders, setOrders] = useState<WebOrder[]>([]);
  const [filter, setFilter] = useState<'' | OrderStatus>('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [detail, setDetail] = useState<WebOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setOrders(await api.orders.list());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao carregar encomendas.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setDetailLoading(true);
    setActionError(null);
    try {
      setDetail(await api.orders.get(id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Falha ao abrir a encomenda.');
    } finally {
      setDetailLoading(false);
    }
  };

  const act = async (fn: () => Promise<unknown>) => {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      await fn();
      const fresh = await api.orders.get(detail.id);
      setDetail(fresh);
      await load();
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : 'A operação falhou.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = filter ? orders.filter((o) => o.status === filter) : orders;

  return (
    <>
      <div className="content-head">
        <h2>Encomendas online</h2>
        <span className="spacer" />
        <div className="wrapcols" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {FILTERS.map((f) => (
            <button key={f.label} className={`chip${filter === f.key ? ' active' : ''}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <div className="banner danger">{error}</div> : null}

      <div className="card">
        {loading ? (
          <div className="loading">A carregar encomendas…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            <IconTruck size={40} />
            <p>Sem encomendas neste filtro.</p>
          </div>
        ) : (
          filtered.map((o) => (
            <div className="list-row" key={o.id} style={{ cursor: 'pointer' }} onClick={() => open(o.id)}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15 }}>
                  {o.order_number}{' '}
                  <span className="muted" style={{ fontWeight: 500 }}>· {o.customer_name || 'Cliente'}</span>
                </div>
                <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                  {[o.province, o.municipality].filter(Boolean).join(', ') || '—'} · {formatDate(o.created_at)}
                </div>
              </div>
              <strong>{formatKz(o.gross_total)}</strong>
              <OrderBadge status={o.status} />
            </div>
          ))
        )}
      </div>

      {detailLoading ? (
        <Modal title="Encomenda" onClose={() => setDetail(null)}>
          <div className="loading">A carregar…</div>
        </Modal>
      ) : detail ? (
        <Modal title={detail.order_number} onClose={() => setDetail(null)}>
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
            <OrderBadge status={detail.status} />
            <strong style={{ fontSize: 18 }}>{formatKz(detail.gross_total)}</strong>
          </div>

          <div className="kv"><span className="k">Cliente</span><span className="v">{detail.customer_name || '—'}</span></div>
          <div className="kv"><span className="k">Telefone</span><span className="v">{detail.customer_phone || '—'}</span></div>
          <div className="kv"><span className="k">NIF</span><span className="v">{detail.customer_tax_id || '—'}</span></div>
          <div className="kv">
            <span className="k">Morada</span>
            <span className="v">{[detail.neighborhood, detail.municipality, detail.province].filter(Boolean).join(', ') || '—'}</span>
          </div>
          <div className="kv"><span className="k">Pagamento</span><span className="v">{detail.payment_method || '—'}</span></div>

          <div style={{ borderTop: '1px solid var(--border)', margin: '12px 0', paddingTop: 10 }}>
            <strong style={{ fontSize: 14 }}>Artigos</strong>
            {detail.items.map((it) => (
              <div className="kv" key={it.id}>
                <span className="k">{Number(it.quantity)}× {it.description}</span>
                <span className="v">{formatKz(it.gross_amount)}</span>
              </div>
            ))}
          </div>

          {actionError ? <div className="banner danger" style={{ marginBottom: 12 }}>{actionError}</div> : null}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {detail.status === 'PENDING' ? (
              <>
                <button className="btn success" disabled={busy} onClick={() => act(() => api.orders.pay(detail.id))}>
                  Confirmar pagamento
                </button>
                <button className="btn ghost" disabled={busy} onClick={() => act(() => api.orders.cancel(detail.id))}>
                  Cancelar
                </button>
              </>
            ) : null}
            {detail.status === 'PAID' ? (
              <button className="btn" disabled={busy} onClick={() => act(() => api.orders.ship(detail.id))}>
                Marcar expedida
              </button>
            ) : null}
            {detail.status === 'SHIPPED' ? (
              <button className="btn success" disabled={busy} onClick={() => act(() => api.orders.deliver(detail.id))}>
                Marcar entregue
              </button>
            ) : null}
            {detail.invoice_id ? <span className="muted" style={{ fontSize: 12, alignSelf: 'center' }}>Factura emitida ✓</span> : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
