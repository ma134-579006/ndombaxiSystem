import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { OrderMessage, StoreInvoice, WebOrder } from '../api/types';
import { IconChevronLeft, IconSend, IconSpark } from '../components/Icons';
import { formatKz, statusLabel } from '../format';
import { useStore } from '../state/StoreContext';

const CHATTABLE = ['PAID', 'SHIPPED', 'DELIVERED'];
const INVOICEABLE = ['PAID', 'SHIPPED', 'DELIVERED'];

const dateOnly = (d: string) => { try { return new Date(d).toLocaleDateString('pt-PT'); } catch { return String(d ?? '').slice(0, 10); } };

/** Gera a FATURA A4 em PDF (jsPDF, carregado dinamicamente na 1.ª utilização)
 *  e DESCARREGA o ficheiro .pdf — sem diálogo de impressão. */
async function downloadInvoicePdf(inv: StoreInvoice): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 48;
  let y = 56;
  const c = inv.company;
  const accent: [number, number, number] = [255, 77, 45];

  // Cabeçalho — empresa à esquerda, documento à direita.
  doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.setTextColor(15, 23, 42);
  doc.text(c.name || 'Fatura', M, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(71, 85, 105);
  let my = y + 16;
  if (c.nif) { doc.text(`NIF: ${c.nif}`, M, my); my += 13; }
  if (c.address) { doc.text(doc.splitTextToSize(c.address, W / 2 - M), M, my); my += 13; }
  const contact = [c.phone, c.email].filter(Boolean).join(' · ');
  if (contact) { doc.text(contact, M, my); my += 13; }

  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...accent);
  doc.text('FATURA', W - M, y, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
  doc.text(inv.number, W - M, y + 17, { align: 'right' });
  doc.setFontSize(9.5); doc.setTextColor(100, 116, 139);
  doc.text(dateOnly(inv.invoiceDate), W - M, y + 31, { align: 'right' });
  doc.text(`Encomenda ${inv.orderNumber}`, W - M, y + 44, { align: 'right' });

  y = Math.max(my, y + 52) + 8;
  doc.setDrawColor(...accent); doc.setLineWidth(2); doc.line(M, y, W - M, y);
  y += 24;

  // Cliente
  doc.setFontSize(10); doc.setTextColor(100, 116, 139); doc.text('Cliente', M, y);
  doc.setFont('helvetica', 'bold'); doc.setTextColor(15, 23, 42);
  doc.text(inv.customerName || 'Consumidor final', M, y + 14);
  if (inv.customerTaxId) { doc.setFont('helvetica', 'normal'); doc.text(`NIF: ${inv.customerTaxId}`, M, y + 28); y += 14; }
  y += 40;

  // Tabela de artigos
  const cQt = W - M - 250, cPr = W - M - 150, cIva = W - M - 92, cTot = W - M;
  doc.setFillColor(15, 23, 42); doc.rect(M, y - 14, W - 2 * M, 24, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(255, 255, 255);
  doc.text('Artigo', M + 10, y + 2);
  doc.text('Qt', cQt, y + 2, { align: 'right' });
  doc.text('Preço', cPr, y + 2, { align: 'right' });
  doc.text('IVA', cIva, y + 2, { align: 'right' });
  doc.text('Total', cTot - 10, y + 2, { align: 'right' });
  y += 24;
  doc.setFont('helvetica', 'normal');
  let alt = false;
  for (const it of inv.items) {
    if (y > doc.internal.pageSize.getHeight() - 170) { doc.addPage(); y = 56; }
    if (alt) { doc.setFillColor(247, 249, 252); doc.rect(M, y - 13, W - 2 * M, 22, 'F'); }
    alt = !alt;
    doc.setTextColor(30, 36, 46);
    const nome = doc.splitTextToSize(it.description, cQt - M - 24)[0] ?? it.description;
    doc.text(String(nome), M + 10, y + 2);
    doc.text(String(it.quantity), cQt, y + 2, { align: 'right' });
    doc.text(formatKz(it.unitPrice), cPr, y + 2, { align: 'right' });
    doc.text(`${it.ivaRate}%`, cIva, y + 2, { align: 'right' });
    doc.text(formatKz(it.grossAmount), cTot - 10, y + 2, { align: 'right' });
    y += 22;
  }
  y += 16;

  // Totais
  doc.setFontSize(11);
  const tot: [string, string][] = [['Base tributável', formatKz(inv.netTotal)], ['IVA', formatKz(inv.ivaTotal)]];
  for (const [k, v] of tot) {
    doc.setFillColor(247, 249, 252); doc.rect(M, y - 14, W - 2 * M, 26, 'F');
    doc.setTextColor(70, 80, 95); doc.text(k, M + 12, y + 3);
    doc.setTextColor(15, 23, 42); doc.text(v, W - M - 12, y + 3, { align: 'right' });
    y += 30;
  }
  doc.setFillColor(...accent); doc.rect(M, y - 14, W - 2 * M, 34, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text('TOTAL', M + 12, y + 6);
  doc.text(formatKz(inv.grossTotal), W - M - 12, y + 6, { align: 'right' });
  y += 48;

  // Rodapé fiscal
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); doc.setTextColor(110, 120, 135);
  if (inv.hash) { doc.text(`Controlo (Hash): ${inv.hash.slice(0, 16)}`, M, y); y += 13; }
  doc.text('Documento processado por programa validado · Ndombaxi System', M, y); y += 16;
  doc.setTextColor(...accent); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
  doc.text(c.receiptMessage || 'Obrigado pela preferência!', M, y);

  doc.save(`Fatura-${inv.number.replace(/[^\w-]/g, '_')}.pdf`);
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
      await downloadInvoicePdf(inv);
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
