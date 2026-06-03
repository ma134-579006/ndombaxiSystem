import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AssistantCallSession, AssistantChartSpec, AssistantMessage } from '../api/types';
import { IconCpu } from '../components/Icons';
import { micSupported, playBase64Audio, startRecording, stopAudio, type Recorder } from '../components/voice';

interface Turn { role: 'user' | 'assistant'; content: string; charts?: AssistantChartSpec[]; error?: boolean }

const SUGGESTIONS = [
  'Qual foi o produto mais vendido esta semana?',
  'Mostra o fluxo de caixa deste mês.',
  'Quantos clientes compraram mais de 3 vezes?',
  'Que produtos estão quase em rutura?',
];

const IconMic = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><line x1="12" y1="18" x2="12" y2="22" />
  </svg>
);
const IconPhone = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.6a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.5-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.6 2.6.7a2 2 0 0 1 1.7 2Z" />
  </svg>
);
const IconStop = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);
const IconSpeaker = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a9 9 0 0 1 0 14" />
  </svg>
);

/** Limpa o texto para leitura por voz (sem blocos de gráfico/imagem nem **). */
function stripForSpeech(text: string): string {
  return text.replace(/```(chart|image)\s*\n[\s\S]*?```/g, '').replace(/\*\*/g, '').trim();
}
function voiceError(e: unknown): string {
  return e instanceof ApiError && e.status === 400
    ? 'A voz precisa de um provedor (TTS/STT) configurado pelo Super Admin em **Inteligência Artificial**.'
    : (e instanceof ApiError ? e.message : 'Falha de voz. Tenta novamente.');
}

