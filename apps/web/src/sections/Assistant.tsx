import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AgentEvent, AssistantCallSession } from '../api/types';
import { IconCpu } from '../components/Icons';
import { micSupported, playBase64Audio, startRecording, stopAudio, type Recorder } from '../components/voice';

/**
 * AGENTE IA do gestor — design estilo claude.ai, responsivo:
 *   • coluna central de conversa limpa (utilizador à direita, agente em texto);
 *   • PAINEL DE ATIVIDADE em tempo real (cada ferramenta que o agente executa
 *     aparece ao vivo, com estado e resultado) — lateral no desktop, gaveta
 *     no telemóvel;
 *   • anexos: planilhas XLSX, PDFs, imagens geradas, guias (lightbox) e
 *     botões WhatsApp prontos a enviar;
 *   • chamada de voz com a voz feminina natural (Gemini TTS).
 */

interface Attachment { file?: { kind: string; name: string; base64: string; mime: string }; imageBase64?: string; guideUrl?: string; waLink?: string }
interface Turn { role: 'user' | 'assistant'; content: string; attachments?: Attachment[]; error?: boolean }
interface Step { tool: string; args?: Record<string, unknown>; summary?: string; done: boolean }

const SUGGESTIONS = [
  'Como estão as vendas desta semana?',
  'Verifica se há indícios de roubo ou quebras este mês',
  'Quem é o funcionário com melhor desempenho?',
  'Cria uma planilha com o top 10 de produtos do mês',
  'Há erros de cálculo ou diferenças nos fechos de caixa?',
];

const TOOL_LABEL: Record<string, string> = {
  resumo_vendas: '📊 A analisar vendas', top_produtos: '🏆 Top produtos',
  desempenho_funcionarios: '👥 Desempenho dos funcionários', detetar_anomalias: '🕵️ Auditoria anti-fraude',
  stock_critico: '📦 Stock crítico', lucro_resumo: '💰 Lucro', gastos_resumo: '🧾 Gastos',
  listar_funcionarios: '👥 Funcionários', listar_clientes: '🤝 Clientes', mapa_iva: '🏛️ Mapa de IVA',
  atualizar_preco_produto: '✏️ A alterar preço', criar_cliente: '➕ A criar cliente',
  criar_despesa: '➕ A registar despesa', ajustar_stock_minimo: '✏️ Stock mínimo',
  criar_planilha: '📗 A criar planilha', criar_pdf: '📄 A criar PDF', criar_imagem: '🎨 A gerar imagem',
  mostrar_guia: '🖼️ Guia visual', enviar_whatsapp: '💬 WhatsApp',
};

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
const IconSend = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 14-7-4 14-3.5-5.5L5 12Z" /></svg>
);

function stripForSpeech(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '').replace(/\*\*/g, '').trim();
}
function voiceError(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Falha de voz. Tenta novamente.';
}

