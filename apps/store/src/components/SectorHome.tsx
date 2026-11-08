import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { CatalogProduct, StoreRoom } from '../api/types';
import { formatKz } from '../format';
import { AppointmentModal, ReservationModal, ServiceRequestModal } from './VerticalRequest';
import { IconBed, IconCalendar, IconImage, IconPill, IconPlus, IconStethoscope, IconUser, IconWrench, IconClock, IconBike, IconReceipt } from './Icons';

type Prefill = { name?: string; phone?: string; email?: string };
const ymd = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const addDays = (d: string, n: number) => { const x = new Date(d + 'T00:00:00'); x.setDate(x.getDate() + n); return ymd(x); };

/**
 * Montra própria de cada MODELO de negócio (loja online por setor):
 * Restaurante → cardápio por categorias; Hotel → quartos com disponibilidade;
 * Clínica → especialidades e médicos; Serviços → catálogo + pedido de orçamento;
 * Farmácia → categorias de saúde. Retalho não tem secção própria (usa o catálogo).
 */
export function SectorHome(props: {
  code: string; businessType: string; products: CatalogProduct[]; prefill?: Prefill;
  onAdd(p: CatalogProduct): void; onOpen(p: CatalogProduct): void; onCategory(c: string): void;
}) {
  switch (props.businessType) {
    case 'RESTAURANT': return <MenuBoard {...props} />;
    case 'HOSPITALITY': return <RoomsBoard code={props.code} prefill={props.prefill} />;
    case 'CLINIC': return <DoctorsBoard code={props.code} prefill={props.prefill} />;
    case 'SERVICES': return <ServicesBoard {...props} />;
    case 'PHARMACY': return <PharmacyBoard {...props} />;
    default: return null;
  }
}

/** Setores cuja montra substitui o feed genérico de produtos. */
export const SECTOR_REPLACES_FEED = new Set(['RESTAURANT']);

