import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { SiteFeedback } from '../api/types';

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
        <p className="lead">Diz-nos o que gostarias de ver no Ndombaxi System — e vota nas sugestões da comunidade.</p>

        <div className="fb-form">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="O teu nome (opcional)" maxLength={80} />
          <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="O que gostarias que acrescentássemos?" rows={3} maxLength={1200} />
          <button className="lp-btn primary" onClick={() => void submit()} disabled={busy || body.trim().length < 3}>
            {busy ? 'A publicar…' : done ? '✓ Publicado!' : 'Publicar sugestão'}
          </button>
        </div>

        {items.length > 0 ? (
          <div className="fb-list">
            {items.map((f) => (
              <div className="fb-item" key={f.id}>
                <div className="fb-top">
                  <span className="fb-avatar">{(f.author_name || 'A').slice(0, 1).toUpperCase()}</span>
                  <span className="fb-name">{f.author_name || 'Anónimo'}</span>
                  <span className="fb-date">{new Date(f.created_at).toLocaleDateString('pt-PT')}</span>
                </div>
                <p className="fb-body">{f.body}</p>
                <div className="fb-votes">
                  <button className={voted.has(f.id) ? 'off' : ''} onClick={() => void vote(f.id, 'up')} aria-label="Gosto">👍 {f.likes}</button>
                  <button className={voted.has(f.id) ? 'off' : ''} onClick={() => void vote(f.id, 'down')} aria-label="Não gosto">👎 {f.dislikes}</button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}
