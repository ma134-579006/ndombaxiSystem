import { BadRequestException, Injectable } from '@nestjs/common';
import { AiConfigService } from './ai-config.service';
import { AiProviderClient, type ChatTurn } from './ai-provider.client';
import { buildSystemPrompt, type AssistantPersona, type PromptContext } from './assistant-prompt';

export interface ChartSpec {
  type: string;
  title?: string;
  labels?: (string | number)[];
  series?: { name: string; data: number[] }[];
}

export interface ChatResult {
  reply: string;
  charts: ChartSpec[];
  imagePrompts: string[];
  provider: string;
  model: string | null;
}

@Injectable()
export class AssistantService {
  constructor(
    private readonly cfg: AiConfigService,
    private readonly client: AiProviderClient,
  ) {}

  /** Persona efectiva a partir da configuração global do assistente. */
  private async persona(): Promise<AssistantPersona> {
    const c = await this.cfg.getAssistantConfig();
    return {
      displayName: c.displayName,
      persona: c.persona,
      locale: c.locale,
      emojiLevel: c.emojiLevel as AssistantPersona['emojiLevel'],
      chartsEnabled: c.chartsEnabled,
      imageEnabled: c.imageEnabled,
      voiceEnabled: c.voiceEnabled,
      systemPrompt: c.systemPrompt,
    };
  }

  /** Saudação configurada (para abrir o chat / a chamada). */
  async greeting(): Promise<{ greeting: string; displayName: string }> {
    const c = await this.cfg.getAssistantConfig();
    return {
      greeting:
        c.greeting ??
        `Olá! 👋 Sou o ${c.displayName}. Em que posso ajudar a sua empresa hoje?`,
      displayName: c.displayName,
    };
  }

  /** Conversa de texto: responde com Markdown rico + gráficos/imagens estruturados. */
  async chat(messages: ChatTurn[], ctx: PromptContext = {}): Promise<ChatResult> {
    const persona = await this.persona();
    const systemPrompt = buildSystemPrompt(persona, ctx);
    // Failover: tenta o provedor principal e, se falhar (quota/token), o seguinte.
    let usedProvider = '';
    const reply = await this.cfg.runWithFailover('CHAT', (provider, apiKey) => {
      usedProvider = provider.name;
      return this.client.chat(provider, apiKey, messages, systemPrompt);
    });
    if (!reply) {
      throw new BadRequestException(
        'Nenhum provedor de IA com capacidade CHAT está configurado. O Super Admin pode adicioná-lo no painel.',
      );
    }

    const { charts, imagePrompts } = this.extractBlocks(reply.text);
    return {
      reply: reply.text,
      charts,
      imagePrompts,
      provider: usedProvider,
      model: reply.model,
    };
  }

  /** Chave Gemini (quando o provedor CHAT é o endpoint Google) — permite voz
   *  e transcrição SEM provedores TTS/STT dedicados. */
  private async geminiKey(): Promise<string | null> {
    const r = await this.cfg.resolveForCapability('CHAT');
    return r?.apiKey && r.provider.baseUrl.includes('googleapis') ? r.apiKey : null;
  }

