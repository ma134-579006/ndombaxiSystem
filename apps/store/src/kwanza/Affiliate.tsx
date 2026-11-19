/**
 * LPS Kwanza — ferramentas do associado com a estrutura do Kikolo Online:
 * janela rápida do produto no mercado (afiliar, links de divulgação, preço de venda,
 * comissão, remover afiliação) e partilha nas redes.
 */
import React, { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { I, P, kz } from '../members/parts';
import { kw, shareLink, type Affiliation, type Listing } from './api';

const com = (l: { grossPrice: number; commissionPct: number }, pct?: number) => Math.round(l.grossPrice * (pct ?? l.commissionPct)) / 100;
const pics = (l: Listing) => [l.imageUrl, ...(l.gallery ?? [])].filter((x, i, a): x is string => !!x && a.indexOf(x) === i);

/* Ícones das redes (traço simples, como os restantes). */
const NET = {
  wa: 'M3 21l1.6-4.7A8.5 8.5 0 1 1 8 19.6L3 21zM8.5 9.5c.3 2.4 2.6 4.8 5 5.2l1.2-1.2 2 .9c-.2 1-1.1 1.8-2.2 1.8C10.6 16.2 7.8 13.4 7.8 9.5c0-1.1.8-2 1.8-2.2l.9 2-1.2 1.2',
  fb: 'M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z',
  ig: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM17.5 6.5h.01',
  tg: 'M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l9-6',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
};

async function copyText(t: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(t); return true; } catch { window.prompt('Copie:', t); return false; }
}

