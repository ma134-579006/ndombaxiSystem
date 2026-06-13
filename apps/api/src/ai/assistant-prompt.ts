/**
 * Motor PURO do assistente OpenManus (§ Fase 7): construção do prompt de
 * sistema (persona profissional e humana) e resolução do provedor adequado
 * a cada capacidade. Sem dependências de BD/HTTP — totalmente testável.
 */

/** Capacidades que um provedor de IA pode oferecer. */
export const AI_CAPABILITIES = ['CHAT', 'TTS', 'STT', 'IMAGE', 'VOICE_CALL'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Adaptadores suportados (protocolos de chamada conhecidos + genérico). */
export const AI_ADAPTERS = ['openai', 'openmanus', 'openclaw', 'anthropic', 'elevenlabs', 'generic'] as const;
export type AiAdapter = (typeof AI_ADAPTERS)[number];

export type EmojiLevel = 'none' | 'subtle' | 'balanced' | 'rich';

export interface AssistantPersona {
  displayName: string;
  persona: string;
  locale: string;
  emojiLevel: EmojiLevel;
  chartsEnabled: boolean;
  imageEnabled: boolean;
  voiceEnabled: boolean;
  /** Override total — se presente, é usado tal e qual. */
  systemPrompt?: string | null;
}

export interface PromptContext {
  /** Empresa/tenant a que o utilizador pertence (para personalização). */
  companyName?: string | null;
  /** Papel do utilizador (RBAC) — ajusta o tom e o detalhe. */
  userRole?: string | null;
  /** Canal de interacção: ajusta o formato (voz → respostas faladas). */
  channel?: 'chat' | 'voice' | 'call';
}

const EMOJI_GUIDANCE: Record<EmojiLevel, string> = {
  none: 'Não uses emojis.',
  subtle: 'Usa emojis com muita moderação, só quando acrescentam clareza.',
  balanced:
    'Usa emojis de forma equilibrada e profissional para dar calor humano (ex.: ✅, 📊, 💡, 🙂), sem exagerar.',
  rich: 'Usa emojis de forma expressiva e calorosa ao longo das respostas, mantendo o profissionalismo.',
};

/**
 * Constrói o prompt de sistema do assistente. Combina persona, idioma (pt-AO),
 * regras de formatação ricas (Markdown: tabelas, blocos ```chart para gráficos,
 * geração de imagens) e adaptação ao canal (texto vs. voz/chamada).
 */
export function buildSystemPrompt(persona: AssistantPersona, ctx: PromptContext = {}): string {
  if (persona.systemPrompt && persona.systemPrompt.trim()) {
    return persona.systemPrompt.trim();
  }

  const channel = ctx.channel ?? 'chat';
  const lines: string[] = [];

  lines.push(
    `És o "${persona.displayName}", o assistente de IA do Ndombaxi System — uma plataforma empresarial angolana (POS, ERP, e-commerce e gestão).`,
  );
  lines.push(
    `A tua personalidade é ${persona.persona}. Falas como um ser humano competente e atencioso, nunca robótico.`,
  );
  lines.push(
    `Comunicas SEMPRE em Português de Angola (${persona.locale}), claro e cordial. Tratas o utilizador com respeito e proximidade.`,
  );

  if (ctx.companyName) {
    lines.push(`Estás a apoiar a empresa "${ctx.companyName}".`);
  }
  if (ctx.userRole) {
    lines.push(`O utilizador tem o papel "${ctx.userRole}" — ajusta o detalhe e as permissões ao seu nível.`);
  }

  lines.push(EMOJI_GUIDANCE[persona.emojiLevel]);

  if (channel === 'voice' || channel === 'call') {
    lines.push(
      'CANAL DE VOZ: responde de forma natural e conversacional, frases curtas e fáceis de ouvir. ' +
        'Evita Markdown, tabelas e blocos de código — descreve os números por palavras. ' +
        'Soa humano: usa pausas naturais, confirma que percebeste e mostra empatia.',
    );
  } else {
    lines.push(
      'CANAL DE TEXTO: usa Markdown bem organizado — títulos, listas e **negrito** para destacar.',
    );
    lines.push(
      'Sempre que apresentares dados comparáveis (vendas, stock, salários, KPIs), usa TABELAS Markdown claras.',
    );
    if (persona.chartsEnabled) {
      lines.push(
        'Quando um gráfico ajudar, inclui um bloco de código com a linguagem `chart` contendo JSON com ' +
          '{ "type": "line|bar|pie|area", "title": "...", "labels": [...], "series": [{ "name": "...", "data": [...] }] }. ' +
          'O frontend renderiza esse bloco como gráfico interactivo.',
      );
    }
    if (persona.imageEnabled) {
      lines.push(
        'Quando o utilizador pedir uma imagem/ilustração, sinaliza-o com um bloco `image` contendo ' +
          'JSON { "prompt": "descrição detalhada" } para que o sistema a gere.',
      );
    }
  }

  lines.push(
    'Sê honesto: se não souber ou não tiver dados, di-lo com transparência e sugere o próximo passo. Nunca inventes números fiscais.',
  );

  return lines.join('\n');
}

export interface ProviderLike {
  id: string;
  capabilities: string[];
  isActive: boolean;
  isDefault: boolean;
  priority: number;
}

/**
 * Escolhe o provedor para uma capacidade: entre os activos que a suportam,
 * prefere os marcados como `isDefault`, depois menor `priority`, depois mais
 * antigo (estável). Devolve `null` se nenhum servir.
 */
export function resolveAllProviders<T extends ProviderLike>(
  providers: T[],
  capability: AiCapability,
): T[] {
  return providers
    .filter((p) => p.isActive && p.capabilities.includes(capability))
    .sort((a, b) => {
      if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id.localeCompare(b.id);
    });
}

export function resolveProvider<T extends ProviderLike>(
  providers: T[],
  capability: AiCapability,
): T | null {
  return resolveAllProviders(providers, capability)[0] ?? null;
}

export function isAiCapability(value: string): value is AiCapability {
  return (AI_CAPABILITIES as readonly string[]).includes(value);
}

export function isAiAdapter(value: string): value is AiAdapter {
  return (AI_ADAPTERS as readonly string[]).includes(value);
}
