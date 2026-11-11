import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { CatalogProduct } from '../api/types';
import { formatKz } from '../format';

export const BRAND = 'LPS Kwanza';

/* ───────────── ícones (traço simples, desenho próprio) ───────────── */
export const P = {
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
  cart: 'M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6M10 21h.01M18 21h.01',
  user: 'M20 21a8 8 0 0 0-16 0M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8z',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  close: 'M18 6 6 18M6 6l12 12',
  trash: 'M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6',
  check: 'M20 6 9 17l-5-5',
  filter: 'M3 5h18M6 12h12M10 19h4',
  out: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  mail: 'M4 4h16v16H4zM4 6l8 7 8-7',
  phone: 'M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8.1 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z',
  bag: 'M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18M16 10a4 4 0 0 1-8 0',
  doc: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M8 13h8M8 17h6',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 16v-4M12 8h.01',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z',
  heart: 'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z',
  truck: 'M1 3h15v13H1zM16 8h4l3 3v5h-7M5.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM18.5 21a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
  chat: 'M21 11.5a8.4 8.4 0 0 1-8.5 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8A8.5 8.5 0 0 1 12.5 3a8.4 8.4 0 0 1 8.5 8.5z',
  pin: 'M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0zM12 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  card: 'M2 5h20v14H2zM2 10h20',
  box: 'M21 16V8l-9-5-9 5v8l9 5 9-5zM3.3 7 12 12l8.7-5M12 22V12',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
export const I = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>
);

/** Marca da LPS Kwanza: azul cromado com carrinho, no estilo do logótipo LPS Vendas. */
export function Mark({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="mk-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#ffffff" /><stop offset="1" stopColor="#dfe4ff" /></linearGradient>
      </defs>
      <rect width="40" height="40" rx="10" fill="url(#mk-g)" />
      <path d="M6 11h4l3.2 13a2 2 0 0 0 2 1.5h10.6a2 2 0 0 0 2-1.5L30 15H11" fill="none" stroke="#1a24c4" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="16" cy="31" r="2.3" fill="#1a24c4" /><circle cx="26" cy="31" r="2.3" fill="#1a24c4" />
      <path d="M4 21c4-8 14-12 30-9" fill="none" stroke="#3a4bff" strokeWidth="1.8" strokeLinecap="round" opacity=".7" />
    </svg>
  );
}

export const pct = (p: CatalogProduct): number =>
  p.promo?.percent ?? (p.listPrice && p.listPrice > p.grossPrice ? Math.round((1 - p.grossPrice / p.listPrice) * 100) : 0);
export const kz = (n: number | string) => formatKz(n).replace(/,00 Kz$/, ' Kz');
export const canBuy = (p: CatalogProduct) => p.inStock || !!p.madeToOrder;

export function Pic({ p, className = '' }: { p: CatalogProduct; className?: string }) {
  const [broken, setBroken] = useState(false);
  return p.imageUrl && !broken
    ? <img className={`kw-pic ${className}`} src={p.imageUrl} alt={p.name} loading="lazy" onError={() => setBroken(true)} />
    : <div className={`kw-pic kw-pic-ph ${className}`} aria-hidden="true">{p.name.slice(0, 1).toUpperCase()}</div>;
}