/** Partilhar a ligação do associado: copiar, WhatsApp, Facebook, Instagram, Telegram e o menu do telemóvel. */
export function ShareBar({ link, text, flash }: { link: string; text: string; flash(t: string): void }) {
  const msg = `${text}\n${link}`;
  const native = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const insta = async () => {
    // O Instagram não aceita ligações por endereço: usa-se o menu de partilha do telemóvel
    // ou copia-se a ligação para colar na história/bio/mensagem.
    if (native) { try { await navigator.share({ title: text, text, url: link }); return; } catch { /* cancelado */ } }
    await copyText(link); flash('Ligação copiada — cole no Instagram');
    window.open('https://www.instagram.com/', '_blank', 'noopener');
  };
  return (
    <div className="kk-share" role="group" aria-label="Partilhar">
      <button type="button" className="kk-sh kk-sh-link" onClick={async () => { await copyText(link); flash('Link copiado'); }}><I d={NET.link} size={17} /><span>Copiar link</span></button>
      <a className="kk-sh kk-sh-wa" href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer"><I d={NET.wa} size={17} /><span>WhatsApp</span></a>
      <a className="kk-sh kk-sh-fb" href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(link)}&quote=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><I d={NET.fb} size={17} /><span>Facebook</span></a>
      <button type="button" className="kk-sh kk-sh-ig" onClick={() => void insta()}><I d={NET.ig} size={17} /><span>Instagram</span></button>
      <a className="kk-sh kk-sh-tg" href={`https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer"><I d={NET.tg} size={17} /><span>Telegram</span></a>
      {native ? <button type="button" className="kk-sh kk-sh-more" onClick={() => void navigator.share({ title: text, text, url: link }).catch(() => undefined)}><I d={P.share} size={17} /><span>Mais</span></button> : null}
    </div>
  );
}

/**
 * Janela rápida do produto no Mercado de Associados (como no Kikolo): galeria, condição,
 * comissionamento, comissão, valor de venda e — conforme o estado — pedir afiliação,
 * links de divulgação, alterar o preço de venda, comissão atual e remover afiliação.
 */
export function AffModal({ l, token, aff, onClose, onChanged, flash, onOpenProduct, assocCode }: {
  l: Listing; token: string; aff: Affiliation | null; assocCode: string;
  onClose(): void; onChanged(): void; flash(t: string): void; onOpenProduct(): void;
}) {
  const imgs = pics(l);
  const [img, setImg] = useState(0);
  const [busy, setBusy] = useState(false);
  const [qty, setQty] = useState(1);
  const [gen, setGen] = useState<string | null>(null);
  const base = l.basePrice ?? l.grossPrice;
  const max = l.maxMarkupPct == null ? 100 : l.maxMarkupPct;
  const curPrice = aff?.price ?? base;
  const [price, setPrice] = useState(String(Math.round(curPrice)));
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setPrice(String(Math.round(aff?.price ?? base))); }, [aff?.price, base]);
  const maxPrice = Math.floor(base * (1 + max / 100) * 100) / 100;
  const pct = aff?.status === 'APPROVED' ? aff.commissionPct : l.commissionPct;
  const join = async () => {
    setBusy(true); setErr(null);
    try { const r = await kw.affiliate(token, l.companyCode, l.productCode); flash(r.status === 'APPROVED' ? 'Associado a este produto' : 'Pedido de afiliação enviado'); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    setErr(null);
    const v = Number(price.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(v) || v <= 0) { setErr('Indique o preço de venda.'); return; }
    if (v < base) { setErr(`O preço não pode ser abaixo de ${kz(base)}.`); return; }
    if (v > maxPrice + 0.001) { setErr(`O máximo permitido é ${kz(maxPrice)} (+${max}%).`); return; }
    setBusy(true);
    try { await kw.markup(token, l.companyCode, l.productCode, v > base ? Math.round((v / base - 1) * 10000) / 100 : null); flash('Preço de venda aplicado'); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  const remove = async () => {
    if (!window.confirm('Remover a afiliação a este produto? A tua ligação deixa de dar comissão.')) return;
    setBusy(true);
    try { await kw.unaffiliate(token, l.companyCode, l.productCode); flash('Afiliação removida'); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível.'); } finally { setBusy(false); }
  };
  const link = shareLink(l.companyCode, l.productCode, assocCode) + (qty > 1 ? `?q=${qty}` : '');
  return (
    <div className="kk-modal-bg" role="presentation" onClick={onClose}>
      <div className="kk-qv" role="dialog" aria-modal="true" aria-label={l.name} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="kk-x red" aria-label="Fechar" onClick={onClose}><I d={P.close} size={18} /></button>
        <div className="kk-qv-top">
          <div className="kk-qv-gal">
            <div className="kk-qv-main">{imgs.length ? <img src={imgs[img] ?? imgs[0]} alt={l.name} /> : <span className="kk-qv-ph">{l.name.slice(0, 1).toUpperCase()}</span>}</div>
            {imgs.length > 1 ? <div className="kk-qv-th">{imgs.map((u, i) => <button type="button" key={u} className={i === img ? 'on' : ''} onClick={() => setImg(i)} aria-label={`Imagem ${i + 1}`}><img src={u} alt="" /></button>)}</div> : null}
          </div>
          <div className="kk-qv-info">
            <span className="kk-qv-chip"><I d={P.truck} size={13} /> Entrega pela empresa</span>
            <h2>{l.name}</h2>
            <div className="kk-qv-kv"><span>Condição:</span><b>Novo</b></div>
            <div className="kk-qv-kv"><span>Comissionamento:</span><b>Último clique</b></div>
            <div className="kk-qv-kv"><span>Empresa:</span><b>{l.companyName}</b></div>
            {l.affiliation === 'RESTRICTED' && aff?.status !== 'APPROVED' ? <span className="kk-card-restr"><I d={P.close} size={13} /> Afiliação Restrita</span> : null}
            <small className="kk-qv-k">Comissão de até</small><b className="kk-qv-com">{kz(com({ grossPrice: base, commissionPct: pct }))}</b>
            <small className="kk-qv-k">Valor de venda</small><b className="kk-qv-val">{kz(base)}</b>
            {!aff || aff.status === 'REJECTED' ? <>
              {aff?.status === 'REJECTED' ? <span className="kw-pill kw-st-CANCELLED">Afiliação recusada</span> : <em className="kk-qv-go">Afilia-te agora!</em>}
              <button type="button" className="kk-btn-aff" disabled={busy} onClick={() => void join()}>{busy ? 'Um momento…' : l.affiliation === 'RESTRICTED' ? 'Solicitar afiliação' : 'Afiliar-me'}</button>
            </> : aff.status === 'PENDING' ? <span className="kw-pill kw-st-PENDING">Pedido de afiliação em análise</span> : null}
            {l.materials?.length ? <div className="kk-qv-vid">{l.materials.map((m, i) => <a key={m} href={m} target="_blank" rel="noopener noreferrer"><I d={P.doc} size={14} /> Vídeos e materiais {l.materials.length > 1 ? i + 1 : ''}</a>)}</div> : null}
            <button type="button" className="kk-ghost" onClick={onOpenProduct}>Ver página do produto</button>
            {err ? <div className="kw-err">{err}</div> : null}
          </div>
        </div>
        {aff?.status === 'APPROVED' ? (
          <div className="kk-qv-aff">
            <section className="kk-qv-box">
              <h3>Links de divulgação</h3>
              <div className="kk-qv-gen">
                <label className="kk-qv-qty"><span>Quantidade:</span>
                  <span className="kk-step"><button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Menos">−</button><b>{qty}</b><button type="button" onClick={() => setQty((q) => Math.min(99, q + 1))} aria-label="Mais">+</button></span>
                </label>
                <button type="button" className="kk-btn-aff sm" onClick={() => setGen(link)}>Gerar link</button>
              </div>
              {gen ? <>
                <div className="kw-aff-link"><input readOnly value={gen} onFocus={(e) => e.currentTarget.select()} aria-label="Link de divulgação" /></div>
                <ShareBar link={gen} text={`${l.name} — ${kz(curPrice)}`} flash={flash} />
              </> : null}
            </section>
            <section className="kk-qv-box">
              <h3>Preço de venda</h3>
              <div className="kk-qv-prices">
                <div><small>Preço original do produto</small><b>{kz(base)}</b></div>
                <div><small>Preço atual em vigor</small><b>{kz(curPrice)}</b></div>
                <div><small>Máximo permitido</small><b>{l.allowMarkup ? `${kz(maxPrice)} (+${max}%)` : kz(base)}</b></div>
              </div>
              {l.allowMarkup ? (
                <div className="kk-qv-price">
                  <label className="kw-f"><span>Alterar preço de venda</span><input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} aria-label="Preço de venda" /></label>
                  <button type="button" className="kk-btn-aff sm" disabled={busy} onClick={() => void apply()}>Aplicar</button>
                </div>
              ) : <p className="kk-qv-closed">Esta afiliação está fechada e não permite alterar o preço.</p>}
            </section>
            <section className="kk-qv-box kk-qv-row">
              <div><small>Comissão atual</small><b className="kk-qv-com">{pct}% · {kz(com({ grossPrice: base, commissionPct: pct }))}</b>{aff.negotiated ? <small> negociada</small> : null}</div>
              <button type="button" className="kk-btn-rm" disabled={busy} onClick={() => void remove()}>Remover afiliação</button>
            </section>
          </div>
        ) : null}
        <section className="kk-qv-desc">
          <h3>O que precisas de saber sobre este produto</h3>
          {l.category ? <p><b>Categoria:</b> {l.category}</p> : null}
          {l.description ? <p>{l.description}</p> : <p>—</p>}
        </section>
      </div>
    </div>
  );
}
