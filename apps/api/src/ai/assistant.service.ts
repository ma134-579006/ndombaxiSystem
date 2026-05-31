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
    const resolved = await this.cfg.resolveForCapability('CHAT');
    if (!resolved) {
      throw new BadRequestException(
        'Nenhum provedor de IA com capacidade CHAT está configurado. O Super Admin pode adicioná-lo no painel.',
      );
    }
    const persona = await this.persona();
    const systemPrompt = buildSystemPrompt(persona, ctx);
    const reply = await this.client.chat(resolved.provider, resolved.apiKey, messages, systemPrompt);

    const { charts, imagePrompts } = this.extractBlocks(reply.text);
    return {
      reply: reply.text,
      charts,
      imagePrompts,
      provider: resolved.provider.name,
      model: reply.model,
    };
  }

  /** Texto → áudio (voz humana) usando o provedor TTS configurado. */
  async speak(text: string, voice?: string) {
    const resolved = await this.cfg.resolveForCapability('TTS');
    if (!resolved) {
      throw new BadRequestException('Nenhum provedor de IA com capacidade TTS está configurado.');
    }
    return this.client.tts(resolved.provider, resolved.apiKey, text, voice);
  }

  /** Áudio → texto (transcrição) usando o provedor STT configurado. */
  async transcribe(audioBase64: string, mimeType?: string) {
    const resolved = await this.cfg.resolveForCapability('STT');
    if (!resolved) {
      throw new BadRequestException('Nenhum provedor de IA com capacidade STT está configurado.');
    }
    return this.client.stt(resolved.provider, resolved.apiKey, audioBase64, mimeType);
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
    const tts = await this.cfg.resolveForCapability('TTS');
    const stt = await this.cfg.resolveForCapability('STT');
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
