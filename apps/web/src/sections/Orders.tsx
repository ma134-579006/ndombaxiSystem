import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OrderMessage, OrderStatus, WebOrder, WebOrderDetail } from '../api/types';
import { IconCpu, IconTruck } from '../components/Icons';
import { Modal } from '../components/ui';
import { formatDate, formatKz, statusLabel } from '../format';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

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
          {detail.payment_reference ? (
            <div className="kv"><span className="k">Referência</span>
              <span className="v">{detail.payment_entity ? `Ent. ${detail.payment_entity} · ` : ''}{detail.payment_reference}</span></div>
          ) : null}

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
                {detail.payment_reference ? (
                  <button className="btn" disabled={busy}
                    title="Reconhece o pagamento por referência e aprova a encomenda automaticamente"
                    onClick={() => act(() => api.orders.confirmReference({
                      entity: detail.payment_entity ?? undefined,
                      reference: detail.payment_reference!,
                      amount: Number(detail.gross_total),
                    }))}>
                    Confirmar referência paga
                  </button>
                ) : null}
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

          {CHATTABLE.includes(detail.status) ? (
            <OrderChat orderId={detail.id} />
          ) : (
            <div className="muted" style={{ fontSize: 12, marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
              💬 A conversa com o cliente abre depois de a encomenda ser <strong>paga/aprovada</strong>.
            </div>
          )}
        </Modal>
      ) : null}
    </>
  );
}

/** Conversa com o cliente da encomenda (a IA responde quando ninguém está online). */
function OrderChat({ orderId }: { orderId: string }) {
  const [messages, setMessages] = useState<OrderMessage[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    try { setMessages(await api.orders.messages(orderId)); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha ao carregar a conversa.'); }
  }, [orderId]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr(null);
    try {
      await api.orders.reply(orderId, body);
      setText('');
      await load();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível enviar.'); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 14, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
      <strong style={{ fontSize: 14 }}>💬 Conversa com o cliente</strong>
      {err ? <div className="banner danger" style={{ margin: '8px 0' }}>{err}</div> : null}
      <div ref={scroller} style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 8, margin: '10px 0' }}>
        {messages == null ? <span className="muted" style={{ fontSize: 13 }}>A carregar…</span>
          : messages.length === 0 ? <span className="muted" style={{ fontSize: 13 }}>Ainda sem mensagens. Escreve para iniciar.</span>
          : messages.map((m) => {
            const staff = m.sender_type === 'STAFF';
            const ai = m.sender_type === 'ASSISTANT';
            return (
              <div key={m.id} style={{ alignSelf: staff ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
                <div style={{
                  background: staff ? 'var(--primary)' : ai ? 'var(--surface-2)' : 'var(--surface)',
                  color: staff ? '#fff' : 'var(--text)',
                  border: staff ? 'none' : '1px solid var(--border)',
                  borderRadius: 12, padding: '8px 12px', fontSize: 14, lineHeight: 1.45, whiteSpace: 'pre-wrap',
                }}>
                  <div style={{ fontSize: 11, fontWeight: 700, opacity: .8, marginBottom: 2, display: 'flex', alignItems: 'center', gap: 5 }}>
                    {ai ? <IconCpu size={12} /> : null}{m.sender_name}{ai ? ' · IA' : ''}
                  </div>
                  {m.body}
                </div>
              </div>
            );
          })}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void send(); } }}
          placeholder="Responder ao cliente…"
          style={{ flex: 1, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 13px', color: 'var(--text)', fontSize: 14 }}
        />
        <button className="btn" onClick={send} disabled={busy || !text.trim()}>Enviar</button>
      </div>
    </div>
  );
}
