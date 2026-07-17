import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OrderMessage, StoreInvoice, WebOrder } from '../api/types';
import { IconChevronLeft, IconSend, IconSpark } from '../components/Icons';
import { formatKz, statusLabel } from '../format';
import { useStore } from '../state/StoreContext';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];
const INVOICEABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

const escHtml = (s: string) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
const dateOnly = (d: string) => { try { return new Date(d).toLocaleDateString('pt-PT'); } catch { return String(d ?? '').slice(0, 10); } };

/** Constrói a FATURA A4 (HTML) e imprime via IFRAME oculto — funciona em TODOS
 *  os ecrãs (PC/telemóvel). O cliente escolhe "Guardar como PDF" no diálogo. */
function printInvoiceA4(inv: StoreInvoice) {
  const c = inv.company;
  const rows = inv.items.map((it) => `<tr>
    <td>${escHtml(it.description)}</td>
    <td class="r">${it.quantity}</td>
    <td class="r">${formatKz(it.unitPrice)}</td>
    <td class="r">${it.ivaRate}%</td>
    <td class="r">${formatKz(it.grossAmount)}</td></tr>`).join('');
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fatura ${escHtml(inv.number)}</title>
    <style>
      @page{size:A4;margin:14mm;} *{box-sizing:border-box;}
      body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0f172a;margin:0;}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #ff4d2d;padding-bottom:14px;margin-bottom:16px;}
      .co{font-size:22px;font-weight:800;margin:0;}
      .co-meta{font-size:12.5px;color:#475569;margin:3px 0 0;line-height:1.5;}
      .doc{text-align:right;}
      .doc .t{font-size:17px;font-weight:800;color:#ff4d2d;margin:0;}
      .doc .n{font-size:14px;font-weight:700;margin:3px 0 0;}
      .doc .d{font-size:12px;color:#64748b;margin:2px 0 0;}
      .party{display:flex;justify-content:space-between;gap:20px;margin:6px 0 18px;font-size:13px;}
      .lbl{color:#64748b;font-size:11px;text-transform:uppercase;letter-spacing:.4px;}
      table{width:100%;border-collapse:collapse;margin-top:4px;}
      th{background:#0f172a;color:#fff;font-size:11.5px;text-transform:uppercase;text-align:left;padding:8px 10px;}
      td{padding:8px 10px;border-bottom:1px solid #e2e8f0;font-size:13px;}
      th.r,td.r{text-align:right;}
      .tot{margin-top:14px;margin-left:auto;width:min(300px,60%);}
      .tot .kv{display:flex;justify-content:space-between;padding:6px 2px;font-size:13px;}
      .tot .grand{background:#ff4d2d;color:#fff;font-weight:800;font-size:16px;padding:10px 12px;border-radius:8px;margin-top:6px;}
      .fiscal{margin-top:22px;font-size:11px;color:#64748b;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:12px;}
      .thanks{margin-top:10px;color:#ff4d2d;font-weight:700;font-size:13px;}
    </style></head><body>
      <div class="hd">
        <div>
          <h1 class="co">${escHtml(c.name || 'Fatura')}</h1>
          <p class="co-meta">${c.nif ? `NIF: ${escHtml(c.nif)}<br>` : ''}${c.address ? `${escHtml(c.address)}<br>` : ''}${[c.phone, c.email].filter(Boolean).map(escHtml).join(' · ')}</p>
        </div>
        <div class="doc">
          <p class="t">FATURA</p>
          <p class="n">${escHtml(inv.number)}</p>
          <p class="d">${dateOnly(inv.invoiceDate)}</p>
          <p class="d">Encomenda ${escHtml(inv.orderNumber)}</p>
        </div>
      </div>
      <div class="party">
        <div><div class="lbl">Cliente</div><strong>${escHtml(inv.customerName || 'Consumidor final')}</strong>${inv.customerTaxId ? `<br>NIF: ${escHtml(inv.customerTaxId)}` : ''}</div>
      </div>
      <table>
        <thead><tr><th>Artigo</th><th class="r">Qt</th><th class="r">Preço</th><th class="r">IVA</th><th class="r">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="tot">
        <div class="kv"><span>Base tributável</span><span>${formatKz(inv.netTotal)}</span></div>
        <div class="kv"><span>IVA</span><span>${formatKz(inv.ivaTotal)}</span></div>
        <div class="kv grand"><span>TOTAL</span><span>${formatKz(inv.grossTotal)}</span></div>
      </div>
      <div class="fiscal">
        ${inv.hash ? `Controlo (Hash): ${escHtml(inv.hash.slice(0, 16))}<br>` : ''}
        Documento processado por programa validado · Ndombaxi System
        <div class="thanks">${escHtml(c.receiptMessage || 'Obrigado pela preferência!')}</div>
      </div>
    </body></html>`;

  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const cleanup = () => { setTimeout(() => frame.remove(), 1000); };
  frame.onload = () => {
    try {
      const win = frame.contentWindow;
      if (!win) { cleanup(); return; }
      win.focus();
      win.onafterprint = cleanup;
      setTimeout(() => win.print(), 300);
    } catch { cleanup(); }
  };
  const doc = frame.contentWindow?.document;
  if (!doc) { frame.remove(); return; }
  doc.open(); doc.write(html); doc.close();
}
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
  const [invBusy, setInvBusy] = useState(false);
  const [invErr, setInvErr] = useState<string | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);

  const downloadInvoice = async () => {
    if (invBusy) return;
    setInvBusy(true);
    setInvErr(null);
    try {
      const inv = await api.orderInvoice(code, orderId);
      printInvoiceA4(inv);
    } catch (e) {
      setInvErr(e instanceof ApiError ? e.message : 'Não foi possível obter a fatura.');
    } finally {
      setInvBusy(false);
    }
  };

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
    // Refresca o estado (cozinha/tempo/pagamento) enquanto o cliente acompanha.
    const t = setInterval(() => void loadOrder(), 15000);
    return () => clearInterval(t);
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
        {/* Cozinha (restauração): a loja aceitou e deu um tempo — o cliente vê-o. */}
        {order.kitchen_status && order.kitchen_status !== 'NEW' ? (
          <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 10, fontWeight: 700, fontSize: 14,
            background: order.kitchen_status === 'READY' ? '#30a46c22' : '#f5a62322',
            color: order.kitchen_status === 'READY' ? '#1a7f4b' : '#9a6a00' }}>
            {order.kitchen_status === 'READY'
              ? '✅ A tua encomenda está pronta!'
              : `🍳 Em preparação na cozinha${order.prep_eta_min ? ` · pronta em ~${order.prep_eta_min} min` : ''}`}
          </div>
        ) : null}
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
        {/* Fatura fiscal: disponível assim que a loja confirma a encomenda. */}
        {INVOICEABLE.includes(order.status) ? (
          <div style={{ marginTop: 14 }}>
            <button className="btn block" onClick={downloadInvoice} disabled={invBusy}
              style={{ width: '100%' }}>
              {invBusy ? 'A preparar fatura…' : '🧾 Baixar fatura (PDF A4)'}
            </button>
            {invErr ? <p className="muted" style={{ color: 'var(--danger, #dc2626)', fontSize: 13, marginTop: 8 }}>{invErr}</p> : null}
          </div>
        ) : null}
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
