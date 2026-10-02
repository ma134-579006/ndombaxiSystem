import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SiteFeedback } from '../api/types';
import { UiIcon } from './UiIcon';

const LS_VOTES = 'ndombaxi.feedback.votes';
function votedSet(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(LS_VOTES) || '[]') as string[]); } catch { return new Set(); }
}
function rememberVote(id: string): void {
  try { const s = votedSet(); s.add(id); localStorage.setItem(LS_VOTES, JSON.stringify([...s])); } catch { /* ignora */ }
}

/** Comentários públicos: os visitantes dizem o que gostariam de ver no
 *  sistema e votam 👍/👎 nas sugestões uns dos outros (1 voto por sugestão). */
export function FeedbackSection() {
  const [items, setItems] = useState<SiteFeedback[]>([]);
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [voted, setVoted] = useState<Set<string>>(votedSet());
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setOpen((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const hue = (n: string) => { let h = 0; for (const ch of n || 'A') h = (h * 31 + ch.charCodeAt(0)) % 360; return h; };

  useEffect(() => { api.support.feedbackList().then(setItems).catch(() => undefined); }, []);

  const submit = async () => {
    const text = body.trim();
    if (text.length < 3 || busy) return;
    setBusy(true);
    try {
      await api.support.feedbackAdd(name.trim(), text);
      setBody(''); setDone(true);
      setItems(await api.support.feedbackList());
      window.setTimeout(() => setDone(false), 3500);
    } catch { /* mantém o texto para tentar de novo */ }
    finally { setBusy(false); }
  };

  const vote = async (id: string, dir: 'up' | 'down') => {
    if (voted.has(id)) return;
    try {
      const r = await api.support.feedbackVote(id, dir);
      setItems((p) => p.map((f) => (f.id === id ? { ...f, likes: r.likes, dislikes: r.dislikes } : f)));
      rememberVote(id);
      setVoted(votedSet());
    } catch { /* ignora */ }
  };

  return (
    <section className="lp-section" id="comentarios">
      <div className="wrap">
        <h2>A tua opinião constrói o sistema</h2>
        <p className="lead">Diz-nos o que gostarias de ver no LPS Vendas — e vota nas sugestões da comunidade.</p>

        <div className="fb-form fb-card">
          <div className="fb-form-h"><b>Deixe a sua sugestão</b><span>Lemos todas — as mais votadas entram primeiro no plano.</span></div>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O seu nome (opcional)" maxLength={80} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="O que gostaria que acrescentássemos?" rows={3} maxLength={1200} />
          <div className="fb-form-f">
            <small>{body.length}/1200</small>
            <button className="lp-btn primary" onClick={() => void submit()} disabled={busy || body.trim().length < 3}>
              {busy ? 'A publicar…' : done ? '✓ Publicado!' : 'Publicar sugestão'}
            </button>
          </div>
        </div>

        {items.length > 0 ? (
          <>
            <div className="fb-count"><b>{items.length}</b> sugestões da comunidade</div>
            <div className="fb-list">
              {items.map((f) => (
                <div className="fb-item" key={f.id}>
                  <div className="fb-top">
                    <span className="fb-avatar" style={{ background: `linear-gradient(145deg, hsl(${hue(f.author_name || 'A')} 70% 52%), hsl(${(hue(f.author_name || 'A') + 40) % 360} 70% 42%))` }}>{(f.author_name || 'A').slice(0, 1).toUpperCase()}</span>
                    <div className="fb-who">
                      <span className="fb-name">{f.author_name || 'Anónimo'}</span>
                      <span className="fb-date">{new Date(f.created_at).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                    </div>
                  </div>
                  <p className={`fb-body${open.has(f.id) ? ' open' : ''}`}>{f.body}</p>
                  {f.body.length > 220 ? <button className="fb-more" onClick={() => toggle(f.id)}>{open.has(f.id) ? 'Ver menos' : 'Ler mais'}</button> : null}
                  <div className="fb-votes">
                    <button className={voted.has(f.id) ? 'off' : ''} onClick={() => void vote(f.id, 'up')} aria-label="Gosto"><UiIcon e="thumbUp" size={15} /> {f.likes}</button>
                    <button className={voted.has(f.id) ? 'off' : ''} onClick={() => void vote(f.id, 'down')} aria-label="Não gosto"><UiIcon e="thumbDown" size={15} /> {f.dislikes}</button>
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}