export function Assistant() {
  const [name, setName] = useState('Assistente');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [liveAtts, setLiveAtts] = useState<Attachment[]>([]); // previews ao vivo na tela secundária
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [callOpen, setCallOpen] = useState(false);
  const [actOpen, setActOpen] = useState(false); // gaveta de atividade (mobile)
  const recRef = useRef<Recorder | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      try { const g = await api.assistant.greeting(); setName(g.displayName); } catch { /* default */ }
    })();
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [turns, steps, busy]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || busy) return;
    const history = [
      ...turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })),
      { role: 'user' as const, content },
    ];
    setTurns((p) => [...p, { role: 'user', content }]);
    setInput('');
    setBusy(true);
    setSteps([]);
    setLiveAtts([]);
    const attachments: Attachment[] = [];
    let finalText = '';
    try {
      const stream = api.agentStream(history, (e: AgentEvent) => {
        if (e.type === 'step_start') setSteps((p) => [...p, { tool: e.tool ?? '?', args: e.args, done: false }]);
        else if (e.type === 'step_done') setSteps((p) => p.map((s, i) => (i === p.length - 1 && !s.done ? { ...s, done: true, summary: e.summary } : s)));
        else if (e.type === 'attachment') {
          const att = { file: e.file, imageBase64: e.imageBase64, guideUrl: e.guideUrl, waLink: e.waLink };
          attachments.push(att);
          setLiveAtts((p) => [...p, att]); // mostra o preview na tela secundária imediatamente
        }
        else if (e.type === 'text') finalText = e.text ?? '';
        else if (e.type === 'error') { finalText = e.text ?? 'Falha no agente.'; }
      });
      await stream.done;
      setTurns((p) => [...p, { role: 'assistant', content: finalText || '✓ Feito.', attachments }]);
    } catch (e) {
      setTurns((p) => [...p, {
        role: 'assistant', error: true,
        content: e instanceof ApiError && e.status === 400
          ? 'O agente precisa de um provedor de IA configurado (Super Admin → Inteligência Artificial).'
          : (e instanceof ApiError ? e.message : 'Não consegui responder agora. Tenta novamente.'),
      }]);
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
        const r = await api.assistant.stt(base64, mimeType);
        setBusy(false);
        if (r.text.trim()) await send(r.text.trim());
      } catch (e) {
        setBusy(false);
        setTurns((p) => [...p, { role: 'assistant', content: voiceError(e), error: true }]);
      }
    } else {
      stopAudio();
      try { recRef.current = await startRecording(); setRecording(true); }
      catch { setTurns((p) => [...p, { role: 'assistant', content: 'Permite o acesso ao microfone no navegador.', error: true }]); }
    }
  };

  const voiceOk = micSupported();
  const empty = turns.length === 0;

  return (
    <div className="agent">
      {/* coluna principal (estilo claude.ai) */}
      <div className="agent-main">
        <div ref={scroller} className="agent-scroll">
          <div className="agent-col">
            {empty ? (
              <div className="agent-hero">
                <div className="agent-hero-ic"><IconCpu size={30} /></div>
                <h2>Olá! Sou o {name}.</h2>
                <p>Analiso as vendas, deteto quebras e indícios de fraude, crio planilhas, PDFs e imagens, ensino com screenshots reais e contacto a equipa por WhatsApp — tudo com os dados reais da tua empresa.</p>
                <div className="agent-sugs">
                  {SUGGESTIONS.map((s) => <button key={s} className="agent-sug" onClick={() => void send(s)}>{s}</button>)}
                </div>
              </div>
            ) : null}
            {turns.map((t, i) => <AgentTurn key={i} turn={t} />)}
            {busy ? <LiveSteps steps={steps} /> : null}
          </div>
        </div>

        {/* compositor */}
        <div className="agent-composer-wrap">
          <div className="agent-composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }}
              placeholder={recording ? 'A ouvir… toca no quadrado para enviar' : `Pergunta ao ${name} ou pede uma ação…`}
              rows={1}
            />
            <div className="agent-composer-row">
              <span className="agent-hint">O agente usa dados reais · nunca elimina nada · ações ficam na auditoria</span>
              <span className="spacer" />
              {voiceOk ? (
                <button className={`agent-iconbtn${recording ? ' rec' : ''}`} onClick={() => void toggleMic()} disabled={busy} title={recording ? 'Enviar' : 'Falar'}>
                  {recording ? <IconStop size={16} /> : <IconMic size={17} />}
                </button>
              ) : null}
              {voiceOk ? (
                <button className="agent-iconbtn" onClick={() => setCallOpen(true)} title="Chamada de voz"><IconPhone size={16} /></button>
              ) : null}
              <button className="agent-sendbtn" onClick={() => void send(input)} disabled={busy || !input.trim()} title="Enviar"><IconSend /></button>
            </div>
          </div>
        </div>
      </div>

      {/* painel de ATIVIDADE (desktop fixo · mobile gaveta) */}
      <aside className={`agent-activity${actOpen ? ' open' : ''}`}>
        <div className="agent-activity-head">
          <span className="agent-activity-dot" /> Atividade do agente
          <span className="spacer" />
          <button className="agent-iconbtn only-mobile" onClick={() => setActOpen(false)} aria-label="Fechar">✕</button>
        </div>
        <div className="agent-activity-body">
          {steps.length === 0 ? <p className="muted" style={{ fontSize: 13 }}>Quando o agente executar ferramentas (analisar vendas, criar ficheiros, alterar dados…), vês aqui cada passo em tempo real.</p> : null}
          {steps.map((s, i) => (
            <div key={i} className={`agent-step${s.done ? ' done' : ''}`}>
              <span className="agent-step-ic">{s.done ? '✓' : <span className="agent-spin" />}</span>
              <div className="agent-step-tx">
                <strong>{TOOL_LABEL[s.tool] ?? s.tool}</strong>
                {s.args && Object.keys(s.args).length ? <span className="agent-step-args">{Object.entries(s.args).map(([k, v]) => `${k}: ${String(v)}`).join(' · ').slice(0, 90)}</span> : null}
                {s.summary ? <span className="agent-step-sum">{s.summary.slice(0, 220)}</span> : null}
              </div>
            </div>
          ))}
          {liveAtts.length ? <ActivityPreviews atts={liveAtts} /> : null}
        </div>
      </aside>
      <button className={`agent-activity-fab only-mobile${steps.length && busy ? ' busy' : ''}`} onClick={() => setActOpen(true)} title="Atividade do agente">
        ⚡{steps.length ? <span className="noti-badge">{steps.length}</span> : null}
      </button>

      {callOpen ? <CallOverlay onClose={() => setCallOpen(false)} /> : null}
    </div>
  );
}

