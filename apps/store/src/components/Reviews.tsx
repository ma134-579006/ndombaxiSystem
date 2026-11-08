import React, { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { ProductReviews } from '../api/types';
import { useCustomer } from '../store/customer';

/** Estrelas (0–5, com meia estrela pela largura do preenchimento). */
export function Stars({ value, size = 13 }: { value: number; size?: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="ax-stars" style={{ fontSize: size }} aria-label={`${value.toLocaleString('pt-PT')} de 5`}>
      <span className="bg">★★★★★</span>
      <span className="fg" style={{ width: `${pct}%` }}>★★★★★</span>
    </span>
  );
}

/** Avaliações de um produto: resumo, distribuição, lista e formulário
 *  (só para quem comprou o produto). */
export function ProductReviewsSection({ code, productCode }: { code: string; productCode: string }) {
  const session = useCustomer(code);
  const [data, setData] = useState<ProductReviews | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => api.reviews(code, productCode, session?.token).then((d) => {
    setData(d);
    if (d.mine) { setRating(d.mine.rating); setComment(d.mine.comment ?? ''); }
  }).catch(() => setData(null));
  useEffect(() => { setRating(0); setComment(''); setMsg(null); void load(); }, [code, productCode, session?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = async () => {
    if (!session || !rating) return;
    setBusy(true); setMsg(null);
    try {
      await api.submitReview(code, productCode, { rating, comment: comment.trim() || undefined }, session.token);
      setMsg({ ok: true, text: 'Avaliação guardada.' });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Não foi possível guardar.' });
    } finally { setBusy(false); }
  };

  if (!data || (data.count === 0 && !data.canReview)) return null;
  const max = Math.max(1, ...data.distribution);
  return (
    <div className="ax-section ax-reviews">
      <h2 className="ax-section-title">Avaliações ({data.count})</h2>
      {data.count > 0 ? (
        <div className="ax-rv-sum">
          <div className="avg">
            <b>{data.average.toLocaleString('pt-PT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</b>
            <Stars value={data.average} size={18} />
          </div>
          <div className="dist">
            {[5, 4, 3, 2, 1].map((s) => (
              <div className="bar" key={s}>
                <span>{s}★</span>
                <i><em style={{ width: `${(data.distribution[s - 1] / max) * 100}%` }} /></i>
                <span className="n">{data.distribution[s - 1]}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {data.canReview ? (
        <div className="ax-rv-form">
          <div className="pick" role="radiogroup" aria-label="Estrelas">
            {[1, 2, 3, 4, 5].map((s) => (
              <button key={s} type="button" role="radio" aria-checked={rating === s} aria-label={`${s} estrela${s > 1 ? 's' : ''}`}
                className={s <= rating ? 'on' : ''} onClick={() => setRating(s)}>★</button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 1000))} rows={3} placeholder="Comentário (opcional)" aria-label="Comentário" />
          {msg ? <div className={`banner ${msg.ok ? 'info' : 'danger'}`}>{msg.text}</div> : null}
          <button className="btn" disabled={busy || !rating} onClick={() => void send()}>{data.mine ? 'Atualizar avaliação' : 'Enviar avaliação'}</button>
        </div>
      ) : null}

      {data.items.map((r) => (
        <div className="ax-rv" key={r.id}>
          <div className="hd"><span className="ava">{r.name.slice(0, 1).toUpperCase()}</span><b>{r.name}</b><Stars value={r.rating} /><span className="dt">{new Date(r.date).toLocaleDateString('pt-PT')}</span></div>
          {r.comment ? <p>{r.comment}</p> : null}
        </div>
      ))}
    </div>
  );
}
