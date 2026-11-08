import React, { useEffect, useState } from 'react';
import type { CatalogProduct, PublicCoupon } from '../api/types';
import { api } from '../api/client';
import { formatKz } from '../format';
import { IconChevronRight, IconClock } from './Icons';
import { ProductCard } from './ProductCard';

export const COUPON_KEY = 'ndombaxi.store.coupon';

/** Tempo restante até `endsAt` (actualiza a cada segundo); null sem fim/expirado. */
export function useCountdown(endsAt: string | null | undefined): { d: number; h: number; m: number; s: number } | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [endsAt]);
  if (!endsAt) return null;
  const left = Date.parse(endsAt) - now;
  if (!Number.isFinite(left) || left <= 0) return null;
  const s = Math.floor(left / 1000);
  return { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
}

const two = (n: number) => String(n).padStart(2, '0');

export function Countdown({ endsAt, label = 'Termina em' }: { endsAt: string | null | undefined; label?: string }) {
  const c = useCountdown(endsAt);
  if (!c) return null;
  return (
    <span className="ax-count" role="timer" aria-label={`${label} ${c.d} dias ${c.h} horas ${c.m} minutos`}>
      <IconClock size={14} /> {label}
      {c.d > 0 ? <b>{c.d}d</b> : null}
      <b>{two(c.h)}</b>:<b>{two(c.m)}</b>:<b>{two(c.s)}</b>
    </span>
  );
}

/** Carrossel horizontal de produtos com título e "Ver mais". */
export function ProductRail({ title, extra, items, onOpen, onAdd, onMore, moreLabel = 'Ver mais', className }: {
  title: React.ReactNode;
  extra?: React.ReactNode;
  items: CatalogProduct[];
  onOpen(p: CatalogProduct): void;
  onAdd(p: CatalogProduct): void;
  onMore?(): void;
  moreLabel?: string;
  className?: string;
}) {
  if (!items.length) return null;
  return (
    <section className={`ax-section${className ? ` ${className}` : ''}`}>
      <div className="ax-section-head">
        <h2 className="ax-section-title">{title}</h2>
        {extra}
        <span className="spacer" />
        {onMore ? <button className="ax-link" onClick={onMore}>{moreLabel} <IconChevronRight size={15} /></button> : null}
      </div>
      <div className="ax-rail">
        {items.map((p) => <div className="ax-rail-item" key={p.code}><ProductCard product={p} onOpen={onOpen} onAdd={onAdd} /></div>)}
      </div>
    </section>
  );
}

/** Ofertas relâmpago: produtos com promoção activa, maior desconto primeiro,
 *  com a contagem decrescente da promoção que acaba mais cedo. */
export function FlashDeals({ products, onOpen, onAdd, onMore }: {
  products: CatalogProduct[];
  onOpen(p: CatalogProduct): void;
  onAdd(p: CatalogProduct): void;
  onMore(): void;
}) {
  const deals = products.filter((p) => p.promo && p.listPrice && p.listPrice > p.grossPrice)
    .sort((a, b) => (b.promo!.percent - a.promo!.percent));
  const ends = deals.map((p) => p.promo!.endsAt).filter((x): x is string => !!x && Date.parse(x) > Date.now()).sort()[0] ?? null;
  return (
    <ProductRail className="ax-flash" title="Ofertas relâmpago" extra={<Countdown endsAt={ends} />}
      items={deals.slice(0, 16)} onOpen={onOpen} onAdd={onAdd} onMore={onMore} />
  );
}

/** Cupões que a loja mostra na montra: "Usar" guarda o código para o checkout. */
export function CouponStrip({ code }: { code: string }) {
  const [list, setList] = useState<PublicCoupon[]>([]);
  const [picked, setPicked] = useState<string | null>(() => { try { return sessionStorage.getItem(COUPON_KEY); } catch { return null; } });
  useEffect(() => {
    let alive = true;
    api.coupons(code).then((l) => { if (alive) setList(l); }).catch(() => undefined);
    return () => { alive = false; };
  }, [code]);
  if (!list.length) return null;
  const use = (c: string) => {
    try { sessionStorage.setItem(COUPON_KEY, c); } catch { /* sem armazenamento */ }
    void navigator.clipboard?.writeText(c).catch(() => undefined);
    setPicked(c);
  };
  return (
    <section className="ax-coupons" aria-label="Cupões">
      {list.map((c) => (
        <div className="ax-ticket" key={c.code}>
          <div className="v">{c.type === 'PERCENT' ? `${c.value}% off` : `${formatKz(c.value)} off`}</div>
          {c.minOrder > 0 ? <div className="m">em compras a partir de {formatKz(c.minOrder)}</div> : null}
          <div className="c">Código: <b>{c.code}</b></div>
          {c.endsAt ? <Countdown endsAt={c.endsAt} label="Termina em" /> : null}
          <button className={`btn sm${picked === c.code ? ' ghost' : ''}`} onClick={() => use(c.code)}>{picked === c.code ? 'Guardado' : 'Usar'}</button>
        </div>
      ))}
    </section>
  );
}