export function Assistant() {
  const [name, setName] = useState('Assistente');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const recRef = useRef<Recorder | null>(null);
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

  const toggleMic = async () => {
    if (busy) return;
    if (recording) {
      const rec = recRef.current; recRef.current = null; setRecording(false);
      if (!rec) return;
      setBusy(true);
      try {
        const { base64, mimeType } = await rec.stop();
        const r = await api.assistant.voiceTurn(base64, mimeType);
        setTurns((p) => [...p, { role: 'user', content: r.userText }, { role: 'assistant', content: r.reply }]);
        if (r.audioBase64) playBase64Audio(r.audioBase64, r.mimeType);
      } catch (e) {
        setTurns((p) => [...p, { role: 'assistant', content: voiceError(e), error: true }]);
      } finally { setBusy(false); }
    } else {
      stopAudio();
      try { recRef.current = await startRecording(); setRecording(true); }
      catch { setTurns((p) => [...p, { role: 'assistant', content: 'Não consegui aceder ao microfone. Permite o acesso no navegador.', error: true }]); }
    }
  };

  const speak = async (text: string) => {
    try { const a = await api.assistant.tts(stripForSpeech(text)); playBase64Audio(a.audioBase64, a.mimeType); }
    catch { /* sem TTS configurado — silencioso */ }
  };

  const voiceOk = micSupported();

  return (
    <>
      <div className="content-head">
        <h2>Assistente IA <span className="muted" style={{ fontWeight: 500, fontSize: 14 }}>· {name}</span></h2>
        <span className="spacer" />
        {voiceOk ? (
          <button className="btn" onClick={() => setCallOpen(true)} title="Falar por chamada de voz">
            <IconPhone size={16} /> Chamada
          </button>
        ) : null}
      </div>

      <div className="card" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 190px)', minHeight: 420, padding: 0, overflow: 'hidden' }}>
        <div ref={scroller} style={{ flex: 1, overflowY: 'auto', padding: 18, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {turns.map((t, i) => <Bubble key={i} turn={t} onSpeak={voiceOk ? () => speak(t.content) : undefined} />)}
          {busy ? (
            <div style={{ alignSelf: 'flex-start', color: 'var(--muted)', fontSize: 13, padding: '6px 2px' }}>
              <span className="live-dot" /> a pensar…
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
          {voiceOk ? (
            <button
              onClick={toggleMic}
              disabled={busy}
              title={recording ? 'Parar e enviar' : 'Falar'}
              style={{
                height: 44, width: 44, flex: 'none', borderRadius: 12, display: 'grid', placeItems: 'center',
                background: recording ? 'var(--danger)' : 'var(--surface)', color: recording ? '#fff' : 'var(--text)',
                border: `1px solid ${recording ? 'var(--danger)' : 'var(--border)'}`,
                animation: recording ? 'live-pulse 1.4s infinite' : undefined,
              }}
            >
              {recording ? <IconStop size={18} /> : <IconMic size={20} />}
            </button>
          ) : null}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
            placeholder={recording ? 'A ouvir… toca no quadrado para enviar' : 'Escreve ou toca no microfone…'}
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

      {callOpen ? <CallOverlay onClose={() => setCallOpen(false)} /> : null}
    </>
  );
}

function Bubble({ turn, onSpeak }: { turn: Turn; onSpeak?: () => void }) {
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
          {!isUser && !turn.error && onSpeak ? (
            <button onClick={onSpeak} title="Ouvir" style={{ marginTop: 6, color: 'var(--muted)', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
              <IconSpeaker size={14} /> Ouvir
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Chamada de voz: toca para falar, o assistente responde por voz (half-duplex). */
function CallOverlay({ onClose }: { onClose(): void }) {
  const [session, setSession] = useState<AssistantCallSession | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'idle' | 'listening' | 'thinking' | 'speaking'>('connecting');
  const [transcript, setTranscript] = useState<{ who: 'you' | 'ai'; text: string }[]>([]);
  const recRef = useRef<Recorder | null>(null);
  const tr = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await api.assistant.callSession();
        setSession(s);
        if (s.mode === 'unavailable') { setErr('A chamada por voz precisa de um provedor de voz (TTS/STT) configurado pelo Super Admin.'); setStatus('idle'); return; }
        if (s.greeting) {
          setTranscript([{ who: 'ai', text: s.greeting }]);
          try {
            const a = await api.assistant.tts(s.greeting);
            setStatus('speaking');
            const audio = playBase64Audio(a.audioBase64, a.mimeType);
            audio.onended = () => setStatus('idle');
          } catch { setStatus('idle'); }
        } else setStatus('idle');
      } catch (e) {
        setErr(e instanceof ApiError && e.status === 400
          ? 'A chamada por voz precisa de um provedor de voz configurado pelo Super Admin.'
          : 'Não foi possível iniciar a chamada.');
        setStatus('idle');
      }
    })();
    return () => { stopAudio(); recRef.current?.cancel(); };
  }, []);

  useEffect(() => { tr.current?.scrollTo({ top: tr.current.scrollHeight }); }, [transcript, status]);

  const talk = async () => {
    if (status === 'connecting' || status === 'thinking') return;
    if (status === 'listening') {
      const rec = recRef.current; recRef.current = null; setStatus('thinking');
      if (!rec) { setStatus('idle'); return; }
      try {
        const { base64, mimeType } = await rec.stop();
        const r = await api.assistant.voiceTurn(base64, mimeType);
        setTranscript((p) => [...p, { who: 'you', text: r.userText }, { who: 'ai', text: r.reply }]);
        if (r.audioBase64) {
          setStatus('speaking');
          const audio = playBase64Audio(r.audioBase64, r.mimeType);
          audio.onended = () => setStatus('idle');
        } else setStatus('idle');
      } catch (e) { setErr(voiceError(e)); setStatus('idle'); }
    } else {
      stopAudio(); setErr(null);
      try { recRef.current = await startRecording(); setStatus('listening'); }
      catch { setErr('Permite o acesso ao microfone no navegador.'); }
    }
  };

  const label = status === 'connecting' ? 'A ligar…'
    : status === 'listening' ? 'A ouvir… toca para enviar'
    : status === 'thinking' ? 'A pensar…'
    : status === 'speaking' ? 'A falar…'
    : 'Toca para falar';

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420, textAlign: 'center' }}>
        <div className="mb" style={{ padding: 24 }}>
          <div style={{ width: 84, height: 84, borderRadius: 999, margin: '0 auto 12px', display: 'grid', placeItems: 'center', background: 'var(--primary-soft)', color: 'var(--primary)', animation: status === 'speaking' || status === 'listening' ? 'live-pulse 1.6s infinite' : undefined }}>
            <IconCpu size={40} />
          </div>
          <h3 style={{ margin: '0 0 2px' }}>{session?.displayName ?? 'Assistente'}</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 16 }}>{label}</div>

          {err ? <div className="banner danger" style={{ marginBottom: 14, textAlign: 'left' }}>{err}</div> : null}

          <div ref={tr} style={{ maxHeight: 200, overflowY: 'auto', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 16px' }}>
            {transcript.map((t, i) => (
              <div key={i} style={{ alignSelf: t.who === 'you' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: t.who === 'you' ? 'var(--primary)' : 'var(--surface-2)', color: t.who === 'you' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: 14 }}>
                {t.text}
              </div>
            ))}
          </div>

          <button
            onClick={talk}
            disabled={status === 'connecting' || status === 'thinking' || !!err}
            style={{
              width: 76, height: 76, borderRadius: 999, display: 'grid', placeItems: 'center', margin: '0 auto',
              background: status === 'listening' ? 'var(--danger)' : 'var(--grad-primary, var(--primary))', color: '#fff',
              border: 'none', boxShadow: '0 10px 26px -10px var(--primary)',
              animation: status === 'listening' ? 'live-pulse 1.2s infinite' : undefined,
            }}
            title={status === 'listening' ? 'Enviar' : 'Falar'}
          >
            {status === 'listening' ? <IconStop size={26} /> : <IconMic size={28} />}
          </button>

          <div style={{ marginTop: 18 }}>
            <button className="btn ghost" onClick={onClose}>Terminar chamada</button>
          </div>
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
