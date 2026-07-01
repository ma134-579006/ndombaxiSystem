import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { AgtConfigService } from './agt-config.service';

export interface AgtCommStatus {
  enabled: boolean;
  configured: boolean;
  pending: number;
  communicated: number;
}

export interface AgtCommResult {
  sent: number;
  failed: number;
  errors: string[];
}

interface PendingInvoice {
  id: string;
  number: string;
  hash: string;
  net_total: string;
  iva_total: string;
  gross_total: string;
  invoice_date: Date;
  customer_tax_id: string | null;
}

/**
 * Comunicação eletrónica com a AGT (DP 71/25): a PLATAFORMA detém o contrato
 * (endpoint + credencial, configurados pelo Super Admin em AgtConfigService);
 * cada TENANT comunica só os SEUS próprios documentos, sob o seu NIF. Nunca
 * bloqueia a emissão/venda — é uma acção separada, best-effort e auditada.
 */
@Injectable()
export class AgtCommunicationService {
  private readonly logger = new Logger(AgtCommunicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agtConfig: AgtConfigService,
    private readonly audit: TenantAuditService,
  ) {}

  /** Resumo do estado de comunicação do tenant (para o painel do gestor). */
  async status(schema: string): Promise<AgtCommStatus> {
    const creds = await this.agtConfig.getCommunicationCreds();
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ pending: number; communicated: number }[]>(
        Prisma.sql`SELECT
            COUNT(*) FILTER (WHERE communicated_at IS NULL)::int AS pending,
            COUNT(*) FILTER (WHERE communicated_at IS NOT NULL)::int AS communicated
          FROM invoices WHERE status = 'N'`,
      ),
    );
    return {
      enabled: creds.enabled,
      configured: !!creds.endpointUrl,
      pending: rows[0]?.pending ?? 0,
      communicated: rows[0]?.communicated ?? 0,
    };
  }

  /**
   * Submete os documentos pendentes (até 100 de cada vez) ao endpoint da AGT
   * configurado pelo Super Admin. Cada um é tentado individualmente — uma
   * falha não bloqueia as restantes. Nunca deixa a operação de negócio (venda)
   * dependente disto: é sempre uma acção explícita e separada do gestor.
   */
  async communicate(schema: string, actor: { id?: string | null; name?: string | null }): Promise<AgtCommResult> {
    const creds = await this.agtConfig.getCommunicationCreds();
    if (!creds.enabled) {
      throw new BadRequestException('A comunicação eletrónica à AGT não está activa. Contacte o Super Admin.');
    }
    if (!creds.endpointUrl) {
      throw new BadRequestException('Falta configurar o endpoint da AGT (contrato gerido pelo Super Admin).');
    }

    const pending = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<PendingInvoice[]>(
        Prisma.sql`SELECT id, number, hash, net_total, iva_total, gross_total, invoice_date, customer_tax_id
                   FROM invoices WHERE status = 'N' AND communicated_at IS NULL
                   ORDER BY invoice_date ASC LIMIT 100`,
      ),
    );

    let sent = 0;
    const errors: string[] = [];
    for (const inv of pending) {
      try {
        const res = await fetch(creds.endpointUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(creds.apiKey ? { Authorization: `Bearer ${creds.apiKey}` } : {}),
          },
          body: JSON.stringify({
            number: inv.number,
            hash: inv.hash,
            netTotal: Number(inv.net_total),
            ivaTotal: Number(inv.iva_total),
            grossTotal: Number(inv.gross_total),
            invoiceDate: inv.invoice_date,
            customerTaxId: inv.customer_tax_id,
          }),
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        await this.prisma.runInTenant(schema, (tx) =>
          tx.$executeRaw(Prisma.sql`UPDATE invoices SET communicated_at = now() WHERE id = ${inv.id}::uuid`),
        );
        sent += 1;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'erro desconhecido';
        errors.push(`${inv.number}: ${msg}`);
        this.logger.warn(`Falha ao comunicar ${inv.number} à AGT: ${msg}`);
      }
    }

    await this.audit.record(schema, {
      actorId: actor.id, actorName: actor.name, action: 'AGT_COMMUNICATED',
      entity: 'invoice_batch', details: { attempted: pending.length, sent, failed: errors.length },
    });

    return { sent, failed: errors.length, errors: errors.slice(0, 10) };
  }
}
