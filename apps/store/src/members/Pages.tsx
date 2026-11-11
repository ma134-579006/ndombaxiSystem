import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../config';
import type { MyOrderRow, PublicCoupon } from '../api/types';
import type { CartLine } from '../store/cart';
import { cartTotal } from '../store/cart';
import { clearSession, setSession, shownEmail } from '../store/customer';
import { formatDateTime } from '../format';
import { BRAND, I, P, Pic, kz } from './parts';

export type Membership = 'NONE' | 'PENDING' | 'APPROVED' | 'REJECTED';

/* ───────────── entrada ───────────── */
const GIS_SRC = 'https://accounts.google.com/gsi/client';
function loadGis(): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = window as unknown as { google?: { accounts?: { id?: unknown } } };
    if (w.google?.accounts?.id) return resolve();
    const ex = document.querySelector(`script[src="${GIS_SRC}"]`) as HTMLScriptElement | null;
    if (ex) { ex.addEventListener('load', () => resolve()); ex.addEventListener('error', () => reject(new Error('gis'))); return; }
    const s = document.createElement('script');
    s.src = GIS_SRC; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => reject(new Error('gis'));
    document.head.appendChild(s);
  });
}

function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="kw-root kw-auth">
      <div className="kw-auth-card kw-pop">
        <div className="kw-auth-brand"><img src="/logo-mark.png" alt="LPS Vendas" width={140} height={140} /><strong>{BRAND}</strong></div>
        {children}
      </div>
    </div>
  );
}

export function LoginScreen({ code }: { code: string }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [methods, setMethods] = useState<{ email: boolean; google: boolean; quick?: boolean } | null>(null);
  const gbtn = useRef<HTMLDivElement | null>(null);
  useEffect(() => { api.authMethods(code).then(setMethods).catch(() => setMethods({ email: false, google: false, quick: true })); }, [code]);
  const googleOn = GOOGLE_CLIENT_ID.includes('.apps.googleusercontent.com') && (methods?.google ?? true);
  const emailOn = !!methods?.email;

  useEffect(() => {
    if (!googleOn) return;
    let alive = true;
    loadGis().then(() => {
      const g = (window as unknown as { google?: any }).google;
      if (!alive || !g?.accounts?.id) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async (resp: { credential?: string }) => {
          if (!resp.credential) return;
          setBusy(true); setErr(null);
          try { setSession(code, await api.authGoogle(code, resp.credential)); }
          catch (e) { setErr(e instanceof ApiError ? e.message : 'Falha no login com Google.'); }
          finally { setBusy(false); }
        },
      });
      if (gbtn.current) g.accounts.id.renderButton(gbtn.current, { theme: 'outline', size: 'large', width: 300, text: 'continue_with', shape: 'pill' });
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [code, googleOn]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setErr(null);
    if (!emailOn) {
      if (!name.trim() || phone.replace(/\D/g, '').length < 9) { setErr('Indique o nome e o telefone.'); return; }
      setBusy(true);
      try { setSession(code, await api.authQuick(code, { name: name.trim(), phone: phone.trim() })); }
      catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
      finally { setBusy(false); }
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErr('Indique um email válido.'); return; }
    setBusy(true);
    try {
      if (!sent) { await api.authEmailCode(code, email.trim()); setSent(true); return; }
      if (!/^\d{6}$/.test(otp.trim())) { setErr('Indique o código de 6 dígitos.'); return; }
      setSession(code, await api.authEmail(code, email.trim(), name.trim() || undefined, undefined, otp.trim()));
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível entrar.'); }
    finally { setBusy(false); }
  };

  return (
    <AuthShell>
      <form className="kw-auth-form" onSubmit={(e) => void submit(e)}>
        {googleOn ? <><div ref={gbtn} className="kw-gbtn" /><div className="kw-or"><span>ou</span></div></> : null}
        <h2>{emailOn ? 'Entra com o seu email' : 'Entra com o seu contacto'}</h2>
        {!methods ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div> : emailOn ? (
          <>
            <label className="kw-f"><span>Email</span>
              <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setSent(false); setOtp(''); }} placeholder="exemplo@email.com" autoComplete="email" disabled={sent} /></label>
            {sent ? (
              <>
                <label className="kw-f"><span>Nome (se é a primeira vez)</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
                <label className="kw-f"><span>Código recebido por email</span>
                  <input value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" autoFocus /></label>
              </>
            ) : null}
          </>
        ) : (
          <>
            <label className="kw-f"><span>Nome</span><input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
            <label className="kw-f"><span>Telefone</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" placeholder="9XX XXX XXX" /></label>
          </>
        )}
        {err ? <div className="kw-err" role="alert">{err}</div> : null}
        <button className="kw-btn kw-btn-primary kw-block" disabled={busy || !methods}>{busy ? 'Um momento…' : !emailOn || sent ? 'Entrar' : 'Próximo'}</button>
        {sent ? <button type="button" className="kw-link" onClick={() => { setSent(false); setOtp(''); setErr(null); }}>Mudar de email</button> : null}
      </form>
    </AuthShell>
  );
}

