import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OrderMessage, WebOrder } from '../api/types';
import { IconChevronLeft, IconSend, IconSpark } from '../components/Icons';
import { formatKz, statusLabel } from '../format';
import { useStore } from '../state/StoreContext';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];
const STATUS_COLOR: Record<string, string> = {
  PENDING: '#d97706',
  PAID: '#2563eb',
  SHIPPED: '#7c3aed',
  DELIVERED: '#16a34a',
  CANCELLED: '#dc2626',
};

export function Track({ orderId, onBack }: { orderId: string; onBack(): void }) {
  const { code } = useStore();
  const [order, setOrder] = useState<WebOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<OrderMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const chatRef = useRef<HTMLDivElement>(null);

  const loadOrder = useCallback(async () => {
    try {
      setOrder(await api.track(code, orderId));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível carregar a encomenda.');
    } finally {
      setLoading(false);
    }
  }, [code, orderId]);

  const loadMessages = useCallback(async () => {
    try {
      setMessages(await api.messages(code, orderId));
    } catch {
      /* chat ainda indisponível */
    }
  }, [code, orderId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  const chatOpen = order ? CHATTABLE.includes(order.status) : false;

  useEffect(() => {
    if (!chatOpen) return;
    void loadMessages();
    const t = setInterval(() => void loadMessages(), 6000);
    return () => clearInterval(t);
  }, [chatOpen, loadMessages]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight });
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending || !order) return;
    setSending(true);
    try {
      const res = await api.sendMessage(code, orderId, text, order.customer_name);
      setMessages((prev) => {
        const next = [...prev, res.message];
        if (res.assistant) next.push(res.assistant);
        return next;
      });
      setDraft('');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a mensagem.');
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="page">
        <p className="muted center" style={{ padding: 40 }}>A carregar a encomenda…</p>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="page">
        <button className="back" onClick={onBack}>
          <IconChevronLeft size={18} /> Voltar
        </button>
        <div className="banner danger">{error ?? 'Encomenda não encontrada.'}</div>
      </div>
    );
  }

  const color = STATUS_COLOR[order.status] ?? '#6b7686';

  return (
    <div className="page">
      <button className="back" onClick={onBack}>
        <IconChevronLeft size={18} /> Voltar à loja
      </button>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 900 }}>{order.order_number}</h1>
          <span className="status-pill" style={{ color, background: `${color}22` }}>
            {statusLabel(order.status)}
          </span>
        </div>
        <div style={{ marginTop: 14 }}>
          {order.items.map((it) => (
            <div className="kv" key={it.id}>
              <span className="k">{it.description} × {Number(it.quantity)}</span>
              <span className="v">{formatKz(it.gross_amount)}</span>
            </div>
          ))}
        </div>
        <div className="kv" style={{ borderTop: '1px solid var(--border)', marginTop: 8, paddingTop: 12 }}>
          <span className="k">Total</span>
          <span className="v" style={{ fontSize: 20, fontWeight: 900 }}>{formatKz(order.gross_total)}</span>
        </div>
      </div>

      <div className="card">
        <h3>Conversa com a loja</h3>
        {!chatOpen ? (
          <p className="muted" style={{ margin: 0 }}>
            A conversa abre assim que a encomenda for aprovada/paga.
          </p>
        ) : (
          <>
            <div className="chat" ref={chatRef}>
              {messages.length === 0 ? (
                <p className="muted" style={{ textAlign: 'center', padding: 12 }}>
                  Ainda sem mensagens. Faça uma pergunta à loja 👋
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_type === 'CUSTOMER';
                  const bot = m.sender_type === 'ASSISTANT';
                  return (
                    <div key={m.id} className={`bubble ${mine ? 'me' : 'them'}`}>
                      {!mine ? (
                        <div className="who">
                          {bot ? <IconSpark size={12} /> : null}
                          {m.sender_name}
                        </div>
                      ) : null}
                      {m.body}
                    </div>
                  );
                })
              )}
            </div>
            <div className="composer">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="Escreva uma mensagem…"
              />
              <button className="send" onClick={send} disabled={sending || !draft.trim()}>
                <IconSend size={20} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
