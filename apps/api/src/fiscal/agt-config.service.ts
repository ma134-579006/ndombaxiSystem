import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgtFiscalConfig, Prisma } from '@prisma/client';
import type { SaftSoftware } from '@nexus/agt-xml';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import { decryptSecret, encryptSecret, maskSecret } from '../common/crypto/secret-box';
import type { AgtExtraFieldDto, UpdateAgtConfigDto } from './dto/agt-config.dto';

export interface AgtExtraField {
  key: string;
  label: string;
  value: string;
  showOnReceipt: boolean;
  showOnReport: boolean;
}

/** Vista que os tenants (POS/recibos) podem ler — só o que é público/imprimível. */
export interface ReceiptFiscalInfo {
  subscribed: boolean;
  environment: string;
  softwareCertificateNumber: string;
  productId: string;
  productVersion: string;
  receiptLegend: string | null;
  fields: { label: string; value: string }[];
}

/** Vista segura para o Super Admin: a credencial NUNCA volta em claro (só mascarada). */
export interface SafeAgtConfig extends Omit<AgtFiscalConfig, 'apiKeyEnc'> {
  hasApiKey: boolean;
  apiKeyMask: string | null;
}

/** Credenciais REAIS (decifradas) — uso interno do serviço de comunicação, nunca exposto por API. */
export interface AgtCommunicationCreds {
  enabled: boolean;
  endpointUrl: string | null;
  apiKey: string | null;
}

/**
 * Configuração fiscal AGT (§7) — singleton lógico gerido 100% pelo Super Admin
 * no painel. Reúne os dados da certificação/subscrição AGT e as legendas que
 * têm de constar nos recibos/relatórios, configuráveis por interface sem código.
 */
@Injectable()
export class AgtConfigService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get encKey(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  /** Lê a configuração (cria a default na primeira leitura). */
  async get(): Promise<AgtFiscalConfig> {
    const existing = await this.prisma.agtFiscalConfig.findFirst();
    if (existing) return existing;
    return this.prisma.agtFiscalConfig.create({ data: {} });
  }

  /** Vista SEGURA para o painel do Super Admin (nunca devolve a credencial em claro). */
  async getSafe(): Promise<SafeAgtConfig> {
    const c = await this.get();
    const { apiKeyEnc, ...rest } = c;
    let apiKeyMask: string | null = null;
    if (apiKeyEnc) {
      try { apiKeyMask = maskSecret(decryptSecret(apiKeyEnc, this.encKey)); }
      catch { apiKeyMask = '••••••••'; }
    }
    return { ...rest, hasApiKey: !!apiKeyEnc, apiKeyMask };
  }

  /** Actualização parcial pelo Super Admin. Devolve a vista SEGURA (nunca a credencial em claro). */
  async update(dto: UpdateAgtConfigDto): Promise<SafeAgtConfig> {
    const current = await this.get();
    const { extraFields, apiKey, ...rest } = dto;
    await this.prisma.agtFiscalConfig.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(extraFields !== undefined
          ? { extraFields: this.normalizeExtra(extraFields) as unknown as Prisma.InputJsonValue }
          : {}),
        // apiKey: undefined = mantém; '' = limpa; valor = cifra e guarda.
        ...(apiKey !== undefined
          ? { apiKeyEnc: apiKey === '' ? null : encryptSecret(apiKey, this.encKey) }
          : {}),
      },
    });
    return this.getSafe();
  }

  /** Credenciais REAIS (decifradas) para o serviço de comunicação — NUNCA expor por API. */
  async getCommunicationCreds(): Promise<AgtCommunicationCreds> {
    const c = await this.get();
    let apiKey: string | null = null;
    if (c.apiKeyEnc) {
      try { apiKey = decryptSecret(c.apiKeyEnc, this.encKey); } catch { apiKey = null; }
    }
    return { enabled: c.communicationEnabled, endpointUrl: c.endpointUrl, apiKey };
  }

  /** Marca o sistema como subscrito à AGT (regista a data). */
  async subscribe(): Promise<SafeAgtConfig> {
    const current = await this.get();
    await this.prisma.agtFiscalConfig.update({
      where: { id: current.id },
      data: { subscribed: true, subscribedAt: current.subscribedAt ?? new Date() },
    });
    return this.getSafe();
  }

  /** Identificação do software para o cabeçalho SAF-T. */
  async getSaftSoftware(): Promise<SaftSoftware> {
    const c = await this.get();
    return {
      softwareCertificateNumber: c.softwareCertificateNumber,
      productId: c.productId,
      productVersion: c.productVersion,
      taxAccountingBasis: c.taxAccountingBasis,
      taxEntity: c.taxEntity,
      sourceId: c.sourceId,
      saftVersion: c.saftVersion,
    };
  }

  /** Informação fiscal que os recibos podem imprimir (legenda + campos livres). */
  async getReceiptInfo(): Promise<ReceiptFiscalInfo> {
    const c = await this.get();
    const extra = this.parseExtra(c.extraFields);
    return {
      subscribed: c.subscribed,
      environment: c.environment,
      softwareCertificateNumber: c.softwareCertificateNumber,
      productId: c.productId,
      productVersion: c.productVersion,
      receiptLegend: c.receiptLegend,
      fields: extra
        .filter((f) => f.showOnReceipt)
        .map((f) => ({ label: f.label, value: f.value })),
    };
  }

  // ── Helpers para os campos livres (JSON) ───────────────────
  private normalizeExtra(fields: AgtExtraFieldDto[]): AgtExtraField[] {
    return fields.map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      showOnReceipt: f.showOnReceipt ?? false,
      showOnReport: f.showOnReport ?? false,
    }));
  }

  private parseExtra(value: unknown): AgtExtraField[] {
    if (!Array.isArray(value)) return [];
    return (value as AgtExtraField[]).filter(
      (f) => f && typeof f.key === 'string' && typeof f.value === 'string',
    );
  }
}
