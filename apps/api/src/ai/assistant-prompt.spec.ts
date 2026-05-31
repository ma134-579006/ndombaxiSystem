import {
  buildSystemPrompt,
  isAiAdapter,
  isAiCapability,
  resolveProvider,
  type AssistantPersona,
  type ProviderLike,
} from './assistant-prompt';

const persona: AssistantPersona = {
  displayName: 'NEXUS Assistant',
  persona: 'profissional, calorosa e humana',
  locale: 'pt-AO',
  emojiLevel: 'balanced',
  chartsEnabled: true,
  imageEnabled: true,
  voiceEnabled: true,
  systemPrompt: null,
};

describe('buildSystemPrompt', () => {
  it('inclui persona, idioma pt-AO e nome', () => {
    const p = buildSystemPrompt(persona);
    expect(p).toContain('NEXUS Assistant');
    expect(p).toContain('pt-AO');
    expect(p).toContain('calorosa');
  });

  it('no canal de texto pede tabelas, gráficos e imagens', () => {
    const p = buildSystemPrompt(persona, { channel: 'chat' });
    expect(p).toContain('TABELAS');
    expect(p).toContain('`chart`');
    expect(p).toContain('`image`');
  });

  it('no canal de voz evita Markdown e soa conversacional', () => {
    const p = buildSystemPrompt(persona, { channel: 'voice' });
    expect(p).toContain('VOZ');
    expect(p).not.toContain('TABELAS');
  });

  it('respeita emojiLevel none', () => {
    const p = buildSystemPrompt({ ...persona, emojiLevel: 'none' });
    expect(p).toContain('Não uses emojis');
  });

  it('usa systemPrompt como override total quando presente', () => {
    const p = buildSystemPrompt({ ...persona, systemPrompt: '  Sou um override.  ' });
    expect(p).toBe('Sou um override.');
  });

  it('personaliza com empresa e papel', () => {
    const p = buildSystemPrompt(persona, { companyName: 'Loja Kwanza', userRole: 'STORE_MANAGER' });
    expect(p).toContain('Loja Kwanza');
    expect(p).toContain('STORE_MANAGER');
  });
});

describe('resolveProvider', () => {
  const base: Omit<ProviderLike, 'id'> = {
    capabilities: ['CHAT'],
    isActive: true,
    isDefault: false,
    priority: 100,
  };

  it('devolve null quando nenhum provedor serve a capacidade', () => {
    expect(resolveProvider([{ id: 'a', ...base }], 'IMAGE')).toBeNull();
  });

  it('ignora provedores inactivos', () => {
    const r = resolveProvider([{ id: 'a', ...base, isActive: false }], 'CHAT');
    expect(r).toBeNull();
  });

  it('prefere isDefault sobre prioridade', () => {
    const r = resolveProvider(
      [
        { id: 'a', ...base, priority: 1 },
        { id: 'b', ...base, isDefault: true, priority: 999 },
      ],
      'CHAT',
    );
    expect(r?.id).toBe('b');
  });

  it('desempata por menor priority', () => {
    const r = resolveProvider(
      [
        { id: 'a', ...base, priority: 50 },
        { id: 'b', ...base, priority: 10 },
      ],
      'CHAT',
    );
    expect(r?.id).toBe('b');
  });
});

describe('guards', () => {
  it('valida capacidades e adaptadores', () => {
    expect(isAiCapability('CHAT')).toBe(true);
    expect(isAiCapability('FOO')).toBe(false);
    expect(isAiAdapter('openmanus')).toBe(true);
    expect(isAiAdapter('foo')).toBe(false);
  });
});
