import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type AiProvider } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, maskSecret } from '../common/crypto/secret-box';
import type { AiCapability } from './assistant-prompt';
import { resolveAllProviders, resolveProvider } from './assistant-prompt';
import type { CreateAiProviderDto, UpdateAiProviderDto } from './dto/provider.dto';
import type { UpdateAssistantConfigDto } from './dto/assistant-config.dto';

/** Vista segura de um provedor — sem expor a chave em claro. */
export interface SafeAiProvider {
  id: string;
  name: string;
  adapter: string;
  capabilities: string[];
  baseUrl: string;
  model: string | null;
  voice: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  /** A chave guardada não pode ser desencriptada (mudou a chave de encriptação do servidor). */
  keyUnreadable: boolean;
  headers: unknown;
  settings: unknown;
  isActive: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AiConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private readonly logger = new Logger(AiConfigService.name);

  private get key(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  private unreadableMessage(names: string[]): string {
    return `A chave da API do fornecedor de IA (${names.join(', ')}) não pode ser lida — foi guardada com outra chave de encriptação. No Super Admin → Inteligência Artificial → Editar, volte a colar a chave da API e guarde.`;
  }

  /** Desencripta a chave do provedor; se não for possível, erro claro em vez de "Unsupported state". */
  private readKey(p: AiProvider): string | null {
    if (!p.apiKeyEnc) return null;
    try {
      return decryptSecret(p.apiKeyEnc, this.key);
    } catch {
      throw new UnprocessableEntityException(this.unreadableMessage([p.name]));
    }
  }

  // ── Provedores (CRUD do painel do Super Admin) ─────────────
  async listProviders(): Promise<SafeAiProvider[]> {
    const rows = await this.prisma.aiProvider.findMany({
      orderBy: [{ isDefault: 'desc' }, { priority: 'asc' }, { name: 'asc' }],
    });
    return rows.map((p) => this.toSafe(p));
  }

  async getProvider(id: string): Promise<SafeAiProvider> {
    return this.toSafe(await this.requireProvider(id));
  }

  async createProvider(dto: CreateAiProviderDto): Promise<SafeAiProvider> {
    const created = await this.prisma.aiProvider.create({
      data: {
        name: dto.name,
        adapter: dto.adapter,
        capabilities: dto.capabilities,
        baseUrl: dto.baseUrl,
        apiKeyEnc: dto.apiKey ? encryptSecret(dto.apiKey, this.key) : null,
        model: dto.model ?? null,
        voice: dto.voice ?? null,
        headers: (dto.headers ?? undefined) as Prisma.InputJsonValue | undefined,
        settings: (dto.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive ?? true,
        isDefault: dto.isDefault ?? false,
        priority: dto.priority ?? 100,
      },
    });
    return this.toSafe(created);
  }

  async updateProvider(id: string, dto: UpdateAiProviderDto): Promise<SafeAiProvider> {
    await this.requireProvider(id);
    const updated = await this.prisma.aiProvider.update({
      where: { id },
      data: {
        name: dto.name,
        adapter: dto.adapter,
        capabilities: dto.capabilities,
        baseUrl: dto.baseUrl,
        // só roda a chave se vier uma nova (string vazia → remove auth)
        apiKeyEnc:
          dto.apiKey === undefined
            ? undefined
            : dto.apiKey
              ? encryptSecret(dto.apiKey, this.key)
              : null,
        model: dto.model,
        voice: dto.voice,
        headers: (dto.headers ?? undefined) as Prisma.InputJsonValue | undefined,
        settings: (dto.settings ?? undefined) as Prisma.InputJsonValue | undefined,
        isActive: dto.isActive,
        isDefault: dto.isDefault,
        priority: dto.priority,
      },
    });
    return this.toSafe(updated);
  }

  async deleteProvider(id: string): Promise<{ id: string }> {
    await this.requireProvider(id);
    await this.prisma.aiProvider.delete({ where: { id } });
    return { id };
  }

  // ── Resolução interna (usada pelo cliente HTTP) ────────────
  /** Provedor activo para uma capacidade, com a chave já desencriptada. */
  async resolveForCapability(
    capability: AiCapability,
  ): Promise<{ provider: AiProvider; apiKey: string | null } | null> {
    const all = await this.prisma.aiProvider.findMany();
    const chosen = resolveProvider(all, capability);
    if (!chosen) return null;
    return {
      provider: chosen,
      apiKey: this.readKey(chosen),
    };
  }

  /**
   * TODOS os provedores activos para uma capacidade, por ordem de preferência
   * (default → priority), já com a chave desencriptada. Serve o FAILOVER: se o
   * 1.º falhar (quota/token), o chamador passa ao 2.º, etc.
   */
  async resolveAllForCapability(
    capability: AiCapability,
  ): Promise<{ provider: AiProvider; apiKey: string | null }[]> {
    const all = await this.prisma.aiProvider.findMany();
    const out: { provider: AiProvider; apiKey: string | null }[] = [];
    const unreadable: string[] = [];
    for (const provider of resolveAllProviders(all, capability)) {
      try {
        out.push({ provider, apiKey: this.readKey(provider) });
      } catch {
        unreadable.push(provider.name);
        this.logger.warn(`Chave do provedor de IA "${provider.name}" ilegível (chave de encriptação diferente) — ignorado.`);
      }
    }
    if (!out.length && unreadable.length) {
      throw new UnprocessableEntityException(this.unreadableMessage(unreadable));
    }
    return out;
  }

  /**
   * Executa `fn` no primeiro provedor da capacidade que tiver SUCESSO. Se um
   * provedor falhar (quota esgotada, token inválido, erro de rede), migra
   * automaticamente para o seguinte. Lança o último erro se todos falharem.
   */
  async runWithFailover<R>(
    capability: AiCapability,
    fn: (provider: AiProvider, apiKey: string | null) => Promise<R>,
  ): Promise<R | null> {
    const providers = await this.resolveAllForCapability(capability);
    if (providers.length === 0) return null;
    let lastErr: unknown = null;
    for (const { provider, apiKey } of providers) {
      try {
        return await fn(provider, apiKey);
      } catch (e) {
        lastErr = e;
        // tenta o próximo provedor (failover)
      }
    }
    throw lastErr ?? new Error('Todos os provedores de IA falharam.');
  }

  /** Carrega um provedor por id já com a chave desencriptada (uso interno/teste). */
  async resolveProviderWithKey(
    id: string,
  ): Promise<{ provider: AiProvider; apiKey: string | null }> {
    const provider = await this.requireProvider(id);
    return {
      provider,
      apiKey: this.readKey(provider),
    };
  }

  // ── Persona / configuração do assistente (singleton) ───────
  async getAssistantConfig() {
    const existing = await this.prisma.aiAssistantConfig.findFirst();
    if (existing) return existing;
    // cria a configuração por omissão na primeira leitura
    return this.prisma.aiAssistantConfig.create({ data: {} });
  }

  async updateAssistantConfig(dto: UpdateAssistantConfigDto) {
    const current = await this.getAssistantConfig();
    return this.prisma.aiAssistantConfig.update({
      where: { id: current.id },
      data: { ...dto },
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  private async requireProvider(id: string): Promise<AiProvider> {
    const p = await this.prisma.aiProvider.findUnique({ where: { id } });
    if (!p) throw new NotFoundException(`Provedor de IA não encontrado: ${id}`);
    return p;
  }

  private toSafe(p: AiProvider): SafeAiProvider {
    let mask: string | null = null;
    let keyUnreadable = false;
    if (p.apiKeyEnc) {
      try {
        mask = maskSecret(decryptSecret(p.apiKeyEnc, this.key));
      } catch {
        mask = '••••••••';
        keyUnreadable = true;
      }
    }
    return {
      id: p.id,
      name: p.name,
      adapter: p.adapter,
      capabilities: p.capabilities,
      baseUrl: p.baseUrl,
      model: p.model,
      voice: p.voice,
      hasApiKey: !!p.apiKeyEnc,
      apiKeyMask: mask,
      keyUnreadable,
      headers: p.headers,
      settings: p.settings,
      isActive: p.isActive,
      isDefault: p.isDefault,
      priority: p.priority,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
