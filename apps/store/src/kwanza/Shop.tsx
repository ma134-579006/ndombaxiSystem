import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { PaymentMethod } from '../api/types';
import { formatDateTime } from '../format';
import { GeoError, getHighAccuracyPosition, type GeoFix } from '../store/geo';
import { readFileProgress } from '../transfer';
import { I, P, kz } from '../members/parts';
import { kw, type KOrder, type Listing } from './api';

/* ═══════════════ carrinho (no aparelho; sem conta) ═══════════════ */
export interface CartItem { companyCode: string; companyName: string; productCode: string; name: string; imageUrl: string | null; price: number; associateCode: string | null; qty: number }
const CART_KEY = 'kw.cart';
const ORDERS_KEY = 'kw.orders';
const BUYER_KEY = 'kw.buyer';
const read = <T,>(k: string, d: T): T => { try { const v = JSON.parse(localStorage.getItem(k) || 'null') as T | null; return v ?? d; } catch { return d; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* armazenamento indisponível */ } window.dispatchEvent(new Event('kw:cart')); };
const sameLine = (a: CartItem, b: { companyCode: string; productCode: string; associateCode: string | null }) => a.companyCode === b.companyCode && a.productCode === b.productCode && a.associateCode === b.associateCode;

export const cart = {
  items: (): CartItem[] => read<CartItem[]>(CART_KEY, []).filter((x) => x && x.productCode && x.qty > 0),
  add(l: Listing, qty = 1, associateCode: string | null = l.associate?.code ?? null) {
    const items = cart.items();
    const line = { companyCode: l.companyCode, productCode: l.productCode, associateCode };
    const cur = items.find((x) => sameLine(x, line));
    if (cur) { cur.qty = Math.min(999, cur.qty + qty); cur.price = l.grossPrice; }
    else items.push({ ...line, companyName: l.companyName, name: l.name, imageUrl: l.imageUrl, price: l.grossPrice, qty });
    write(CART_KEY, items);
  },
  set(i: CartItem, qty: number) { write(CART_KEY, cart.items().map((x) => (sameLine(x, i) ? { ...x, qty: Math.max(1, Math.min(999, qty)) } : x))); },
  remove(i: CartItem) { write(CART_KEY, cart.items().filter((x) => !sameLine(x, i))); },
  clear(companyCode?: string) { write(CART_KEY, companyCode ? cart.items().filter((x) => x.companyCode !== companyCode) : []); },
};
export const myOrders = {
  tokens: (): string[] => read<string[]>(ORDERS_KEY, []).filter((t) => typeof t === 'string'),
  add(t: string) { const s = new Set([t, ...myOrders.tokens()]); try { localStorage.setItem(ORDERS_KEY, JSON.stringify([...s].slice(0, 100))); } catch { /* sem armazenamento */ } },
};
export function deviceId(): string {
  try { let d = localStorage.getItem('kw.device'); if (!d) { d = crypto.randomUUID(); localStorage.setItem('kw.device', d); } return d; } catch { return ''; }
}

/** Itens do carrinho (atualiza-se quando outro ecrã mexe no carrinho). */
export function useCart(): CartItem[] {
  const [items, setItems] = useState<CartItem[]>(cart.items);
  useEffect(() => {
    const up = () => setItems(cart.items());
    window.addEventListener('kw:cart', up); window.addEventListener('storage', up);
    return () => { window.removeEventListener('kw:cart', up); window.removeEventListener('storage', up); };
  }, []);
  return items;
}

/** GPS ligado automaticamente ao abrir o ecrã; sem localização não se continua. */
function useGps(auto = true) {
  const [fix, setFix] = useState<GeoFix | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = useCallback(async () => {
    setBusy(true); setErr(null);
    try { setFix(await getHighAccuracyPosition()); } catch (e) { setErr(e instanceof GeoError ? e.message : 'É obrigatório partilhar a localização GPS.'); } finally { setBusy(false); }
  }, []);
  useEffect(() => { if (auto) void ask(); }, [auto, ask]);
  return { fix, err, busy, ask };
}

