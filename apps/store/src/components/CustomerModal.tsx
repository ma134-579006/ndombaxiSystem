import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../config';
import { setSession, clearSession } from '../store/customer';
import type { CustomerSession, MyOrderRow } from '../api/types';
import { formatKz } from '../format';
import { IconClose, IconStore } from './Icons';

const GIS_SRC = 'https://accounts.google.com/gsi/client';

function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
    if (w.google?.accounts?.id) return resolve();
    const existing = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('gis')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('gis'));
    document.head.appendChild(s);
  });
}

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Pendente', PAID: 'Pago', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado',
};

export function CustomerModal({
  code, session, onClose, onOpenOrder,
}: {
  code: string;
  session: CustomerSession | null;
  onClose(): void;
  onOpenOrder(orderId: string): void;
}) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <h3>{session ? 'A minha conta' : 'Entrar'}</h3>
          <span className="spacer" />
          <button className="icon-x" onClick={onClose}><IconClose size={22} /></button>
        </div>
        <div className="mb">
          {session
            ? <Account code={code} session={session} onClose={onClose} onOpenOrder={onOpenOrder} />
            : <Login code={code} onClose={onClose} />}
        </div>
      </div>
    </div>
  );
}

function Login({ code, onClose }: { code: string; onClose(): void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const gbtn = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com')) return;
    let alive = true;
    loadGis().then(() => {
      if (!alive) return;
      const g = (window as unknown as { google?: any }).google;
      if (!g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          setBusy(true); setErr(null);
          try {
            setSession(code, await api.authGoogle(code, resp.credential));
            onClose();
          } catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no login com Google.'); }
          finally { setBusy(false); }
        },
      });
      if (gbtn.current) {
        g.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with' });
      }
    }).catch(() => { /* GIS indisponível — fica só o email */ });
    return () => { alive = false; };
  }, [code, onClose]);

  const submit = async () => {
    setErr(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Indique um email válido.'); return; }
    setBusy(true);
    try {
      setSession(code, await api.authEmail(code, email.trim(), name.trim() || undefined));
      onClose();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  const googleOn = GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com');

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Entra para <strong>acompanhar as tuas encomendas</strong> e falar com a loja — com histórico e apoio por IA.
      </p>
      {err ? <div className="banner danger" style={{ marginBottom: 12 }}>{err}</div> : null}
      {googleOn ? (
        <>
          <div ref={gbtn} style={{ display: 'flex', justifyContent: 'center', minHeight: 44, marginBottom: 4 }} />
          <div className="or-sep"><span>ou com email</span></div>
        </>
      ) : null}
      <div className="field"><label>Email</label>
        <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="o-teu-email@exemplo.com" inputMode="email" /></div>
      <div className="field"><label>Nome (opcional)</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O teu nome" /></div>
      <button className="btn lg block" onClick={submit} disabled={busy}>{busy ? 'A entrar…' : 'Entrar / Criar conta'}</button>
    </>
  );
}

function Account({
  code, session, onClose, onOpenOrder,
}: {
  code: string;
  session: CustomerSession;
  onClose(): void;
  onOpenOrder(orderId: string): void;
}) {
  const [orders, setOrders] = useState<MyOrderRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    api.myOrders(code, session.token)
      .then((o) => { if (alive) setOrders(o); })
      .catch((e) => { if (alive) setErr(e instanceof ApiError ? e.message : 'Falha ao carregar encomendas.'); });
    return () => { alive = false; };
  }, [code, session.token]);

  return (
    <>
      <div className="acct-head">
        <div className="avatar"><IconStore size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800 }}>{session.customer.name}</div>
          <div className="muted" style={{ fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.customer.email}</div>
        </div>
        <button className="btn ghost" onClick={() => { clearSession(code); onClose(); }}>Sair</button>
      </div>

      <h4 style={{ margin: '18px 0 8px' }}>As minhas encomendas</h4>
      {err ? <div className="banner danger">{err}</div>
        : orders == null ? <p className="muted">A carregar…</p>
        : orders.length === 0 ? <p className="muted">Ainda não tens encomendas nesta loja.</p>
        : (
          <div className="my-orders">
            {orders.map((o) => (
              <button key={o.id} className="mo" onClick={() => onOpenOrder(o.id)}>
                <div style={{ flex: 1, textAlign: 'left', minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{o.order_number}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{new Date(o.created_at).toLocaleDateString('pt-PT')}</div>
                </div>
                <span className={`status-pill st-${o.status}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                <strong>{formatKz(Number(o.gross_total))}</strong>
              </button>
            ))}
          </div>
        )}
    </>
  );
}