/** Passos ao vivo também na conversa (enquanto o agente trabalha). */
function LiveSteps({ steps }: { steps: Step[] }) {
  const cur = steps[steps.length - 1];
  return (
    <div className="agent-live">
      <span className="agent-spin" />
      {cur ? <span>{TOOL_LABEL[cur.tool] ?? cur.tool}{cur.done ? ' ✓' : '…'}</span> : <span>a pensar…</span>}
    </div>
  );
}

/**
 * PRÉ-VISUALIZAÇÃO ao vivo na tela secundária (estilo "canvas" do Claude):
 * à medida que o agente gera artefactos (imagem, guia, planilha, PDF), mostra-os
 * aqui imediatamente — antes mesmo de terminar a resposta.
 */
function ActivityPreviews({ atts }: { atts: Attachment[] }) {
  const [zoom, setZoom] = useState<string | null>(null);
  return (
    <div className="agent-preview">
      <div className="agent-preview-h">Pré-visualização</div>
      {atts.map((a, i) => (
        <div key={i} className="agent-attach">
          {a.imageBase64 ? (
            <img className="agent-img" src={`data:image/png;base64,${a.imageBase64}`} alt="Imagem gerada" onClick={() => setZoom(`data:image/png;base64,${a.imageBase64}`)} />
          ) : null}
          {a.guideUrl ? (
            <img className="agent-img" src={a.guideUrl} alt="Guia do sistema" onClick={() => setZoom(a.guideUrl!)} />
          ) : null}
          {a.file ? (
            <a className="agent-file" download={a.file.name} href={`data:${a.file.mime};base64,${a.file.base64}`}>
              <span className="agent-file-ic">{a.file.kind === 'xlsx' ? '📗' : '📄'}</span>
              <span><strong>{a.file.name}</strong><em>Toca para descarregar</em></span>
            </a>
          ) : null}
          {a.waLink ? (
            <a className="agent-wa" href={a.waLink} target="_blank" rel="noreferrer">💬 Enviar no WhatsApp</a>
          ) : null}
        </div>
      ))}
      {zoom ? (
        <div className="sc-lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="ampliado" onClick={(e) => e.stopPropagation()} />
          <div className="sc-lightbox-hint">Toca fora da imagem para fechar</div>
        </div>
      ) : null}
    </div>
  );
}

function AgentTurn({ turn }: { turn: Turn }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (turn.role === 'user') {
    return <div className="agent-user"><div className="agent-user-b">{turn.content}</div></div>;
  }
  return (
    <div className={`agent-ai${turn.error ? ' err' : ''}`}>
      <div className="agent-ai-av"><IconCpu size={15} /></div>
      <div className="agent-ai-b">
        {renderRich(turn.content)}
        {turn.attachments?.map((a, i) => (
          <div key={i} className="agent-attach">
            {a.file ? (
              <a className="agent-file" download={a.file.name} href={`data:${a.file.mime};base64,${a.file.base64}`}>
                <span className="agent-file-ic">{a.file.kind === 'xlsx' ? '📗' : '📄'}</span>
                <span><strong>{a.file.name}</strong><em>Toca para descarregar</em></span>
              </a>
            ) : null}
            {a.imageBase64 ? (
              <img className="agent-img" src={`data:image/png;base64,${a.imageBase64}`} alt="Imagem gerada" onClick={() => setZoom(`data:image/png;base64,${a.imageBase64}`)} />
            ) : null}
            {a.guideUrl ? (
              <img className="agent-img" src={a.guideUrl} alt="Guia do sistema" onClick={() => setZoom(a.guideUrl!)} />
            ) : null}
            {a.waLink ? (
              <a className="agent-wa" href={a.waLink} target="_blank" rel="noreferrer">💬 Enviar no WhatsApp</a>
            ) : null}
          </div>
        ))}
      </div>
      {zoom ? (
        <div className="sc-lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="ampliado" onClick={(e) => e.stopPropagation()} />
          <div className="sc-lightbox-hint">Toca fora da imagem para fechar</div>
        </div>
      ) : null}
    </div>
  );
}

/** Chamada de voz half-duplex — voz feminina natural (Gemini "Leda"). */
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
        if (s.mode === 'unavailable') { setErr('A chamada por voz precisa de um provedor de IA configurado.'); setStatus('idle'); return; }
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
        setErr(e instanceof ApiError ? e.message : 'Não foi possível iniciar a chamada.');
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
