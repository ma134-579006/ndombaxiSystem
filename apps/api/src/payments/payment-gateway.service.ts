import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type PaymentGatewayConfig } from '@prisma/client';
import type { Env } from '../config/env.validation';
import { decryptSecret, encryptSecret, maskSecret } from '../common/crypto/secret-box';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateGatewayDto, UpdateGatewayDto } from './dto/gateway.dto';

/** Dados do contrato de referência (Entidade EMIS) guardados em `settings`. */
export interface ReferenceSettings {
  referenceEntity?: string;
  environment?: 'TEST' | 'PRODUCTION';
  validityDays?: number;
  callbackUrl?: string;
}

/** Vista segura — nunca expõe a credencial em claro. */
export interface SafeGateway {
  id: string;
  provider: string;
  label: string;
  contractRef: string | null;
  merchantId: string | null;
  posId: string | null;
  iban: string | null;
  baseUrl: string | null;
  hasApiKey: boolean;
  apiKeyMask: string | null;
  // Campos de referência (extraídos de settings) — seguros de expor.
  referenceEntity: string | null;
  environment: string | null;
  validityDays: number | null;
  callbackUrl: string | null;
  settings: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Gestão dos contratos de gateway (Multicaixa Express, EMIS, etc.) ao nível
 * da plataforma. Apenas o Super Admin gere; credenciais encriptadas (AES-256-GCM).
 */
@Injectable()
export class PaymentGatewayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get key(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  async list(): Promise<SafeGateway[]> {
    const rows = await this.prisma.paymentGatewayConfig.findMany({
      orderBy: [{ provider: 'asc' }, { label: 'asc' }],
    });
    return rows.map((r) => this.toSafe(r));
  }

  async get(id: string): Promise<SafeGateway> {
    return this.toSafe(await this.require(id));
  }

  /** Funde os campos de referência (entity/env/validade/callback) em settings. */
  private mergeRefSettings(
    base: Record<string, unknown> | undefined,
    dto: Partial<CreateGatewayDto>,
  ): Prisma.InputJsonValue | undefined {
    const s: Record<string, unknown> = { ...(base ?? {}), ...(dto.settings ?? {}) };
    if (dto.referenceEntity !== undefined) s.referenceEntity = dto.referenceEntity;
    if (dto.environment !== undefined) s.environment = dto.environment;
    if (dto.validityDays !== undefined) s.validityDays = dto.validityDays;
    if (dto.callbackUrl !== undefined) s.callbackUrl = dto.callbackUrl;
    return Object.keys(s).length ? (s as Prisma.InputJsonValue) : undefined;
  }

  async create(dto: CreateGatewayDto): Promise<SafeGateway> {
    const created = await this.prisma.paymentGatewayConfig.create({
      data: {
        provider: dto.provider,
        label: dto.label,
        contractRef: dto.contractRef ?? null,
        merchantId: dto.merchantId ?? null,
        posId: dto.posId ?? null,
        iban: dto.iban ?? null,
        baseUrl: dto.baseUrl ?? null,
        apiKeyEnc: dto.apiKey ? encryptSecret(dto.apiKey, this.key) : null,
        settings: this.mergeRefSettings(undefined, dto),
        isActive: dto.isActive ?? true,
      },
    });
    return this.toSafe(created);
  }

  async update(id: string, dto: UpdateGatewayDto): Promise<SafeGateway> {
    const existing = await this.require(id);
    const updated = await this.prisma.paymentGatewayConfig.update({
      where: { id },
      data: {
        provider: dto.provider,
        label: dto.label,
        contractRef: dto.contractRef,
        merchantId: dto.merchantId,
        posId: dto.posId,
        iban: dto.iban,
        baseUrl: dto.baseUrl,
        // só roda a credencial se vier uma nova (string vazia → remove)
        apiKeyEnc:
          dto.apiKey === undefined
            ? undefined
            : dto.apiKey
              ? encryptSecret(dto.apiKey, this.key)
              : null,
        settings: this.mergeRefSettings(
          (existing.settings as Record<string, unknown> | null) ?? undefined,
          dto,
        ),
        isActive: dto.isActive,
      },
    });
    return this.toSafe(updated);
  }

  async remove(id: string): Promise<{ id: string }> {
    await this.require(id);
    await this.prisma.paymentGatewayConfig.delete({ where: { id } });
    return { id };
  }

  /**
   * Contrato Express activo da plataforma (uso interno — pagamento automático).
   * Devolve a credencial já desencriptada. `null` se não houver contrato activo.
   */
  async getActiveExpress(): Promise<{ gateway: PaymentGatewayConfig; apiKey: string | null } | null> {
    const gateway = await this.prisma.paymentGatewayConfig.findFirst({
      where: { provider: 'EXPRESS', isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!gateway) return null;
    return {
      gateway,
      apiKey: gateway.apiKeyEnc ? decryptSecret(gateway.apiKeyEnc, this.key) : null,
    };
  }

  /**
   * Contrato de REFERÊNCIA activo da plataforma (Entidade EMIS). Aceita provider
   * REFERENCE ou EMIS. Devolve os dados do contrato + credencial desencriptada.
   * `null` se não houver contrato de referência activo com entidade configurada.
   */
  async getActiveReference(): Promise<{
    gateway: PaymentGatewayConfig;
    contract: ReferenceSettings;
    apiKey: string | null;
  } | null> {
    const gateway = await this.prisma.paymentGatewayConfig.findFirst({
      where: { provider: { in: ['REFERENCE', 'EMIS'] }, isActive: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!gateway) return null;
    const contract = (gateway.settings as ReferenceSettings | null) ?? {};
    if (!contract.referenceEntity) return null; // contrato incompleto
    return {
      gateway,
      contract,
      apiKey: gateway.apiKeyEnc ? decryptSecret(gateway.apiKeyEnc, this.key) : null,
    };
  }

  private async require(id: string): Promise<PaymentGatewayConfig> {
    const g = await this.prisma.paymentGatewayConfig.findUnique({ where: { id } });
    if (!g) throw new NotFoundException(`Gateway de pagamento não encontrado: ${id}`);
    return g;
  }

  private toSafe(g: PaymentGatewayConfig): SafeGateway {
    const ref = (g.settings as ReferenceSettings | null) ?? {};
    let mask: string | null = null;
    if (g.apiKeyEnc) {
      try {
        mask = maskSecret(decryptSecret(g.apiKeyEnc, this.key));
      } catch {
        mask = '••••••••';
      }
    }
    return {
      id: g.id,
      provider: g.provider,
      label: g.label,
      contractRef: g.contractRef,
      merchantId: g.merchantId,
      posId: g.posId,
      iban: g.iban,
      baseUrl: g.baseUrl,
      hasApiKey: !!g.apiKeyEnc,
      apiKeyMask: mask,
      referenceEntity: ref.referenceEntity ?? null,
      environment: ref.environment ?? null,
      validityDays: ref.validityDays ?? null,
      callbackUrl: ref.callbackUrl ?? null,
      settings: g.settings,
      isActive: g.isActive,
      createdAt: g.createdAt,
      updatedAt: g.updatedAt,
    };
  }
}
