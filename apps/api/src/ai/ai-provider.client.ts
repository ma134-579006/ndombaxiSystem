import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import type { AiProvider } from '@prisma/client';

export interface ChatTurn {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatReply {
  text: string;
  model: string | null;
  raw?: unknown;
}

/**
 * Cliente HTTP agnóstico ao provedor. Traduz pedidos do assistente para o
 * protocolo do adapter configurado pelo Super Admin (sem mudanças de código):
 *   • openai / openmanus  → /chat/completions, /audio/speech, /audio/transcriptions, /images/generations
 *   • anthropic           → /messages (cabeçalho x-api-key + anthropic-version)
 *   • elevenlabs          → /text-to-speech/{voice}
 *   • generic             → caminhos e mapeamento de resposta vindos de `settings`
 *
 * Tudo via `fetch` nativo (Node ≥ 18). Falhas de rede → 503 com contexto.
 */
@Injectable()
export class AiProviderClient {
  private readonly logger = new Logger(AiProviderClient.name);

  async chat(
    provider: AiProvider,
    apiKey: string | null,
    messages: ChatTurn[],
    systemPrompt: string,
  ): Promise<ChatReply> {
    const settings = (provider.settings ?? {}) as Record<string, unknown>;
    const adapter = provider.adapter;

    if (adapter === 'anthropic') {
      const body = {
        model: provider.model ?? 'claude-3-5-sonnet-latest',
        max_tokens: (settings.maxTokens as number) ?? 1024,
        system: systemPrompt,
        messages: messages
          .filter((m) => m.role !== 'system')
          .map((m) => ({ role: m.role, content: m.content })),
      };
      const json = await this.post(provider, apiKey, this.path(provider, 'messages', '/messages'), body, {
        'anthropic-version': (settings.anthropicVersion as string) ?? '2023-06-01',
      });
      const text = this.dig(json, ['content', '0', 'text']) ?? '';
      return { text: String(text), model: body.model, raw: json };
    }

    if (adapter === 'openclaw') {
      // Gateway OpenClaw (github.com/openclaw/openclaw) — endpoint OpenAI-compatível
      // /v1/chat/completions com Authorization: Bearer <token do gateway>.
      // SEM campo `user` → cada pedido é stateless (o gateway não retém sessão).
      const body = {
        model: provider.model ?? 'openclaw',
        messages: [{ role: 'system', content: systemPrompt }, ...messages.filter((m) => m.role !== 'system')],
        temperature: (settings.temperature as number) ?? 0.3,
        max_completion_tokens: (settings.maxTokens as number) ?? 400,
        stream: false,
      };
      const json = await this.post(provider, apiKey, this.path(provider, 'chatPath', '/v1/chat/completions'), body);
      const text = this.dig(json, ['choices', '0', 'message', 'content']) ?? '';
      return { text: String(text), model: body.model, raw: json };
    }

    // openai / openmanus / generic (assume OpenAI-compatible por omissão)
    const path = this.path(provider, 'chatPath', '/chat/completions');
    const body = {
      model: provider.model ?? 'gpt-4o-mini',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: (settings.temperature as number) ?? 0.7,
    };
    const json = await this.post(provider, apiKey, path, body);
    const responsePath = (settings.responsePath as string) ?? 'choices.0.message.content';
    const text = this.dig(json, responsePath.split('.')) ?? '';
    return { text: String(text), model: body.model, raw: json };
  }

  /** Texto → áudio (base64). */
  async tts(
    provider: AiProvider,
    apiKey: string | null,
    text: string,
    voice?: string,
  ): Promise<{ audioBase64: string; mimeType: string }> {
    const chosenVoice = voice ?? provider.voice ?? 'alloy';
    let path: string;
    let body: Record<string, unknown>;

    if (provider.adapter === 'elevenlabs') {
      path = `/text-to-speech/${encodeURIComponent(chosenVoice)}`;
      body = { text, model_id: provider.model ?? 'eleven_multilingual_v2' };
    } else {
      path = this.path(provider, 'ttsPath', '/audio/speech');
      body = { model: provider.model ?? 'tts-1', voice: chosenVoice, input: text };
    }

    const res = await this.rawPost(provider, apiKey, path, body);
    const buf = Buffer.from(await res.arrayBuffer());
    const mimeType = res.headers.get('content-type') ?? 'audio/mpeg';
    return { audioBase64: buf.toString('base64'), mimeType };
  }

