import { UnprocessableEntityException } from '@nestjs/common';
import type { AiProvider } from '@prisma/client';
import { encryptSecret } from '../common/crypto/secret-box';
import { AiConfigService } from './ai-config.service';

const KEY = 'chave-de-teste-com-mais-de-32-caracteres-xx';

function provider(over: Partial<AiProvider>): AiProvider {
  return {
    id: 'p1', name: 'P1', adapter: 'openai', capabilities: ['CHAT'], baseUrl: 'https://x', model: null, voice: null,
    apiKeyEnc: null, headers: null, settings: null, isActive: true, isDefault: false, priority: 100,
    createdAt: new Date(), updatedAt: new Date(), ...over,
  } as AiProvider;
}

function service(rows: AiProvider[]): AiConfigService {
  const prisma = { aiProvider: { findMany: async () => rows } } as never;
  const config = { get: () => KEY } as never;
  return new AiConfigService(prisma, config);
}

describe('AiConfigService — chaves ilegíveis (chave de encriptação mudou)', () => {
  const good = provider({ id: 'good', name: 'Bom', apiKeyEnc: encryptSecret('sk-bom', KEY) });
  const bad = provider({ id: 'bad', name: 'Mau', isDefault: true, apiKeyEnc: encryptSecret('sk-mau', 'OUTRA-chave-de-encriptacao-antiga-xxxxxx') });

  it('ignora o fornecedor ilegível e usa o que funciona (failover)', async () => {
    const out = await service([bad, good]).resolveAllForCapability('CHAT');
    expect(out).toHaveLength(1);
    expect(out[0].provider.id).toBe('good');
    expect(out[0].apiKey).toBe('sk-bom');
  });

  it('se TODOS estiverem ilegíveis, dá uma mensagem clara em português', async () => {
    const p = service([bad]).resolveAllForCapability('CHAT');
    await expect(p).rejects.toBeInstanceOf(UnprocessableEntityException);
    await expect(service([bad]).resolveAllForCapability('CHAT')).rejects.toThrow(/volte a colar a chave/);
  });

  it('o fornecedor por omissão ilegível dá erro claro (não "Unsupported state")', async () => {
    await expect(service([bad]).resolveForCapability('CHAT')).rejects.toThrow(/Mau/);
  });

  it('a lista do painel marca o fornecedor como ilegível', async () => {
    const list = await service([bad, good]).listProviders();
    expect(list.find((p) => p.id === 'bad')?.keyUnreadable).toBe(true);
    expect(list.find((p) => p.id === 'good')?.keyUnreadable).toBe(false);
  });
});
