import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { EinvoiceService } from '../einvoice/einvoice.service';

export interface AgtCommStatus {
  enabled: boolean;
  configured: boolean;
  pending: number;
  communicated: number;
  /** Documentos que a AGT rejeitou (precisam de correcção). */
  rejected?: number;
}

export interface AgtCommResult {
  sent: number;
  failed: number;
  errors: string[];
}

/**
 * Comunicação electrónica com a AGT (DP 71/25 · DE 683/25): usa o serviço de
 * Facturação Electrónica (JWS RS256, registarFactura/obterEstado). Cada empresa
 * comunica os SEUS documentos sob o seu NIF; nunca bloqueia a venda.
 */
@Injectable()
export class AgtCommunicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
    private readonly einvoice: EinvoiceService,
  ) {}

  private async companyId(schema: string): Promise<string> {
    const c = await this.prisma.company.findUnique({ where: { schemaName: schema }, select: { id: true } });
    if (!c) throw new BadRequestException('Empresa não encontrada.');
    return c.id;
  }

  async status(schema: string): Promise<AgtCommStatus> {
    const id = await this.companyId(schema);
    const s = await this.einvoice.companyStatus(id);
    const d = s.documents;
    return {
      enabled: s.enabled,
      configured: s.hasTaxpayerKey && Object.keys(s.series).length > 0,
      pending: (d.QUEUED ?? 0) + (d.SENT ?? 0) + (d.ERROR ?? 0),
      communicated: d.VALID ?? 0,
      rejected: d.INVALID ?? 0,
    };
  }

  async communicate(schema: string, actor: { id?: string | null; name?: string | null }): Promise<AgtCommResult> {
    const id = await this.companyId(schema);
    const s = await this.einvoice.companyStatus(id);
    if (!s.enabled) {
      throw new BadRequestException('A Facturação Electrónica não está activa nesta empresa. Contacte o Super Admin.');
    }
    const r = await this.einvoice.syncNow(id);
    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'AGT_COMMUNICATED',
      entity: 'invoice_batch', details: r as unknown as Record<string, unknown>,
    });
    const docs = await this.einvoice.listDocuments(id);
    const errors = docs
      .filter((x) => x.status === 'INVALID' || x.status === 'ERROR')
      .slice(0, 10)
      .map((x) => `${x.documentNo}: ${JSON.stringify(x.errors ?? '').slice(0, 160)}`);
    return { sent: r.submitted.sent, failed: r.submitted.invalid + r.submitted.deferred, errors };
  }
}