function GpsBar({ g }: { g: ReturnType<typeof useGps> }) {
  if (g.fix) return <div className="kw-gps ok" role="status"><span><I d={P.pin} size={18} /></span><div><b>Localização ativa</b><small>Precisão de {Math.round(g.fix.accuracy)} m</small></div></div>;
  return (
    <div className={`kw-gps${g.err ? ' bad' : ''}`} role={g.err ? 'alert' : 'status'}>
      <span><I d={P.pin} size={18} /></span>
      <div><b>{g.busy ? 'A obter a sua localização…' : 'Ative a localização GPS'}</b>{g.err ? <small>{g.err}</small> : null}</div>
      {!g.busy ? <button type="button" className="kw-btn kw-btn-primary" onClick={() => void g.ask()}>Ativar GPS</button> : <i className="kw-spin" aria-hidden="true" />}
    </div>
  );
}

/* ═══════════════ carrinho + compra ═══════════════ */
export function Checkout({ go, flash }: { go(r: { n: 'orders' } | { n: 'home' }): void; flash(t: string): void }) {
  const items = useCart();
  const g = useGps(items.length > 0);
  const saved = read<{ name: string; phone: string; address: string; province: string; municipality: string }>(BUYER_KEY, { name: '', phone: '', address: '', province: 'Luanda', municipality: '' });
  const [f, setF] = useState({ ...saved, delivery: 'DELIVERY' as 'DELIVERY' | 'PICKUP', notes: '' });
  const [methods, setMethods] = useState<Record<string, PaymentMethod[]>>({});
  const [pay, setPay] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const companies = useMemo(() => [...new Map(items.map((i) => [i.companyCode, i.companyName])).entries()], [items]);
  useEffect(() => {
    for (const [code] of companies) {
      if (methods[code]) continue;
      api.paymentMethods(code).then((m) => { setMethods((x) => ({ ...x, [code]: m })); setPay((x) => ({ ...x, [code]: x[code] ?? m[0]?.type ?? 'CASH' })); }).catch(() => setMethods((x) => ({ ...x, [code]: [] })));
    }
  }, [companies]); // eslint-disable-line react-hooks/exhaustive-deps
  const total = items.reduce((s, i) => s + i.price * i.qty, 0);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    if (f.name.trim().length < 2) return setErr('Indique o seu nome.');
    if (f.phone.replace(/\D/g, '').length < 9) return setErr('Indique um número de telemóvel válido.');
    if (f.delivery === 'DELIVERY' && f.address.trim().length < 4) return setErr('Indique a morada de entrega.');
    let fix = g.fix;
    if (!fix) { await g.ask(); return setErr('É obrigatório partilhar a localização GPS para concluir a encomenda.'); }
    setBusy(true);
    try { fix = await getHighAccuracyPosition(10000); } catch { /* usa a última posição */ }
    try {
      write(BUYER_KEY, { name: f.name, phone: f.phone, address: f.address, province: f.province, municipality: f.municipality });
      // Uma encomenda por empresa e por associado (cada empresa entrega a sua).
      const groups = new Map<string, CartItem[]>();
      for (const i of items) { const k = `${i.companyCode}|${i.associateCode ?? ''}`; groups.set(k, [...(groups.get(k) ?? []), i]); }
      let done = 0;
      for (const [, lines] of groups) {
        const r = await kw.checkout({
          companyCode: lines[0].companyCode, associateCode: lines[0].associateCode ?? undefined,
          lines: lines.map((l) => ({ productCode: l.productCode, quantity: l.qty })),
          name: f.name.trim(), phone: f.phone.trim(), address: f.delivery === 'DELIVERY' ? f.address.trim() : undefined, province: f.province || undefined, municipality: f.municipality || undefined,
          deliveryMethod: f.delivery, paymentMethod: pay[lines[0].companyCode], notes: f.notes.trim() || undefined,
          geoLat: fix!.lat, geoLng: fix!.lng, geoAccuracy: fix!.accuracy, geoConsent: true, device: deviceId(),
        });
        myOrders.add(r.token);
        write(CART_KEY, cart.items().filter((x) => !lines.some((l) => sameLine(x, l))));
        done++;
      }
      flash(done > 1 ? `${done} encomendas feitas` : 'Encomenda feita');
      go({ n: 'orders' });
    } catch (er) { setErr(er instanceof ApiError ? er.message : 'Não foi possível concluir a encomenda.'); } finally { setBusy(false); }
  };

  if (!items.length) return (
    <div className="kw-container kw-shop"><div className="kw-shop-empty"><span><I d={P.cart} size={34} /></span><b>O carrinho está vazio</b><button className="kw-btn kw-btn-primary" onClick={() => go({ n: 'home' })}>Ver produtos</button><button className="kw-link" onClick={() => go({ n: 'orders' })}>Minhas compras</button></div></div>
  );
  return (
    <form className="kw-container kw-shop" onSubmit={(e) => void submit(e)}>
      <h1 className="kw-shop-t"><I d={P.cart} size={22} /> Carrinho</h1>
      <div className="kw-shop-grid">
        <div className="kw-shop-main">
          <section className="kw-sec"><header className="kw-sec-h"><h3>Produtos</h3></header>
            <div className="kw-cart">
              {items.map((i) => (
                <div className="kw-cart-row" key={`${i.companyCode}|${i.productCode}|${i.associateCode}`}>
                  <span className="kw-cart-pic">{i.imageUrl ? <img src={i.imageUrl} alt="" /> : null}</span>
                  <div className="kw-cart-main"><b>{i.name}</b><small>{i.companyName}</small><span className="kw-cart-price">{kz(i.price)}</span></div>
                  <div className="kw-qty" role="group" aria-label={`Quantidade de ${i.name}`}>
                    <button type="button" onClick={() => cart.set(i, i.qty - 1)} disabled={i.qty <= 1} aria-label="Menos">−</button>
                    <input inputMode="numeric" value={i.qty} onChange={(e) => cart.set(i, Number(e.target.value.replace(/\D/g, '')) || 1)} aria-label="Quantidade" />
                    <button type="button" onClick={() => cart.set(i, i.qty + 1)} aria-label="Mais">+</button>
                  </div>
                  <b className="kw-cart-sub">{kz(i.price * i.qty)}</b>
                  <button type="button" className="kw-cart-x" onClick={() => cart.remove(i)} aria-label={`Remover ${i.name}`}><I d={P.trash} size={16} /></button>
                </div>
              ))}
            </div>
          </section>
          <section className="kw-sec"><header className="kw-sec-h"><h3>Os seus dados</h3></header>
            <div className="kw-form2 kw-sec-b">
              <label className="kw-f"><span>Nome</span><input value={f.name} onChange={set('name')} autoComplete="name" required minLength={2} maxLength={120} /></label>
              <label className="kw-f"><span>Telefone</span><input value={f.phone} onChange={set('phone')} inputMode="tel" autoComplete="tel" required placeholder="9XX XXX XXX" /></label>
              <div className="kw-f kw-f-wide"><span>Entrega</span>
                <div className="kw-seg2" role="radiogroup" aria-label="Entrega">
                  <button type="button" role="radio" aria-checked={f.delivery === 'DELIVERY'} className={f.delivery === 'DELIVERY' ? 'on' : ''} onClick={() => setF({ ...f, delivery: 'DELIVERY' })}><I d={P.truck} size={16} /> Entregar na morada</button>
                  <button type="button" role="radio" aria-checked={f.delivery === 'PICKUP'} className={f.delivery === 'PICKUP' ? 'on' : ''} onClick={() => setF({ ...f, delivery: 'PICKUP' })}><I d={P.bag} size={16} /> Levantar na loja</button>
                </div>
              </div>
              {f.delivery === 'DELIVERY' ? <>
                <label className="kw-f kw-f-wide"><span>Morada</span><input value={f.address} onChange={set('address')} autoComplete="street-address" maxLength={300} /></label>
                <label className="kw-f"><span>Província</span><input value={f.province} onChange={set('province')} maxLength={80} /></label>
                <label className="kw-f"><span>Município</span><input value={f.municipality} onChange={set('municipality')} maxLength={80} /></label>
              </> : null}
              <label className="kw-f kw-f-wide"><span>Observações</span><textarea rows={2} value={f.notes} onChange={set('notes')} maxLength={500} /></label>
            </div>
          </section>
          <section className="kw-sec"><header className="kw-sec-h"><h3>Pagamento</h3></header>
            <div className="kw-sec-b kw-paygroups">
              {companies.map(([code, name]) => (
                <div key={code} className="kw-paygroup">
                  {companies.length > 1 ? <small>{name}</small> : null}
                  <div className="kw-paylist" role="radiogroup" aria-label={`Pagamento ${name}`}>
                    {(methods[code]?.length ? methods[code] : [{ type: 'CASH', label: 'Numerário na entrega' } as PaymentMethod]).map((m) => (
                      <button type="button" key={m.type} role="radio" aria-checked={pay[code] === m.type} className={pay[code] === m.type ? 'on' : ''} onClick={() => setPay({ ...pay, [code]: m.type })}>
                        <I d={m.type === 'CASH' ? P.card : P.card} size={18} /><span>{m.label || PAY[m.type] || m.type}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
        <aside className="kw-shop-side">
          <GpsBar g={g} />
          <div className="kw-shop-sum">
            <div><span>Produtos ({items.reduce((s, i) => s + i.qty, 0)})</span><b>{kz(total)}</b></div>
            <div className="tot"><span>Total</span><b>{kz(total)}</b></div>
            {err ? <div className="kw-err" role="alert">{err}</div> : null}
            <button className="kw-btn kw-btn-primary kw-block kw-buy" disabled={busy || g.busy}>{busy ? 'A concluir…' : g.fix ? 'Concluir encomenda' : 'Ativar GPS e concluir'}</button>
          </div>
        </aside>
      </div>
    </form>
  );
}
const PAY: Record<string, string> = { CASH: 'Numerário na entrega', BANK_TRANSFER: 'Transferência bancária', MULTICAIXA_EXPRESS: 'Multicaixa Express', REFERENCE: 'Pagamento por referência' };

/* ═══════════════ minhas compras (ativar GPS) ═══════════════ */
const STEPS: [string, string][] = [['PENDING', 'Encomenda feita'], ['PAID', 'Paga'], ['SHIPPED', 'Em entrega'], ['DELIVERED', 'Entregue']];
export const ORDER_LABEL: Record<string, string> = { PENDING: 'Encomenda feita', PAID: 'Paga', SHIPPED: 'Em entrega', DELIVERED: 'Entregue', CANCELLED: 'Cancelada' };

export function Timeline({ status, claimed }: { status: string; claimed?: boolean }) {
  if (status === 'CANCELLED') return <div className="kw-tl cancel"><span className="kw-pill kw-st-CANCELLED">Cancelada</span></div>;
  const at = Math.max(0, STEPS.findIndex(([k]) => k === status));
  return (
    <ol className="kw-tl" aria-label="Estado da encomenda">
      {STEPS.map(([k, l], i) => (
        <li key={k} className={i < at ? 'done' : i === at ? 'now' : ''}><i>{i < at ? <I d={P.check} size={12} /> : i + 1}</i><span>{i === 0 && claimed && at === 0 ? 'Pagamento enviado' : l}</span></li>
      ))}
    </ol>
  );
}

export function Orders({ go }: { go(r: { n: 'home' } | { n: 'cart' }): void }) {
  const g = useGps(true);
  const [list, setList] = useState<KOrder[] | null>(null);
  const [findF, setFindF] = useState({ phone: '', orderNumber: '' });
  const [findErr, setFindErr] = useState<string | null>(null);
  const load = useCallback(() => { const t = myOrders.tokens(); if (!t.length) { setList([]); return; } kw.orders(t).then(setList).catch(() => setList((x) => x ?? [])); }, []);
  // Tempo real: volta a ler o estado e envia a localização enquanto a entrega está ativa.
  const fixRef = useRef<GeoFix | null>(null); fixRef.current = g.fix;
  useEffect(() => {
    if (!g.fix) return;
    load();
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      load();
      getHighAccuracyPosition(10000).then((fix) => {
        fixRef.current = fix;
        for (const o of listRef.current ?? []) if (['PENDING', 'PAID', 'SHIPPED'].includes(o.status)) void kw.orderLocation(o.token, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }).catch(() => undefined);
      }).catch(() => undefined);
    };
    const t = window.setInterval(tick, 10_000);
    // Ao voltar ao ecrã (outro separador, app em segundo plano), atualiza logo.
    document.addEventListener('visibilitychange', tick); window.addEventListener('focus', tick);
    return () => { window.clearInterval(t); document.removeEventListener('visibilitychange', tick); window.removeEventListener('focus', tick); };
  }, [g.fix, load]);
  const listRef = useRef<KOrder[] | null>(null); listRef.current = list;
  useEffect(() => {
    if (!g.fix || !list) return;
    for (const o of list) if (['PENDING', 'PAID', 'SHIPPED'].includes(o.status)) void kw.orderLocation(o.token, { lat: g.fix.lat, lng: g.fix.lng, accuracy: g.fix.accuracy }).catch(() => undefined);
  }, [g.fix, list?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const find = async (e: React.FormEvent) => {
    e.preventDefault(); setFindErr(null);
    try { const o = await kw.findOrder(findF.phone, findF.orderNumber); myOrders.add(o.token); setFindF({ phone: '', orderNumber: '' }); load(); }
    catch (er) { setFindErr(er instanceof ApiError ? er.message : 'Não foi possível procurar.'); }
  };
  return (
    <div className="kw-container kw-shop">
      <h1 className="kw-shop-t"><I d={P.box} size={22} /> Minhas compras</h1>
      {!g.fix ? <div className="kw-orders-gate"><GpsBar g={g} /></div> : (
        <>
          {list === null ? <div className="kw-loader" aria-busy="true"><i /><i /><i /></div>
            : !list.length ? <div className="kw-shop-empty"><span><I d={P.box} size={34} /></span><b>Sem compras neste aparelho</b><button className="kw-btn kw-btn-primary" onClick={() => go({ n: 'home' })}>Ver produtos</button></div>
            : <div className="kw-orders">{list.map((o) => <OrderCard key={o.token} o={o} onChange={load} />)}</div>}
          <section className="kw-sec kw-find">
            <header className="kw-sec-h"><h3>Encontrar uma compra</h3></header>
            <form className="kw-form2 kw-sec-b" onSubmit={(e) => void find(e)}>
              <label className="kw-f"><span>Telefone da encomenda</span><input value={findF.phone} onChange={(e) => setFindF({ ...findF, phone: e.target.value })} inputMode="tel" required /></label>
              <label className="kw-f"><span>N.º da encomenda</span><input value={findF.orderNumber} onChange={(e) => setFindF({ ...findF, orderNumber: e.target.value })} required placeholder="WEB/2026/0001" /></label>
              {findErr ? <div className="kw-err kw-f-wide" role="alert">{findErr}</div> : null}
              <button className="kw-btn kw-btn-outline kw-f-wide">Procurar</button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}

function OrderCard({ o, onChange }: { o: KOrder; onChange(): void }) {
  return (
    <article className="kw-order">
      <header className="kw-order-h">
        <div><b>{o.orderNumber}</b><small>{o.companyName} · {formatDateTime(o.date)}</small></div>
        <b className="kw-order-tot">{kz(o.total)}</b>
      </header>
      <Timeline status={o.status} claimed={o.paymentClaimed} />
      <div className="kw-order-items">
        {o.items.map((i) => <div key={i.productCode} className="kw-order-it"><span className="kw-cart-pic">{i.imageUrl ? <img src={i.imageUrl} alt="" /> : null}</span><span>{i.name}</span><small>{i.quantity} un.</small><b>{kz(i.total)}</b></div>)}
      </div>
      <div className="kw-order-meta">
        <span><I d={o.deliveryMethod === 'PICKUP' ? P.bag : P.truck} size={15} /> {o.deliveryMethod === 'PICKUP' ? 'Levantar na loja' : o.address || 'Entrega'}</span>
        {o.gpsAt && ['PENDING', 'PAID', 'SHIPPED'].includes(o.status) ? <span className="ok"><I d={P.pin} size={15} /> Localização partilhada {formatDateTime(o.gpsAt)}</span> : null}
      </div>
      {o.status === 'PENDING' && !o.paymentClaimed && o.paymentMethod && o.paymentMethod !== 'CASH' ? <PayBox o={o} onDone={onChange} /> : null}
      {o.status === 'PENDING' && (o.paymentMethod === 'CASH' || !o.paymentMethod) ? <div className="kw-order-note">Paga em numerário na entrega.</div> : null}
    </article>
  );
}

/** Pagar a encomenda dentro do LPS Kwanza: referência, comprovativo de transferência ou Express. */
function PayBox({ o, onDone }: { o: KOrder; onDone(): void }) {
  const [m, setM] = useState<PaymentMethod | null>(null);
  const [ref, setRef] = useState<{ entity?: string; reference?: string; amount?: number; message?: string } | null>(null);
  const [file, setFile] = useState<{ name: string; mime: string; data: string } | null>(null);
  const [phone, setPhone] = useState('');
  const [err, setErr] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  useEffect(() => { api.paymentMethods(o.companyCode).then((ms) => setM(ms.find((x) => x.type === o.paymentMethod) ?? null)).catch(() => undefined); }, [o.companyCode, o.paymentMethod]);
  const run = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onDone(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível concluir.'); } finally { setBusy(false); } };
  const pick = async (fl: FileList | null) => {
    const x = fl?.[0]; if (!x) return;
    if (x.size > 4_000_000) { setErr('O comprovativo tem mais de 4 MB.'); return; }
    if (!/^(image\/|application\/pdf)/.test(x.type)) { setErr('Envie uma imagem ou PDF.'); return; }
    const data = await readFileProgress(x);
    setFile({ name: x.name, mime: x.type, data: data.replace(/^data:[^,]+,/, '') });
  };
  if (o.paymentMethod === 'REFERENCE') return (
    <div className="kw-paybox">
      {ref?.reference ? <div className="kw-refbox"><div><small>Entidade</small><b>{ref.entity}</b></div><div><small>Referência</small><b>{ref.reference}</b></div><div><small>Valor</small><b>{kz(ref.amount ?? o.total)}</b></div></div>
        : <button className="kw-btn kw-btn-primary" disabled={busy} onClick={() => void run(async () => { const r = await api.generateReference(o.companyCode, o.orderId); if (!r.available) throw new ApiError(400, r.message ?? 'Referência indisponível.'); setRef(r); })}>Gerar referência de pagamento</button>}
      {err ? <div className="kw-err" role="alert">{err}</div> : null}
    </div>
  );
  if (o.paymentMethod === 'MULTICAIXA_EXPRESS') return (
    <div className="kw-paybox">
      <label className="kw-f"><span>Telefone Multicaixa Express</span><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" placeholder="9XX XXX XXX" /></label>
      {err ? <div className="kw-err" role="alert">{err}</div> : null}
      <button className="kw-btn kw-btn-primary" disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={() => void run(() => api.payExpress(o.companyCode, o.orderId, { expressPhone: phone.replace(/\D/g, '') }))}>Pagar {kz(o.total)}</button>
    </div>
  );
  return (
    <div className="kw-paybox">
      {m?.iban ? <div className="kw-refbox"><div><small>Banco</small><b>{m.bank_name ?? '—'}</b></div><div><small>IBAN</small><b className="mono">{m.iban}</b></div><div><small>Titular</small><b>{m.account_holder ?? '—'}</b></div><div><small>Valor</small><b>{kz(o.total)}</b></div></div> : null}
      <label className="kw-btn kw-btn-outline kw-file"><I d={P.doc} size={16} /> {file ? file.name : 'Escolher comprovativo'}<input type="file" accept="image/*,application/pdf" hidden onChange={(e) => { void pick(e.target.files); e.target.value = ''; }} /></label>
      {err ? <div className="kw-err" role="alert">{err}</div> : null}
      <button className="kw-btn kw-btn-primary" disabled={busy || !file} onClick={() => void run(() => api.uploadProof(o.companyCode, o.orderId, { methodType: o.paymentMethod ?? 'BANK_TRANSFER', amount: o.total, fileName: file!.name, fileMime: file!.mime, fileData: file!.data }))}>Enviar comprovativo</button>
    </div>
  );
}