/* ───────────── cartão de produto (desenho do Kikolo, cor da marca azul) ───────────── */
export function Card({ p, onOpen, onAdd, cod, hot }: { p: CatalogProduct; onOpen(): void; onAdd(): void; cod: boolean; hot?: boolean }) {
  const d = pct(p);
  const ok = canBuy(p);
  return (
    <article className="kw-card">
      <div className="kw-card-img">
        <button className="kw-card-imgbtn" onClick={onOpen} aria-label={p.name} tabIndex={-1}><Pic p={p} /></button>
        <button className="kw-card-cart" onClick={onAdd} disabled={!ok} aria-label={`Adicionar ${p.name} ao carrinho`}><I d={P.cart} size={16} /></button>
        {(p.views ?? 0) > 0 ? <span className="kw-card-sold" title="Visualizações"><I d={P.eye} size={13} />{p.views}</span> : null}
        {hot ? <span className="kw-card-hot">Em alta</span> : null}
        {cod ? <span className="kw-card-pay"><i aria-hidden="true" />Pagamento na entrega</span> : null}
        {d > 0 ? <span className="kw-card-off">-{d}%</span> : null}
      </div>
      <button className="kw-card-body" onClick={onOpen}>
        <h3>{p.name}</h3>
        <div className="kw-card-prices">
          {d > 0 && p.listPrice ? <span className="kw-card-old"><s>{kz(p.listPrice)}</s></span> : null}
          <b>{kz(p.grossPrice)}</b>
        </div>
        <div className="kw-card-ship">
          <span className={`kw-card-tag${ok ? '' : ' out'}`}>{ok ? 'Disponível ⚡' : 'Esgotado'}</span>
          {ok ? <small>{p.stockQty != null && !p.madeToOrder && p.stockQty <= 10 ? <>Restam <b>{Math.floor(p.stockQty)}</b></> : <>Pronto para <b>envio</b></>}</small> : null}
        </div>
      </button>
    </article>
  );
}

/** Esqueleto enquanto o catálogo chega (brilho a passar). */
export function CardSkeleton() {
  return <div className="kw-card kw-skel" aria-hidden="true"><div className="kw-card-img" /><div className="kw-skel-l" /><div className="kw-skel-l s" /></div>;
}

/* ───────────── prateleira horizontal com setas (scroll-snap) ───────────── */
export function Shelf({ title, action, items, render, head, icon, className = '' }: {
  title: React.ReactNode; action?: React.ReactNode; items: CatalogProduct[]; render(p: CatalogProduct): React.ReactNode;
  head?: React.ReactNode; icon?: React.ReactNode; className?: string;
}) {
  const track = useRef<HTMLDivElement | null>(null);
  const [edge, setEdge] = useState({ l: true, r: false });
  const upd = useCallback(() => {
    const t = track.current; if (!t) return;
    setEdge({ l: t.scrollLeft <= 4, r: t.scrollLeft + t.clientWidth >= t.scrollWidth - 4 });
  }, []);
  useEffect(() => { upd(); }, [items, upd]);
  const go = (dir: number) => { const t = track.current; if (t) t.scrollBy({ left: dir * t.clientWidth * 0.9, behavior: 'smooth' }); };
  if (!items.length) return null;
  const label = typeof title === 'string' ? title : '';
  return (
    <section className={`kw-sec kw-reveal ${className}`}>
      {head ?? <header className="kw-sec-head"><h2>{icon}{title}</h2>{action}</header>}
      <div className="kw-shelf">
        <button className="kw-arrow l" onClick={() => go(-1)} disabled={edge.l} aria-label={`Ver os produtos anteriores de ${label}`}><I d={P.back} size={18} /></button>
        <div className="kw-shelf-track" ref={track} onScroll={upd}>
          {items.map((p) => <div className="kw-shelf-item" key={p.code}>{render(p)}</div>)}
        </div>
        <button className="kw-arrow r" onClick={() => go(1)} disabled={edge.r} aria-label={`Ver mais produtos de ${label}`}><I d={P.next} size={18} /></button>
      </div>
    </section>
  );
}

/* ───────────── carrossel de anúncios (desliza a cada 4 s, setas e pontos) ───────────── */
export interface Slide { id: string; title: string; subtitle?: string | null; image?: string | null; cta?: string | null; tone: number; onClick?: () => void }

