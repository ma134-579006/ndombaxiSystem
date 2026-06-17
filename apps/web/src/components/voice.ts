/** Gravação do microfone (push-to-talk) e reprodução de áudio base64. */

export interface Recorder {
  stop(): Promise<{ base64: string; mimeType: string }>;
  cancel(): void;
}

export function micSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window !== 'undefined' &&
    'MediaRecorder' in window
  );
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result);
      resolve(s.includes(',') ? s.slice(s.indexOf(',') + 1) : s);
    };
    r.onerror = () => reject(new Error('read'));
    r.readAsDataURL(blob);
  });
}

export async function startRecording(): Promise<Recorder> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mr = new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.start();
  const cleanup = () => stream.getTracks().forEach((t) => t.stop());
  return {
    stop: () =>
      new Promise((resolve) => {
        mr.onstop = async () => {
          cleanup();
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          resolve({ base64: await blobToBase64(blob), mimeType: blob.type || 'audio/webm' });
        };
        try { mr.stop(); } catch { cleanup(); }
      }),
    cancel: () => { try { mr.stop(); } catch { /* ignore */ } cleanup(); },
  };
}

/* ────────────────────────────────────────────────────────────────
   CHAMADA AO VIVO (estilo ChatGPT): escuta contínua com deteção de
   fim de fala (VAD por energia/RMS). Envia automaticamente quando o
   utilizador pára de falar — sem clicar em nada. Supressão de eco e
   de ruído (filtra vozes/sons de fundo) via getUserMedia + um "portão"
   de energia acima do ruído ambiente. Enquanto o assistente fala, a
   escuta fica EM PAUSA (não se ouve a si próprio).
   ──────────────────────────────────────────────────────────────── */
export interface VoiceCall {
  /** Pausa/retoma a escuta (ex.: pausar enquanto o assistente fala). */
  setPaused(p: boolean): void;
  stop(): void;
}
export interface VoiceCallHandlers {
  /** Chamado quando o utilizador termina uma fala (áudio pronto a enviar). */
  onUtterance(audio: { base64: string; mimeType: string }): void;
  /** Estado da escuta: 'listening' (à espera) ou 'recording' (a captar fala). */
  onState?(s: 'listening' | 'recording'): void;
  /** Nível de áudio 0..1 (para o visualizador). */
  onLevel?(level: number): void;
  onError?(e: unknown): void;
}

export async function startVoiceCall(h: VoiceCallHandlers): Promise<VoiceCall> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const AC = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
  const ctx = new AC();
  try { await ctx.resume(); } catch { /* já ativo */ }
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser); // NÃO liga ao destino → sem eco
  const buf = new Float32Array(analyser.fftSize);

  let paused = false;
  let state: 'listening' | 'recording' = 'listening';
  let noiseFloor = 0.01;
  let calib = 0;            // ticks de calibração do ruído ambiente
  let loudTicks = 0;        // ticks consecutivos com fala (p/ iniciar)
  let lastLoud = 0;         // último instante com fala (p/ detetar silêncio)
  let recStart = 0;
  let mr: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];

  const TICK = 60;          // ms por amostra
  const START_TICKS = 3;    // ~180ms de fala sustentada p/ iniciar (ignora estalos/vozes curtas)
  const SILENCE_MS = 900;   // silêncio que marca o fim da fala
  const MIN_MS = 350;       // fala mínima válida (filtra ruído curto)
  const MAX_MS = 15000;     // teto por turno

  const rms = (): number => {
    analyser.getFloatTimeDomainData(buf);
    let s = 0; for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  };

  const startRec = () => {
    chunks = [];
    try {
      mr = new MediaRecorder(stream);
      mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      mr.start();
      state = 'recording'; recStart = Date.now(); lastLoud = Date.now();
      h.onState?.('recording');
    } catch (e) { h.onError?.(e); }
  };

  const finishRec = (discard = false) => {
    const dur = Date.now() - recStart;
    const rec = mr; mr = null;
    state = 'listening'; loudTicks = 0; h.onState?.('listening');
    if (!rec) return;
    rec.onstop = async () => {
      if (discard || dur < MIN_MS) return;
      const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' });
      try { h.onUtterance({ base64: await blobToBase64(blob), mimeType: blob.type || 'audio/webm' }); }
      catch (e) { h.onError?.(e); }
    };
    try { rec.stop(); } catch { /* ignore */ }
  };

  const timer = window.setInterval(() => {
    const level = rms();
    h.onLevel?.(Math.min(1, level * 8));
    if (paused) { if (state === 'recording') finishRec(true); return; }

    // calibração do ruído ambiente (primeiros ~12 ticks)
    if (calib < 12) { noiseFloor = noiseFloor * 0.7 + level * 0.3; calib++; return; }
    const threshold = Math.max(noiseFloor * 2.5, 0.015);

    if (state === 'listening') {
      if (level > threshold) { loudTicks++; if (loudTicks >= START_TICKS) startRec(); }
      else { loudTicks = Math.max(0, loudTicks - 1); }
    } else {
      if (level > threshold) lastLoud = Date.now();
      if (Date.now() - lastLoud > SILENCE_MS || Date.now() - recStart > MAX_MS) finishRec(false);
    }
  }, TICK);

  return {
    setPaused: (p) => {
      paused = p;
      if (p && state === 'recording') finishRec(true);
      if (!p) { calib = Math.min(calib, 8); loudTicks = 0; } // recalibra um pouco ao retomar
    },
    stop: () => {
      window.clearInterval(timer);
      if (mr) { try { mr.stop(); } catch { /* ignore */ } mr = null; }
      stream.getTracks().forEach((t) => t.stop());
      try { void ctx.close(); } catch { /* ignore */ }
    },
  };
}

let current: HTMLAudioElement | null = null;

export function playBase64Audio(base64: string, mimeType = 'audio/mpeg'): HTMLAudioElement {
  stopAudio();
  const audio = new Audio(`data:${mimeType};base64,${base64}`);
  current = audio;
  void audio.play().catch(() => { /* autoplay bloqueado */ });
  return audio;
}

export function stopAudio(): void {
  if (current) { try { current.pause(); } catch { /* ignore */ } current = null; }
}