  /** Áudio (base64) → texto. */
  async stt(
    provider: AiProvider,
    apiKey: string | null,
    audioBase64: string,
    mimeType = 'audio/webm',
  ): Promise<{ text: string }> {
    const path = this.path(provider, 'sttPath', '/audio/transcriptions');
    const form = new FormData();
    const bytes = Buffer.from(audioBase64, 'base64');
    form.append('file', new Blob([bytes], { type: mimeType }), 'audio.webm');
    form.append('model', provider.model ?? 'whisper-1');

    const res = await this.fetchOrThrow(this.url(provider, path), {
      method: 'POST',
      headers: this.authHeaders(provider, apiKey, false),
      body: form,
    });
    const json = (await res.json()) as Record<string, unknown>;
    return { text: String(json.text ?? '') };
  }

  /** Geração de imagem → devolve URL ou base64. */
  async image(
    provider: AiProvider,
    apiKey: string | null,
    prompt: string,
    size = '1024x1024',
  ): Promise<{ url?: string; b64?: string }> {
    const path = this.path(provider, 'imagePath', '/images/generations');
    const json = await this.post(provider, apiKey, path, {
      model: provider.model ?? 'gpt-image-1',
      prompt,
      size,
      n: 1,
    });
    const url = this.dig(json, ['data', '0', 'url']);
    const b64 = this.dig(json, ['data', '0', 'b64_json']);
    return { url: url ? String(url) : undefined, b64: b64 ? String(b64) : undefined };
  }

  /** Teste de conectividade rápido (HEAD/GET ao baseUrl). */
  async ping(provider: AiProvider, apiKey: string | null): Promise<{ ok: boolean; status: number }> {
    try {
      const res = await fetch(provider.baseUrl, {
        method: 'GET',
        headers: this.authHeaders(provider, apiKey, false),
        signal: AbortSignal.timeout(8000),
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      this.logger.warn(`Ping ao provedor ${provider.name} falhou: ${String(err)}`);
      return { ok: false, status: 0 };
    }
  }

  // ── Helpers de transporte ──────────────────────────────────
  private async post(
    provider: AiProvider,
    apiKey: string | null,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Record<string, unknown>> {
    const res = await this.rawPost(provider, apiKey, path, body, extraHeaders);
    return (await res.json()) as Record<string, unknown>;
  }

  private async rawPost(
    provider: AiProvider,
    apiKey: string | null,
    path: string,
    body: unknown,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    return this.fetchOrThrow(this.url(provider, path), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...this.authHeaders(provider, apiKey, true), ...extraHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  }

  private async fetchOrThrow(url: string, init: RequestInit): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (err) {
      throw new ServiceUnavailableException(
        `Falha de comunicação com o provedor de IA: ${err instanceof Error ? err.message : 'desconhecida'}`,
      );
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new ServiceUnavailableException(
        `Provedor de IA respondeu ${res.status}: ${detail.slice(0, 300)}`,
      );
    }
    return res;
  }

  private authHeaders(
    provider: AiProvider,
    apiKey: string | null,
    json: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {};
    if (apiKey) {
      if (provider.adapter === 'anthropic') headers['x-api-key'] = apiKey;
      else if (provider.adapter === 'elevenlabs') headers['xi-api-key'] = apiKey;
      else headers['authorization'] = `Bearer ${apiKey}`;
    }
    // cabeçalhos extra definidos no painel (sobrepõem-se)
    const extra = (provider.headers ?? {}) as Record<string, string>;
    Object.assign(headers, extra);
    if (json && !headers['content-type']) headers['content-type'] = 'application/json';
    return headers;
  }

  private url(provider: AiProvider, path: string): string {
    const base = provider.baseUrl.replace(/\/+$/, '');
    const p = path.startsWith('/') ? path : `/${path}`;
    return base + p;
  }

  /** Lê um caminho configurável de `settings` (adapter generic) ou usa o default. */
  private path(provider: AiProvider, settingKey: string, fallback: string): string {
    const settings = (provider.settings ?? {}) as Record<string, unknown>;
    const v = settings[settingKey];
    return typeof v === 'string' && v ? v : fallback;
  }

  /** Acede a um valor aninhado por caminho (array de chaves), tolerante a arrays. */
  private dig(obj: unknown, keys: string[]): unknown {
    let cur: unknown = obj;
    for (const k of keys) {
      if (cur == null) return undefined;
      cur = (cur as Record<string, unknown>)[k];
    }
    return cur;
  }
}
