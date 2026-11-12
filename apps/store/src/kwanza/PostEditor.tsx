import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError } from '../api/client';
import { readFileProgress } from '../transfer';
import { I, P, kz } from '../members/parts';
import { kw, type Affiliation } from './api';

/**
 * O associado publica o produto no marketplace: o seu preço (nunca abaixo do preço da
 * empresa; acima só até ao limite que a empresa definir), imagens publicitárias (várias),
 * vídeo e texto. O cliente normal só vê produtos publicados por associados.
 */
export function PostEditor({ token, a, onClose, onSaved }: { token: string; a: Affiliation; onClose(): void; onSaved(msg: string): void }) {
  const maxPrice = a.allowMarkup ? Math.round(a.grossPrice * (1 + (a.maxMarkupPct ?? 100) / 100) * 100) / 100 : a.grossPrice;
  const [price, setPrice] = useState(String(a.price ?? a.grossPrice));
  const [images, setImages] = useState<string[]>(a.postImages ?? []);
  const [video, setVideo] = useState(a.postVideo ?? '');
  const [caption, setCaption] = useState(a.postCaption ?? '');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = Number(price.replace(',', '.')) || 0;
  const commission = Math.round(a.grossPrice * a.commissionPct) / 100;
  const extra = Math.max(0, p - a.grossPrice);
  const low = p > 0 && p < a.grossPrice;
  const high = p > maxPrice;

  const add = async (files: FileList | null) => {
    if (!files) return;
    setErr(null);
    const next = [...images];
    for (const f of Array.from(files)) {
      if (next.length >= 6) { setErr('Máximo de 6 imagens.'); break; }
      if (!f.type.startsWith('image/')) continue;
      if (f.size > 900_000) { setErr(`“${f.name}” tem mais de 900 KB.`); continue; }
      next.push(await readFileProgress(f));
    }
    setImages(next);
  };
  const move = (i: number, d: -1 | 1) => setImages((x) => { const n = [...x]; const j = i + d; if (j < 0 || j >= n.length) return x; [n[i], n[j]] = [n[j], n[i]]; return n; });

  const save = async (published: boolean) => {
    setErr(null);
    if (low) { setErr(`O preço não pode ser abaixo de ${kz(a.grossPrice)}.`); return; }
    if (high) { setErr(`O preço máximo é ${kz(maxPrice)}.`); return; }
    if (published && !images.length && !a.imageUrl) { setErr('Junte pelo menos uma imagem.'); return; }
    setBusy(true);
    try {
      await kw.savePost(token, { companyCode: a.companyCode, productCode: a.productCode, price: p || a.grossPrice, images, videoUrl: video.trim() || null, caption: caption.trim() || null, published });
      onSaved(published ? 'Produto publicado no LPS Kwanza' : 'Publicação guardada (não publicada)');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Não foi possível guardar.'); } finally { setBusy(false); }
  };

  // Portal na raiz do LPS Kwanza (mantém as cores): a página pai tem animações com transform (prenderiam o position:fixed).
  return createPortal(
    <>
      <div className="kw-scrim" onClick={onClose} />
      <div className="kw-post kw-pop" role="dialog" aria-modal="true" aria-label={`Publicar ${a.name}`}>
        <header className="kw-post-h">
          <span className="kw-row-pic">{a.imageUrl ? <img src={a.imageUrl} alt="" /> : null}</span>
          <div className="kw-row-main"><b>{a.name}</b><small>{a.companyName}</small></div>
          {a.published ? <span className="kw-pill kw-st-PAID">Publicado</span> : null}
          <button className="kw-x" onClick={onClose} aria-label="Fechar"><I d={P.close} size={18} /></button>
        </header>
        <div className="kw-post-body">
          <section className="kw-post-sec">
            <h4>Preço de venda</h4>
            <div className="kw-post-price">
              <label className="kw-f"><span>O seu preço (Kz)</span>
                <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.,]/g, ''))} disabled={!a.allowMarkup} aria-invalid={low || high} />
              </label>
              <div className="kw-post-lim"><span>Preço da empresa</span><b>{kz(a.grossPrice)}</b><span>Máximo</span><b>{kz(maxPrice)}</b></div>
            </div>
            {low ? <div className="kw-err">Nunca abaixo do preço da empresa ({kz(a.grossPrice)}).</div> : high ? <div className="kw-err">Acima do máximo permitido ({kz(maxPrice)}).</div> : null}
            <div className="kw-post-earn">
              <div><span>Comissão ({a.commissionPct}%)</span><b>{kz(commission)}</b></div>
              <div><span>Diferença do seu preço</span><b>{kz(extra)}</b></div>
              <div className="tot"><span>Ganha por venda</span><b>{kz(commission + extra)}</b></div>
            </div>
          </section>

          <section className="kw-post-sec">
            <h4>Imagens publicitárias <small>{images.length}/6</small></h4>
            <div className="kw-post-imgs">
              {images.map((src, i) => (
                <figure key={i} className="kw-post-img">
                  <img src={src} alt={`Imagem ${i + 1}`} />
                  {i === 0 ? <em>Capa</em> : null}
                  <div className="kw-post-img-acts">
                    <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover para a esquerda"><I d={P.back} size={14} /></button>
                    <button type="button" onClick={() => move(i, 1)} disabled={i === images.length - 1} aria-label="Mover para a direita"><I d={P.next} size={14} /></button>
                    <button type="button" className="danger" onClick={() => setImages((x) => x.filter((_, j) => j !== i))} aria-label="Remover imagem"><I d={P.trash} size={14} /></button>
                  </div>
                </figure>
              ))}
              {images.length < 6 ? (
                <label className="kw-post-add">
                  <I d={P.box} size={22} /><span>Adicionar</span>
                  <input type="file" accept="image/*" multiple hidden onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
                </label>
              ) : null}
            </div>
          </section>

          <section className="kw-post-sec">
            <h4>Vídeo</h4>
            <label className="kw-f"><span>Ligação do vídeo (YouTube, TikTok, Instagram, Google Drive…)</span><input type="url" value={video} onChange={(e) => setVideo(e.target.value)} placeholder="https://" /></label>
          </section>

          <section className="kw-post-sec">
            <h4>Texto da publicação</h4>
            <label className="kw-f"><textarea rows={3} maxLength={600} value={caption} onChange={(e) => setCaption(e.target.value)} aria-label="Texto da publicação" /></label>
          </section>
          {err ? <div className="kw-err" role="alert">{err}</div> : null}
        </div>
        <footer className="kw-post-f">
          {a.published ? <button className="kw-btn" disabled={busy} onClick={() => void save(false)}>Retirar publicação</button> : <button className="kw-btn" disabled={busy} onClick={() => void save(false)}>Guardar rascunho</button>}
          <button className="kw-btn kw-btn-primary" disabled={busy || low || high} onClick={() => void save(true)}>{busy ? 'A guardar…' : a.published ? 'Atualizar publicação' : 'Publicar'}</button>
        </footer>
      </div>
    </>,
    document.querySelector('.kw-root') ?? document.body,
  );
}