  /** PCM 16-bit mono → WAV (o Gemini TTS devolve PCM cru; o browser quer WAV). */
  private pcmToWav(pcmBase64: string, sampleRate = 24000): string {
    const pcm = Buffer.from(pcmBase64, 'base64');
    const header = Buffer.alloc(44);
    header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
    header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
    header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]).toString('base64');
  }

  /** Texto → áudio: provedor TTS dedicado OU a voz FEMININA natural do
   *  Gemini (voz "Leda") usando a chave já configurada. */
  async speak(text: string, voice?: string) {
    const resolved = await this.cfg.resolveForCapability('TTS');
    if (resolved) return this.client.tts(resolved.provider, resolved.apiKey, text, voice);
    const key = await this.geminiKey();
    if (!key) throw new BadRequestException('Nenhum provedor de IA com capacidade TTS está configurado.');
    const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ text: text.slice(0, 1200) }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice || 'Leda' } } },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new BadRequestException(`TTS Gemini falhou (${res.status}).`);
    const json = (await res.json()) as { candidates?: { content?: { parts?: { inlineData?: { data?: string; mimeType?: string } }[] } }[] };
    const part = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
    if (!part?.data) throw new BadRequestException('TTS Gemini sem áudio.');
    const rate = Number((part.mimeType ?? '').match(/rate=(\d+)/)?.[1] ?? 24000);
    return { audioBase64: this.pcmToWav(part.data, rate), mimeType: 'audio/wav' };
  }

  /** Áudio → texto: provedor STT dedicado OU transcrição multimodal Gemini. */
  async transcribe(audioBase64: string, mimeType?: string) {
    const resolved = await this.cfg.resolveForCapability('STT');
    if (resolved) return this.client.stt(resolved.provider, resolved.apiKey, audioBase64, mimeType);
    const key = await this.geminiKey();
    if (!key) throw new BadRequestException('Nenhum provedor de IA com capacidade STT está configurado.');
    const mt = (mimeType ?? 'audio/webm').split(';')[0];
    let lastStatus = 0;
    for (const model of ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash']) {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: 'Transcreve EXATAMENTE o que é dito neste áudio, em português. Responde só com a transcrição, sem comentários.' },
            { inlineData: { mimeType: mt, data: audioBase64 } },
          ] }],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!res.ok) { lastStatus = res.status; continue; }
      const json = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join(' ').trim() ?? '';
      if (text) return { text };
    }
    throw new BadRequestException(`STT Gemini falhou (${lastStatus || 'sem texto'}).`);
  }

  /** Geração de imagem a partir de um prompt. */
  async generateImage(prompt: string, size?: string) {
    const resolved = await this.cfg.resolveForCapability('IMAGE');
    if (!resolved) {
      throw new BadRequestException('Nenhum provedor de IA com capacidade IMAGE está configurado.');
    }
    return this.client.image(resolved.provider, resolved.apiKey, prompt, size);
  }

  /**
   * Turno de voz completo: transcreve o áudio do utilizador, conversa e
   * devolve a resposta em texto + áudio (para uma experiência de chamada).
   */
  async voiceTurn(audioBase64: string, mimeType: string | undefined, ctx: PromptContext = {}) {
    const { text: userText } = await this.transcribe(audioBase64, mimeType);
    const result = await this.chat([{ role: 'user', content: userText }], { ...ctx, channel: 'voice' });
    const audio = await this.speak(result.reply);
    return { userText, reply: result.reply, audioBase64: audio.audioBase64, mimeType: audio.mimeType };
  }

  /**
   * Sessão de chamada: devolve a configuração mínima para o frontend iniciar
   * uma chamada de voz (saudação + canais disponíveis). A negociação real do
   * stream depende do provedor VOICE_CALL configurado.
   */
  async callSession() {
    const c = await this.cfg.getAssistantConfig();
    const call = await this.cfg.resolveForCapability('VOICE_CALL');
    const gem = await this.geminiKey();
    const tts = (await this.cfg.resolveForCapability('TTS')) ?? (gem ? { gemini: true } : null);
    const stt = (await this.cfg.resolveForCapability('STT')) ?? (gem ? { gemini: true } : null);
    if (!c.callEnabled) {
      throw new BadRequestException('As chamadas com o assistente estão desativadas na configuração.');
    }
    const { greeting, displayName } = await this.greeting();
    return {
      displayName,
      greeting,
      mode: call ? 'realtime' : tts && stt ? 'half-duplex' : 'unavailable',
      capabilities: {
        realtime: !!call,
        tts: !!tts,
        stt: !!stt,
      },
      realtimeBaseUrl: call?.provider.baseUrl ?? null,
    };
  }

  // ── Extração de blocos estruturados da resposta ────────────
  /**
   * Lê blocos ```chart e ```image da resposta Markdown e devolve-os como
   * estruturas que o frontend renderiza (gráficos interactivos / imagens).
   */
  extractBlocks(text: string): { charts: ChartSpec[]; imagePrompts: string[] } {
    const charts: ChartSpec[] = [];
    const imagePrompts: string[] = [];
    const fence = /```(chart|image)\s*\n([\s\S]*?)```/g;
    let m: RegExpExecArray | null;
    while ((m = fence.exec(text)) !== null) {
      const kind = m[1];
      try {
        const parsed = JSON.parse(m[2].trim());
        if (kind === 'chart') charts.push(parsed as ChartSpec);
        else if (kind === 'image' && parsed?.prompt) imagePrompts.push(String(parsed.prompt));
      } catch {
        // bloco malformado — ignora silenciosamente
      }
    }
    return { charts, imagePrompts };
  }
}
