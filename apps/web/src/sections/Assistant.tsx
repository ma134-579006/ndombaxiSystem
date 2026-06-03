import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AssistantChartSpec, AssistantMessage } from '../api/types';
import { IconCpu } from '../components/Icons';

interface Turn { role: 'user' | 'assistant'; content: string; charts?: AssistantChartSpec[]; error?: boolean }

const SUGGESTIONS = [
  'Qual foi o produto mais vendido esta semana?',
  'Mostra o fluxo de caixa deste mês.',
  'Quantos clientes compraram mais de 3 vezes?',
  'Que produtos estão quase em rutura?',
];

/** Assistente OpenManus da empresa: conversa em português, responde com texto
 *  rico e gráficos. Voz/chamada já existem na API e podem ser activadas quando
 *  o Super Admin configurar um provedor de voz. */
export function Assistant() {
  const [name, setName] = useState('Assistente');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const g = await api.assistant.greeting();
        setName(g.displayName);
        setTurns([{ role: 'assistant', content: g.greeting }]);
      } catch {
        setTurns([{ role: 'assistant', content: 'Olá! 👋 Sou o seu assistente. Em que posso ajudar?' }]);
      }
    })();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history: AssistantMessage[] = [
      ...turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })),
      { role: 'user', content },
    ];
    setTurns((p) => [...p, { role: 'user', content }]);
    setInput('');
    setBusy(true);
    try {
      const r = await api.assistant.chat(history);
      setTurns((p) => [...p, { role: 'assistant', content: r.reply, charts: r.charts }]);
    } catch (e) {
      const msg = e instanceof ApiError && e.status === 400
        ? 'O assistente ainda não tem um provedor de IA configurado. O Super Admin pode activá-lo em **Inteligência Artificial** no painel da plataforma.'
        : (e instanceof ApiError ? e.message : 'Não consegui responder agora. Tenta novamente.');
      setTurns((p) => [...p, { role: 'assistant', content: msg, error: true }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="content-head">
        <h2>Assistente IA <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {name}</span></h2>
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 190px)', minHeight: 420, padding: 0, overflow: 'hidden' }}>
        <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {turns.map((t, i) => <Bubble key={i} turn={t} />)}
          {busy ? (
            <div style={{ alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13, padding: '6px 2px' }}>
              <span className="live-dot" /> a escrever…
            </div>
          ) : null}
          {turns.length <= 1 && !busy ? (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => void send(s)}>{s}</button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ borderTop: '1px solid var(--border)', padding: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder="Escreve a tua pergunta…  (Enter envia, Shift+Enter nova linha)"
            rows={1}
            style={{
              flex: 1, resize: 'none', maxHeight: 120, background: 'var(--surface)',
              border: '1px solid var(--border)', borderRadius: 12, padding: '12px 14px',
              color: 'var(--text)', fontFamily: 'inherit', fontSize: 14,
            }}
          />
          <button className="btn" onClick={() => void send(input)} disabled={busy || !input.trim()} style={{ height: 44 }}>
            Enviar
          </button>
        </div>
      </div>
    </>
  );
}

function Bubble({ turn }: { turn: Turn }) {
  const isUser = turn.role === 'user';
  return (
    <div style={{ alignSelf: isUser ? 'flex-end' : 'flex-start', maxWidth: '82%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: isUser ? 'row-reverse' : 'row' }}>
        {!isUser ? (
          <div style={{ width: 30, height: 30, borderRadius: 9, background: 'var(--primary-soft)', color: 'var(--primary)', display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <IconCpu size={17} />
          </div>
        ) : null}
        <div style={{
          background: isUser ? 'var(--primary)' : turn.error ? 'var(--danger-soft, #2a1418)' : 'var(--surface)',
          color: isUser ? '#fff' : 'var(--text)',
          border: isUser ? 'none' : '1px solid var(--border)',
          borderRadius: 14, padding: '10px 14px', fontSize: 14, lineHeight: 1.5,
        }}>
          {renderRich(turn.content)}
          {turn.charts?.map((c, i) => <MiniChart key={i} spec={c} />)}
        </div>
      </div>
    </div>
  );
}

function renderRich(text: string): React.ReactNode {
  const clean = text.replace(/```(chart|image)\s*\n[\s\S]*?```/g, '').trim();
  return clean.split('\n').map((line, i) => (
    <div key={i} style={{ minHeight: line ? undefined : 7 }}>{renderInline(line)}</div>
  ));
}

function renderInline(line: string): React.ReactNode {
  return line.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**')
      ? <strong key={i}>{p.slice(2, -2)}</strong>
      : <React.Fragment key={i}>{p}</React.Fragment>,
  );
}

function MiniChart({ spec }: { spec: AssistantChartSpec }) {
  const s = spec.series?.[0];
  if (!s || !spec.labels?.length) return null;
  const max = Math.max(1, ...s.data);
  return (
    <div style={{ marginTop: 10, background: 'var(--bg-2, #0e1626)', borderRadius: 10, padding: 12 }}>
      {spec.title ? <div style={{ fontWeight: 700, marginBottom: 8, fontSize: 13 }}>{spec.title}</div> : null}
      <div className="catbars">
        {spec.labels.map((lab, i) => (
          <div className="catbar" key={i}>
            <span className="catbar-name">{String(lab)}</span>
            <div className="catbar-track"><div className="catbar-fill" style={{ width: `${(Number(s.data[i] ?? 0) / max) * 100}%` }} /></div>
            <span className="catbar-val">{s.data[i]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