function MenuBoard({ products, onAdd, onOpen }: { products: CatalogProduct[]; onAdd(p: CatalogProduct): void; onOpen(p: CatalogProduct): void }) {
  const cats = useMemo(() => {
    const m = new Map<string, CatalogProduct[]>();
    for (const p of products) { const c = p.category || 'Outros'; m.set(c, [...(m.get(c) ?? []), p]); }
    return [...m.entries()];
  }, [products]);
  const [active, setActive] = useState('');
  const shown = active ? cats.filter(([c]) => c === active) : cats;
  if (products.length === 0) return null;
  return (
    <section className="ax-section sx" id="setor">
      <div className="ax-section-head">
        <h2 className="ax-section-title">Cardápio</h2>
        <div className="sx-meta"><span><IconBike size={15} /> Entrega</span><span><IconClock size={15} /> Feito na hora</span></div>
      </div>
      {cats.length > 1 ? (
        <div className="sx-tabs" role="tablist">
          <button role="tab" aria-selected={!active} className={!active ? 'on' : ''} onClick={() => setActive('')}>Tudo</button>
          {cats.map(([c]) => <button key={c} role="tab" aria-selected={active === c} className={active === c ? 'on' : ''} onClick={() => setActive(c)}>{c}</button>)}
        </div>
      ) : null}
      {shown.map(([c, list]) => (
        <div key={c} className="sx-menu-group">
          {cats.length > 1 ? <h3 className="sx-h3">{c}</h3> : null}
          <div className="sx-menu">
            {list.map((p) => {
              const off = !p.inStock && !p.madeToOrder && !p.canProduce;
              return (
                <div key={p.code} className={`sx-dish${off ? ' off' : ''}`}>
                  <button className="sx-dish-main" onClick={() => onOpen(p)}>
                    <div className="sx-dish-tx">
                      <strong>{p.name}</strong>
                      {p.description ? <span className="sx-desc">{p.description}</span> : null}
                      <span className="sx-price">{formatKz(p.grossPrice)}</span>
                    </div>
                    <div className="sx-dish-img">{p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" /> : <IconImage size={22} />}</div>
                  </button>
                  <button className="sx-add" onClick={() => onAdd(p)} disabled={off} aria-label={`Adicionar ${p.name}`}>{off ? 'Esgotado' : <IconPlus size={18} />}</button>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}

function RoomsBoard({ code, prefill }: { code: string; prefill?: Prefill }) {
  const [checkIn, setCheckIn] = useState(today());
  const [checkOut, setCheckOut] = useState(addDays(today(), 1));
  const [rooms, setRooms] = useState<StoreRoom[] | null>(null);
  const [book, setBook] = useState<StoreRoom | null>(null);
  useEffect(() => {
    if (checkOut <= checkIn) return;
    let alive = true; setRooms(null);
    api.rooms(code, checkIn, checkOut).then((r) => { if (alive) setRooms(r.rooms); }).catch(() => { if (alive) setRooms([]); });
    return () => { alive = false; };
  }, [code, checkIn, checkOut]);
  const nights = Math.max(1, Math.round((new Date(checkOut + 'T00:00:00').getTime() - new Date(checkIn + 'T00:00:00').getTime()) / 86400000));
  return (
    <section className="ax-section sx" id="setor">
      <div className="ax-section-head"><h2 className="ax-section-title">Quartos disponíveis</h2></div>
      <div className="sx-dates">
        <label><span><IconCalendar size={15} /> Entrada</span><input type="date" min={today()} value={checkIn} onChange={(e) => { setCheckIn(e.target.value); if (e.target.value >= checkOut) setCheckOut(addDays(e.target.value, 1)); }} /></label>
        <label><span><IconCalendar size={15} /> Saída</span><input type="date" min={addDays(checkIn, 1)} value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></label>
        <div className="sx-nights">{nights} noite(s)</div>
      </div>
      {rooms === null ? <div className="empty"><div className="ax-spin" /></div>
        : rooms.length === 0 ? <div className="empty"><IconBed size={40} /><p>Sem quartos livres nestas datas.</p></div>
        : (
          <div className="sx-cards">
            {rooms.map((r) => (
              <article key={r.id} className="sx-card">
                <div className="sx-card-img">{r.photo_url ? <img src={r.photo_url} alt={r.name} loading="lazy" /> : <IconBed size={34} />}</div>
                <div className="sx-card-bd">
                  <strong>{r.name}</strong>
                  <span className="sx-desc">{[r.category || r.room_type || 'Quarto', `${r.capacity} pessoa(s)`].join(' · ')}</span>
                  <div className="sx-card-ft">
                    <span><b className="sx-price">{formatKz(Number(r.rate))}</b> / noite</span>
                    <button className="btn" onClick={() => setBook(r)}>Reservar</button>
                  </div>
                  <span className="sx-total">Total {formatKz(Number(r.rate) * nights)}</span>
                </div>
              </article>
            ))}
          </div>
        )}
      {book ? <ReservationModal code={code} prefill={prefill} initial={{ roomId: book.id, checkIn, checkOut }} onClose={() => setBook(null)} /> : null}
    </section>
  );
}

function DoctorsBoard({ code, prefill }: { code: string; prefill?: Prefill }) {
  const [docs, setDocs] = useState<{ name: string; specialty: string | null }[] | null>(null);
  const [spec, setSpec] = useState('');
  const [book, setBook] = useState<{ professional?: string; specialty?: string } | null>(null);
  useEffect(() => { api.professionals(code).then((r) => setDocs(r.professionals || [])).catch(() => setDocs([])); }, [code]);
  const specialties = useMemo(() => [...new Set((docs ?? []).map((d) => d.specialty).filter(Boolean))] as string[], [docs]);
  const shown = (docs ?? []).filter((d) => !spec || d.specialty === spec);
  return (
    <section className="ax-section sx" id="setor">
      <div className="ax-section-head">
        <h2 className="ax-section-title">Marcar consulta</h2>
        <button className="btn" onClick={() => setBook({ specialty: spec || undefined })}><IconCalendar size={16} /> Marcar</button>
      </div>
      {specialties.length > 0 ? (
        <div className="sx-tabs" role="tablist">
          <button className={!spec ? 'on' : ''} aria-selected={!spec} onClick={() => setSpec('')}>Todas</button>
          {specialties.map((s) => <button key={s} className={spec === s ? 'on' : ''} aria-selected={spec === s} onClick={() => setSpec(s)}>{s}</button>)}
        </div>
      ) : null}
      {docs === null ? <div className="empty"><div className="ax-spin" /></div>
        : shown.length === 0 ? (
          <button className="ax-cta" onClick={() => setBook({})}>
            <span className="ic" aria-hidden><IconStethoscope size={18} /></span>
            <span className="tx"><strong>Marcar uma consulta</strong></span>
          </button>
        ) : (
          <div className="sx-cards sm">
            {shown.map((d) => (
              <article key={d.name} className="sx-card row">
                <div className="sx-avatar"><IconUser size={22} /></div>
                <div className="sx-card-bd">
                  <strong>{d.name}</strong>
                  <span className="sx-desc">{d.specialty || 'Clínica geral'}</span>
                </div>
                <button className="btn" onClick={() => setBook({ professional: d.name, specialty: d.specialty || undefined })}>Marcar</button>
              </article>
            ))}
          </div>
        )}
      {book ? <AppointmentModal code={code} prefill={prefill} initial={book} onClose={() => setBook(null)} /> : null}
    </section>
  );
}

function ServicesBoard({ code, products, prefill, onOpen }: { code: string; products: CatalogProduct[]; prefill?: Prefill; onOpen(p: CatalogProduct): void }) {
  const [ask, setAsk] = useState(false);
  return (
    <section className="ax-section sx" id="setor">
      <div className="sx-actions">
        <button className="sx-action" onClick={() => setAsk(true)}>
          <span className="ic"><IconWrench size={22} /></span>
          <span><strong>Pedir serviço</strong><small>Assistência, reparação ou instalação</small></span>
        </button>
        <button className="sx-action" onClick={() => setAsk(true)}>
          <span className="ic"><IconReceipt size={22} /></span>
          <span><strong>Pedir orçamento</strong><small>Sem compromisso</small></span>
        </button>
      </div>
      {products.length > 0 ? (
        <>
          <div className="ax-section-head"><h2 className="ax-section-title">Os nossos serviços</h2></div>
          <div className="sx-menu">
            {products.slice(0, 12).map((p) => (
              <div key={p.code} className="sx-dish">
                <button className="sx-dish-main" onClick={() => onOpen(p)}>
                  <div className="sx-dish-tx">
                    <strong>{p.name}</strong>
                    {p.description ? <span className="sx-desc">{p.description}</span> : null}
                    <span className="sx-price">desde {formatKz(p.grossPrice)}</span>
                  </div>
                </button>
                <button className="sx-add txt" onClick={() => setAsk(true)}>Pedir</button>
              </div>
            ))}
          </div>
        </>
      ) : null}
      {ask ? <ServiceRequestModal code={code} prefill={prefill} onClose={() => setAsk(false)} /> : null}
    </section>
  );
}

function PharmacyBoard({ products, onCategory }: { products: CatalogProduct[]; onCategory(c: string): void }) {
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) if (p.category) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  }, [products]);
  if (cats.length === 0) return null;
  return (
    <section className="ax-section sx" id="setor">
      <div className="ax-section-head"><h2 className="ax-section-title">Categorias</h2></div>
      <div className="sx-actions grid">
        {cats.map(([c, n]) => (
          <button key={c} className="sx-action" onClick={() => onCategory(c)}>
            <span className="ic"><IconPill size={22} /></span>
            <span><strong>{c}</strong><small>{n} produto(s)</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}
