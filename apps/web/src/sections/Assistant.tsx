import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api/client';
import type { AgentEvent } from '../api/types';
import { IconCpu } from '../components/Icons';
import { micSupported, playBase64Audio, startRecording, startVoiceCall, stopAudio, type Recorder, type VoiceCall } from '../components/voice';

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
interface Step { tool: string; args?: Record<string, unknown>; summary?: string; done: boolean; atts?: Attachment[] }

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
  criar_produto: '🛒 A criar produto',
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
      // MEMÓRIA: retoma a conversa anterior deste utilizador (guardada no servidor).
      try {
        const h = await api.assistant.history();
        if (h.length) setTurns(h.map((m) => ({ role: m.role, content: m.content })));
      } catch { /* sem histórico */ }
    })();
  }, []);

  const clearConversation = async () => {
    try { await api.assistant.clearHistory(); } catch { /* */ }
    setTurns([]); setSteps([]);
  };

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
    const attachments: Attachment[] = [];
    let finalText = '';
    try {
      const stream = api.agentStream(history, (e: AgentEvent) => {
        if (e.type === 'step_start') setSteps((p) => [...p, { tool: e.tool ?? '?', args: e.args, done: false, atts: [] }]);
        else if (e.type === 'step_done') setSteps((p) => p.map((s, i) => (i === p.length - 1 && !s.done ? { ...s, done: true, summary: e.summary } : s)));
        else if (e.type === 'attachment') {
          const att = { file: e.file, imageBase64: e.imageBase64, guideUrl: e.guideUrl, waLink: e.waLink };
          attachments.push(att);
          // anexa o artefacto ao passo atual (ou cria um passo "artefacto" se não houver)
          setSteps((p) => {
            if (!p.length) return [{ tool: 'artefacto', done: true, atts: [att] }];
            return p.map((s, i) => (i === p.length - 1 ? { ...s, atts: [...(s.atts ?? []), att] } : s));
          });
        }
        else if (e.type === 'text') finalText = e.text ?? '';
        else if (e.type === 'error') { finalText = e.text ?? 'Falha no agente.'; }
      });
      await stream.done;
      setTurns((p) => [...p, { role: 'assistant', content: finalText || '✓ Feito.', attachments }]);
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '';
      const transient = /\b(503|429|500|502|504)\b|unavailable|overloaded|sobrecarregad|temporar/i.test(msg);
      setTurns((p) => [...p, {
        role: 'assistant', error: true,
        content: e instanceof ApiError && e.status === 400
          ? 'O agente precisa de um provedor de IA configurado (Super Admin → Inteligência Artificial).'
          : transient
            ? '⏳ O serviço de IA está sobrecarregado neste momento. Espera uns segundos e tenta de novo. (Se acontecer muito, o Super Admin pode adicionar uma 2.ª chave de IA para alternância automática.)'
            : (msg || 'Não consegui responder agora. Tenta novamente.'),
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
            {!empty ? (
              <div className="row" style={{ justifyContent: 'flex-end', position: 'sticky', top: 0, zIndex: 2, paddingBottom: 4 }}>
                <button className="btn sm ghost" onClick={() => void clearConversation()} title="Apagar a memória e começar uma conversa nova">🗑 Nova conversa</button>
              </div>
            ) : null}
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

      {/* CANVAS ao vivo: tudo o que o agente faz, em tempo real (desktop fixo · mobile gaveta) */}
      <aside className={`agent-activity${actOpen ? ' open' : ''}`}>
        <div className="agent-activity-head">
          <span className={`agent-activity-dot${busy ? ' live' : ''}`} />
          {busy ? 'A trabalhar ao vivo' : 'Atividade do agente'}
          {steps.length ? <span className="agent-activity-count">{steps.filter((s) => s.done).length}/{steps.length}</span> : null}
          <span className="spacer" />
          <button className="agent-iconbtn only-mobile" onClick={() => setActOpen(false)} aria-label="Fechar">✕</button>
        </div>
        <div className="agent-activity-body">
          {steps.length === 0 ? (
            <div className="agent-canvas-empty">
              <div className="agent-canvas-empty-ic"><IconCpu size={26} /></div>
              <p className="muted" style={{ fontSize: 13, margin: 0 }}>Aqui vês <strong>em tempo real</strong> tudo o que o assistente faz: cada análise, ficheiro, imagem ou alteração — passo a passo, com o resultado à vista.</p>
            </div>
          ) : null}
          {steps.map((s, i) => <ActivityCard key={i} step={s} running={busy && i === steps.length - 1 && !s.done} />)}
        </div>
      </aside>
      {!actOpen ? (
        <button className={`agent-activity-fab only-mobile${steps.length && busy ? ' busy' : ''}`} onClick={() => setActOpen(true)} title="Atividade do agente">
          ⚡{steps.length ? <span className="noti-badge">{steps.length}</span> : null}
        </button>
      ) : null}

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
 * CARTÃO de AÇÃO ao vivo (estilo "canvas"): mostra graficamente cada passo do
 * agente — ícone, estado (a correr / concluído), dados de entrada, resumo do
 * resultado e miniaturas dos artefactos gerados (imagem/guia/planilha/PDF).
 */
function ActivityCard({ step, running }: { step: Step; running: boolean }) {
  const [zoom, setZoom] = useState<string | null>(null);
  const label = TOOL_LABEL[step.tool] ?? step.tool;
  const m = /^(\p{Emoji})\s*(.*)$/u.exec(label);
  const icon = m ? m[1] : '⚙️';
  const title = m ? m[2] : label;
  const atts = step.atts ?? [];
  return (
    <div className={`agent-card${step.done ? ' done' : ''}${running ? ' running' : ''}`}>
      <div className="agent-card-h">
        <span className="agent-card-ic">{icon}</span>
        <span className="agent-card-ttl">{title}</span>
        <span className="agent-card-st">{step.done ? '✓' : <span className="agent-spin" />}</span>
      </div>
      {running ? <div className="agent-card-bar"><span /></div> : null}
      {step.args && Object.keys(step.args).length ? (
        <div className="agent-card-args">
          {Object.entries(step.args).slice(0, 6).map(([k, v]) => (
            <span key={k} className="agent-chip"><em>{k}</em> {String(v).slice(0, 28)}</span>
          ))}
        </div>
      ) : null}
      {step.summary ? <div className="agent-card-sum">{step.summary.slice(0, 240)}</div> : null}
      {atts.length ? (
        <div className="agent-card-atts">
          {atts.map((a, i) => (
            <React.Fragment key={i}>
              {a.imageBase64 ? <img className="agent-thumb" src={`data:image/png;base64,${a.imageBase64}`} alt="Imagem gerada" onClick={() => setZoom(`data:image/png;base64,${a.imageBase64}`)} /> : null}
              {a.guideUrl ? <img className="agent-thumb" src={a.guideUrl} alt="Guia" onClick={() => setZoom(a.guideUrl!)} /> : null}
              {a.file ? (
                <a className="agent-file" download={a.file.name} href={`data:${a.file.mime};base64,${a.file.base64}`}>
                  <span className="agent-file-ic">{a.file.kind === 'xlsx' ? '📗' : '📄'}</span>
                  <span><strong>{a.file.name}</strong><em>Descarregar</em></span>
                </a>
              ) : null}
              {a.waLink ? <a className="agent-wa" href={a.waLink} target="_blank" rel="noreferrer">💬 Enviar no WhatsApp</a> : null}
            </React.Fragment>
          ))}
        </div>
      ) : null}
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
/**
 * Chamada de voz AO VIVO estilo ChatGPT: escuta contínua com deteção de fim de
 * fala (envia sozinho quando paras de falar), supressão de eco/ruído (filtra
 * vozes de fundo) e o assistente em pausa enquanto fala (não se ouve a si). Sem
 * botão de "enviar".
 */
function CallOverlay({ onClose }: { onClose(): void }) {
  const [displayName, setDisplayName] = useState('Assistente');
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<'connecting' | 'listening' | 'thinking' | 'speaking' | 'error'>('connecting');
  const [hearing, setHearing] = useState(false);
  const [level, setLevel] = useState(0);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<{ who: 'you' | 'ai'; text: string }[]>([]);
  const engineRef = useRef<VoiceCall | null>(null);
  const busyRef = useRef(false);
  const mutedRef = useRef(false);
  const tr = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let alive = true;
    const resume = () => { if (alive) engineRef.current?.setPaused(mutedRef.current); };

    const process = async (audio: { base64: string; mimeType: string }) => {
      if (!alive || busyRef.current) return;
      busyRef.current = true;
      engineRef.current?.setPaused(true);
      setHearing(false); setStatus('thinking');
      try {
        const r = await api.assistant.voiceTurn(audio.base64, audio.mimeType);
        if (!alive) return;
        setTranscript((p) => [...p, { who: 'you', text: r.userText }, { who: 'ai', text: r.reply }]);
        if (r.audioBase64) {
          setStatus('speaking');
          const a = playBase64Audio(r.audioBase64, r.mimeType);
          a.onended = () => { if (!alive) return; setStatus('listening'); busyRef.current = false; resume(); };
        } else { setStatus('listening'); busyRef.current = false; resume(); }
      } catch (e) {
        if (!alive) return;
        setErr(voiceError(e)); setStatus('listening'); busyRef.current = false; resume();
      }
    };

    void (async () => {
      try {
        const s = await api.assistant.callSession();
        if (!alive) return;
        setDisplayName(s.displayName ?? 'Assistente');
        if (s.mode === 'unavailable') {
          setErr('A chamada por voz precisa de um provedor de IA configurado (Super Admin → Inteligência Artificial).');
          setStatus('error'); return;
        }
        if (s.greeting) setTranscript([{ who: 'ai', text: s.greeting }]);
        try {
          engineRef.current = await startVoiceCall({
            onUtterance: (a) => void process(a),
            onState: (st) => { if (alive) setHearing(st === 'recording'); },
            onLevel: (l) => { if (alive) setLevel(l); },
            onError: () => { /* silencioso */ },
          });
        } catch {
          setErr('Permite o acesso ao microfone no navegador para a chamada.'); setStatus('error'); return;
        }
        // saudação falada (motor em pausa enquanto fala p/ não se ouvir)
        if (s.greeting) {
          busyRef.current = true; engineRef.current.setPaused(true); setStatus('speaking');
          try {
            const g = await api.assistant.tts(s.greeting);
            if (!alive) return;
            const a = playBase64Audio(g.audioBase64, g.mimeType);
            a.onended = () => { if (!alive) return; setStatus('listening'); busyRef.current = false; resume(); };
          } catch { setStatus('listening'); busyRef.current = false; resume(); }
        } else setStatus('listening');
      } catch (e) {
        if (!alive) return;
        setErr(e instanceof ApiError ? e.message : 'Não foi possível iniciar a chamada.'); setStatus('error');
      }
    })();
    return () => { alive = false; stopAudio(); engineRef.current?.stop(); engineRef.current = null; };
  }, []);

  useEffect(() => { tr.current?.scrollTo({ top: tr.current.scrollHeight }); }, [transcript, status]);

  const toggleMute = () => {
    const m = !muted; setMuted(m); mutedRef.current = m;
    engineRef.current?.setPaused(m || busyRef.current);
  };

  const label = status === 'connecting' ? 'A ligar…'
    : status === 'speaking' ? 'A falar…'
    : status === 'thinking' ? 'A pensar…'
    : status === 'error' ? 'Indisponível'
    : muted ? 'Microfone desligado'
    : hearing ? 'A ouvir…'
    : 'À escuta — pode falar';

  // cor do "orb" por estado
  const glow = status === 'speaking' ? 'var(--accent, var(--primary))'
    : status === 'thinking' ? 'var(--warning)'
    : status === 'error' ? 'var(--danger)'
    : 'var(--success)';
  const scale = 1 + (status === 'listening' && !muted ? Math.min(0.28, level * 0.28) : status === 'speaking' ? 0.12 : 0);

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440, textAlign: 'center' }}>
        <div className="mb" style={{ padding: '28px 24px' }}>
          <h3 style={{ margin: '0 0 2px' }}>{displayName}</h3>
          <div className="muted" style={{ fontSize: 13, marginBottom: 20 }}>{label}</div>

          {/* Orb ao vivo (reage ao nível de voz) */}
          <div style={{ position: 'relative', width: 168, height: 168, margin: '0 auto 22px', display: 'grid', placeItems: 'center' }}>
            <div style={{ position: 'absolute', inset: 0, borderRadius: 999, background: `radial-gradient(circle at 50% 40%, ${glow}, transparent 70%)`, opacity: .35,
              transform: `scale(${1 + (status === 'speaking' ? 0.25 : level * 0.5)})`, transition: 'transform .12s ease', filter: 'blur(6px)' }} />
            <div style={{
              width: 132, height: 132, borderRadius: 999, display: 'grid', placeItems: 'center', color: '#fff',
              background: 'var(--grad-primary, var(--primary))',
              boxShadow: `0 0 0 1px color-mix(in srgb, ${glow} 50%, transparent), 0 0 46px -6px ${glow}`,
              transform: `scale(${scale})`, transition: 'transform .1s ease',
              animation: status === 'thinking' ? 'live-pulse 1.2s infinite' : undefined,
            }}>
              <IconCpu size={46} />
            </div>
          </div>

          {err ? <div className="banner danger" style={{ marginBottom: 14, textAlign: 'left' }}>{err}</div> : null}

          <div ref={tr} style={{ maxHeight: 180, overflowY: 'auto', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 8, margin: '0 0 18px' }}>
            {transcript.map((t, i) => (
              <div key={i} style={{ alignSelf: t.who === 'you' ? 'flex-end' : 'flex-start', maxWidth: '85%', background: t.who === 'you' ? 'var(--primary)' : 'var(--surface-2)', color: t.who === 'you' ? '#fff' : 'var(--text)', padding: '8px 12px', borderRadius: 12, fontSize: 14 }}>
                {t.text}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', alignItems: 'center' }}>
            <button
              onClick={toggleMute}
              disabled={status === 'connecting' || status === 'error'}
              title={muted ? 'Ligar microfone' : 'Desligar microfone'}
              style={{ width: 60, height: 60, borderRadius: 999, display: 'grid', placeItems: 'center', cursor: 'pointer',
                background: muted ? 'var(--danger)' : 'var(--surface-2)', color: muted ? '#fff' : 'var(--text)', border: '1px solid var(--border)' }}
            >
              <IconMic size={24} />
            </button>
            <button
              onClick={onClose}
              title="Terminar chamada"
              style={{ width: 66, height: 66, borderRadius: 999, display: 'grid', placeItems: 'center', cursor: 'pointer',
                background: 'var(--danger)', color: '#fff', border: 'none', boxShadow: '0 10px 26px -10px var(--danger)', transform: 'rotate(135deg)' }}
            >
              <IconPhone size={26} />
            </button>
          </div>
          <div className="muted" style={{ fontSize: 12, marginTop: 14 }}>Fala normalmente — eu respondo quando terminares. 🎙️</div>
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