export function MembershipScreen({ status, busy, onRequest, onLogout }: { status: Membership; busy: boolean; onRequest(note: string): void; onLogout(): void }) {
  const [note, setNote] = useState('');
  return (
    <AuthShell>
      {status === 'PENDING' ? (
        <div className="kw-state"><span className="kw-pending"><i /></span><span className="kw-pill kw-st-PENDING">Pedido em análise</span></div>
      ) : (
        <div className="kw-auth-form">
          <h2>Pedir adesão</h2>
          {status === 'REJECTED' ? <div className="kw-err" role="alert">Adesão recusada</div> : null}
          <label className="kw-f"><span>Mensagem (opcional)</span><input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
          <button className="kw-btn kw-btn-primary kw-block" disabled={busy} onClick={() => onRequest(note)}>{busy ? 'Um momento…' : 'Pedir adesão'}</button>
        </div>
      )}
      <button className="kw-link" onClick={onLogout}>Terminar sessão</button>
    </AuthShell>
  );
}

/* ───────────── carrinho ───────────── */
export function CartView({ cart, setQty, remove, onNext, onBack, onOpen }: {
  cart: CartLine[]; setQty(code: string, q: number): void; remove(code: string): void; onNext(): void; onBack(): void; onOpen(code: string): void;
}) {
  if (!cart.length) {
    return (
      <div className="kw-container kw-empty kw-cart-empty">
        <span className="kw-empty-ic"><I d={P.cart} size={44} /></span>
        <p>O seu carrinho está vazio</p>
        <button className="kw-btn kw-btn-primary" onClick={onBack}>Ver produtos</button>
      </div>
    );
  }
  const full = cart.reduce((s, l) => s + (l.product.listPrice && l.product.listPrice > l.product.grossPrice ? l.product.listPrice : l.product.grossPrice) * l.quantity, 0);
  const total = cartTotal(cart);
  return (
    <div className="kw-container kw-cart">
      <ol className="kw-steps"><li className="on">1. Carrinho</li><li>2. Pagamento</li></ol>
      <div className="kw-cart-grid">
        <ul className="kw-lines">
          {cart.map((l) => (
            <li key={l.product.code} className="kw-pop">
              <button className="kw-line-pic" onClick={() => onOpen(l.product.code)} aria-label={l.product.name}><Pic p={l.product} /></button>
              <div className="kw-line-in">
                <h3>{l.product.name}</h3>
                <div className="kw-line-p"><small>{kz(l.product.grossPrice)} x {l.quantity}</small><b>{kz(l.product.grossPrice * l.quantity)}</b></div>
              </div>
              <div className="kw-line-act">
                <button className="kw-x" onClick={() => remove(l.product.code)} aria-label="Remover"><I d={P.close} size={18} /></button>
                <div className="kw-qty sm">
                  <button onClick={() => setQty(l.product.code, l.quantity - 1)} aria-label="Menos">−</button><span>{l.quantity}</span><button onClick={() => setQty(l.product.code, l.quantity + 1)} aria-label="Mais">+</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <aside className="kw-sum">
          <div><span>Preço cheio:</span>{full > total ? <s>{kz(full)}</s> : <span>{kz(full)}</span>}</div>
          {full > total ? <div className="kw-disc"><span>Desconto:</span><b>- {kz(full - total)}</b></div> : null}
          <div className="kw-sum-t"><span>Subtotal:</span><b>{kz(total)}</b></div>
          <button className="kw-btn kw-btn-primary kw-block" onClick={onNext}>Continuar com a compra</button>
        </aside>
      </div>
    </div>
  );
}

/* ───────────── conta ───────────── */
type Tab = 'orders' | 'coupons' | 'profile';
const STATUS: Record<string, string> = { PENDING: 'Pendente', PAID: 'Pago', SHIPPED: 'Enviado', DELIVERED: 'Entregue', CANCELLED: 'Cancelado' };

export function Account({ code, token, tab, onTab, onTrack, email, name, onAssociates }: {
  code: string; token: string; tab: Tab; onTab(t: Tab): void; onTrack(id: string): void; email: string; name: string; onAssociates?(): void;
}) {
  const [orders, setOrders] = useState<MyOrderRow[] | null>(null);
  useEffect(() => { api.myOrders(code, token).then(setOrders).catch(() => setOrders([])); }, [code, token]);
  const c = (f: (o: MyOrderRow) => boolean) => (orders ?? []).filter(f).length;
  const tabs: Array<[Tab, string, string]> = [['orders', 'Minhas compras', P.bag], ['coupons', 'Meus cupões', P.card], ['profile', 'Perfil e endereço', P.user]];
  return (
    <div className="kw-container kw-acc">
      <aside className="kw-acc-menu">
        {tabs.map(([k, l, ic]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}><I d={ic} size={17} /> {l}</button>)}
        {onAssociates ? <button onClick={onAssociates}><I d={P.share} size={17} /> Mercado de Associados</button> : null}
        <button onClick={() => clearSession(code)}><I d={P.out} size={17} /> Terminar sessão</button>
      </aside>
      <section className="kw-acc-body">
        <header className="kw-acc-head kw-pop">
          <span className="kw-avatar lg">{(name || email).slice(0, 1).toUpperCase()}</span>
          <div><h1>{name}</h1>{shownEmail(email) ? <small>{shownEmail(email)}</small> : null}</div>
        </header>
        <div className="kw-counters">
          <button onClick={() => onTab('orders')}><b>{orders?.length ?? 0}</b><span>Todos os pedidos</span></button>
          <button onClick={() => onTab('orders')}><b>{c((o) => o.status === 'SHIPPED' || o.status === 'DELIVERED')}</b><span>Pacotes enviados</span></button>
          <button onClick={() => onTab('orders')}><b>{c((o) => o.status === 'PENDING' || o.status === 'PAID')}</b><span>Aguardando o envio</span></button>
          <button onClick={() => onTab('orders')}><b>{c((o) => o.status === 'CANCELLED')}</b><span>Cancelados</span></button>
        </div>
        <nav className="kw-tabs" role="tablist">{tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => onTab(k)}>{l}</button>)}</nav>
        {tab === 'orders' ? <Orders rows={orders} onTrack={onTrack} /> : tab === 'coupons' ? <Coupons code={code} /> : <Profile code={code} token={token} />}
      </section>
    </div>
  );
}

function Orders({ rows, onTrack }: { rows: MyOrderRow[] | null; onTrack(id: string): void }) {
  if (rows === null) return <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>;
  if (!rows.length) return <div className="kw-empty">Sem encomendas</div>;
  return (
    <ul className="kw-orders">
      {rows.map((o) => (
        <li key={o.id} className="kw-pop"><button onClick={() => onTrack(o.id)}>
          <b>{o.order_number}</b><span>{formatDateTime(o.created_at)}</span>
          <span className={`kw-pill kw-st-${o.status}`}>{STATUS[o.status] ?? o.status}</span><strong>{kz(o.gross_total)}</strong>
        </button></li>
      ))}
    </ul>
  );
}

function Coupons({ code }: { code: string }) {
  const [rows, setRows] = useState<PublicCoupon[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => { api.coupons(code).then(setRows).catch(() => setRows([])); }, [code]);
  if (rows === null) return <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>;
  if (!rows.length) return <div className="kw-empty">Sem cupões</div>;
  return (
    <ul className="kw-coupons">
      {rows.map((c) => (
        <li key={c.code} className="kw-pop">
          <div className="kw-coupon-v">{c.type === 'PERCENT' ? `${c.value}%` : kz(c.value)}<small>OFF</small></div>
          <div className="kw-coupon-i"><b>{c.code}</b>{c.minOrder ? <small>Compra mínima {kz(c.minOrder)}</small> : null}{c.endsAt ? <small>Válido até {formatDateTime(c.endsAt)}</small> : null}</div>
          <button className="kw-btn kw-btn-outline" onClick={() => { void navigator.clipboard?.writeText(c.code); setCopied(c.code); window.setTimeout(() => setCopied(null), 1500); }}>{copied === c.code ? 'Copiado' : 'Copiar'}</button>
        </li>
      ))}
    </ul>
  );
}

function Profile({ code, token }: { code: string; token: string }) {
  const [p, setP] = useState<{ name: string; phone: string; province: string; municipality: string; neighborhood: string; address: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  useEffect(() => {
    const empty = { name: '', phone: '', province: '', municipality: '', neighborhood: '', address: '' };
    api.myProfile(code, token).then((r) => setP({ name: r.name ?? '', phone: r.phone ?? '', province: r.province ?? '', municipality: r.municipality ?? '', neighborhood: r.neighborhood ?? '', address: r.address ?? '' })).catch(() => setP(empty));
  }, [code, token]);
  if (!p) return <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>;
  const set = (k: keyof typeof p) => (e: React.ChangeEvent<HTMLInputElement>) => setP({ ...p, [k]: e.target.value });
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null);
    try { await api.updateProfile(code, token, p); setMsg({ ok: true, t: 'Guardado' }); }
    catch (er) { setMsg({ ok: false, t: er instanceof ApiError ? er.message : 'Não foi possível guardar' }); }
    finally { setBusy(false); }
  };
  return (
    <form className="kw-profile" onSubmit={(e) => void save(e)}>
      <h3>Endereço de entrega</h3>
      <label className="kw-f"><span>Nome</span><input value={p.name} onChange={set('name')} autoComplete="name" /></label>
      <label className="kw-f"><span>Telefone</span><input value={p.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" /></label>
      <label className="kw-f"><span>Província</span><input value={p.province} onChange={set('province')} /></label>
      <label className="kw-f"><span>Município</span><input value={p.municipality} onChange={set('municipality')} /></label>
      <label className="kw-f"><span>Detalhe da rua ou bairro</span><input value={p.neighborhood} onChange={set('neighborhood')} /></label>
      <label className="kw-f"><span>Endereço</span><input value={p.address} onChange={set('address')} /></label>
      {msg ? <div className={msg.ok ? 'kw-ok' : 'kw-err'} role="status">{msg.t}</div> : null}
      <button className="kw-btn kw-btn-primary" disabled={busy}>{busy ? 'A guardar…' : 'Salvar endereço'}</button>
    </form>
  );
}