export function Carousel({ slides, className = '', interval = 4000 }: { slides: Slide[]; className?: string; interval?: number }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const touch = useRef<number | null>(null);
  const n = slides.length;
  useEffect(() => { if (i >= n) setI(0); }, [n, i]);
  useEffect(() => {
    if (n < 2 || paused) return;
    const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % n), interval);
    return () => window.clearInterval(t);
  }, [n, paused, interval]);
  if (!n) return null;
  return (
    <div className={`kw-car ${className}`} onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onTouchStart={(e) => { touch.current = e.touches[0].clientX; setPaused(true); }}
      onTouchEnd={(e) => {
        const s = touch.current; touch.current = null; setPaused(false);
        if (s == null) return; const dx = e.changedTouches[0].clientX - s;
        if (Math.abs(dx) > 40) setI((x) => (x + (dx < 0 ? 1 : -1) + n) % n);
      }}>
      <div className="kw-car-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {slides.map((s, k) => (
          <button key={s.id} className={`kw-slide tone-${s.tone % 4}`} onClick={s.onClick} aria-hidden={k !== i} tabIndex={k === i ? 0 : -1}>
            {s.image ? <img src={s.image} alt="" loading={k === 0 ? 'eager' : 'lazy'} /> : null}
            <span className="kw-slide-txt">
              <strong>{s.title}</strong>
              {s.subtitle ? <small>{s.subtitle}</small> : null}
              {s.cta ? <em>{s.cta}</em> : null}
            </span>
          </button>
        ))}
      </div>
      {n > 1 ? (
        <>
          <div className="kw-car-arrows">
            <button className="kw-car-nav" onClick={() => setI((x) => (x - 1 + n) % n)} aria-label="Slide anterior"><I d={P.back} size={18} /></button>
            <button className="kw-car-nav" onClick={() => setI((x) => (x + 1) % n)} aria-label="Próximo slide"><I d={P.next} size={18} /></button>
          </div>
          <div className="kw-car-dots">
            {slides.map((s, k) => <button key={s.id} className={k === i ? 'on' : ''} onClick={() => setI(k)} aria-label={`Ir para slide ${k + 1}`} />)}
          </div>
        </>
      ) : null}
    </div>
  );
}

/* ───────────── contagem decrescente ───────────── */
export function useCountdown(endsAt: string | null): [string, string, string] | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { if (!endsAt) return; const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t); }, [endsAt]);
  if (!endsAt) return null;
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const s = Math.floor(ms / 1000);
  const z = (v: number) => String(v).padStart(2, '0');
  return [z(Math.min(99, Math.floor(s / 3600))), z(Math.floor((s % 3600) / 60)), z(s % 60)];
}

/* ───────────── revelar secções ao fazer scroll ───────────── */
export function useReveal(dep: unknown) {
  useEffect(() => {
    const els = Array.from(document.querySelectorAll<HTMLElement>('.kw-reveal:not(.in)'));
    if (typeof IntersectionObserver === 'undefined') { els.forEach((e) => e.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } });
    }, { rootMargin: '0px 0px -40px 0px' });
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [dep]);
}

/* ───────────── carregamento infinito ───────────── */
export function useInfinite(total: number, step = 20, reset: unknown = null): [number, React.RefObject<HTMLDivElement>] {
  const [n, setN] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => { setN(step); }, [reset, step]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || n >= total) return;
    if (typeof IntersectionObserver === 'undefined') { setN(total); return; }
    const io = new IntersectionObserver((en) => { if (en[0].isIntersecting) setN((x) => Math.min(total, x + step)); }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, [n, total, step]);
  return [Math.min(n, total), sentinel];
}

/* ───────────── vistos recentemente (só neste aparelho) ───────────── */
const RV = (code: string) => `ndombaxi.kw.recent.${code}`;
export function readRecent(code: string): string[] {
  try { const v = JSON.parse(localStorage.getItem(RV(code)) || '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
export function pushRecent(code: string, productCode: string) {
  try { localStorage.setItem(RV(code), JSON.stringify([productCode, ...readRecent(code).filter((c) => c !== productCode)].slice(0, 20))); } catch { /* indisponível */ }
}
