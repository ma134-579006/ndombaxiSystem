import { Injectable } from '@nestjs/common';
import { AgtFiscalConfig, Prisma } from '@prisma/client';
import type { SaftSoftware } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
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

/**
 * Configuração fiscal AGT (§7) — singleton lógico gerido 100% pelo Super Admin
 * no painel. Reúne os dados da certificação/subscrição AGT e as legendas que
 * têm de constar nos recibos/relatórios, configuráveis por interface sem código.
 */
@Injectable()
export class AgtConfigService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lê a configuração (cria a default na primeira leitura). */
  async get(): Promise<AgtFiscalConfig> {
    const existing = await this.prisma.agtFiscalConfig.findFirst();
    if (existing) return existing;
    return this.prisma.agtFiscalConfig.create({ data: {} });
  }

  /** Actualização parcial pelo Super Admin. */
  async update(dto: UpdateAgtConfigDto): Promise<AgtFiscalConfig> {
    const current = await this.get();
    const { extraFields, ...rest } = dto;
    return this.prisma.agtFiscalConfig.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(extraFields !== undefined
          ? { extraFields: this.normalizeExtra(extraFields) as unknown as Prisma.InputJsonValue }
          : {}),
      },
    });
  }

  /** Marca o sistema como subscrito à AGT (regista a data). */
  async subscribe(): Promise<AgtFiscalConfig> {
    const current = await this.get();
    return this.prisma.agtFiscalConfig.update({
      where: { id: current.id },
      data: { subscribed: true, subscribedAt: current.subscribedAt ?? new Date() },
    });
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
