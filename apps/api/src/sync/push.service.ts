/**
 * Subida de mutações (push) — o lado servidor da promessa "exatamente uma vez".
 *
 * A idempotência é feita em duas camadas, e a ordem importa:
 *
 *   1.ª camada — BASE DE DADOS. As vendas gravam o `client_op_id` num índice
 *      ÚNICO. Se a mesma venda chegar duas vezes, é o Postgres que recusa a
 *      segunda. Isto vence mesmo quando dois pedidos entram no mesmo instante,
 *      coisa que uma verificação em código perderia.
 *
 *   2.ª camada — LIVRO DE OPERAÇÕES (`sync_operations`). Guarda o resultado de
 *      cada `op_id` para que um reenvio receba a MESMA resposta que a primeira
 *      vez — o posto fica com o número fiscal certo em vez de um erro.
 *
 * Regra que atravessa tudo: nunca reimplementamos aqui a lógica de negócio. A
 * emissão fiscal continua a ser do `InvoiceService`, com a mesma numeração sem
 * saltos, o mesmo encadeamento de hash e a mesma baixa de stock. Este módulo é
 * uma porta de entrada, não uma segunda versão do sistema.
 */
import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType } from '@nexus/agt-xml';
import type { JwtPayload } from '@nexus/types';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../pos/invoice.service';
import { PosRepository } from '../pos/pos.repository';
import type { PullChangeDto } from './sync.service';

export interface PushOpDto {
  opId: string;
  seq: number;
  entity: string;
  op: 'create' | 'update' | 'delete';
  localId: string;
  payload: Record<string, unknown>;
  baseVersion?: number | null;
  createdAt: string;
}

export interface PushResultDto {
  opId: string;
  status: 'applied' | 'duplicate' | 'rejected' | 'conflict';
  serverId?: string;
  entity?: PullChangeDto;
  message?: string;
  code?: string;
}

interface LedgerRow {
  op_id: string;
  status: string;
  server_id: string | null;
  result: unknown;
}

/** Violação de restrição única do Postgres. */
function isUniqueViolation(e: unknown, indexHint?: string): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  const isUnique = msg.includes('23505') || /duplicate key value/i.test(msg);
  return isUnique && (!indexHint || msg.includes(indexHint));
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
    private readonly pos: PosRepository,
  ) {}

  /**
   * Aplica um lote. Cada operação é independente: uma que falhe NUNCA impede as
   * seguintes de entrar. Uma venda recusada por falta de stock não pode segurar
   * as outras onze do turno.
   */
  async push(schema: string, ops: PushOpDto[], user: JwtPayload): Promise<PushResultDto[]> {
    const results: PushResultDto[] = [];
    // Ordem de criação no posto — preserva a causalidade (cliente antes da venda
    // que o referencia).
    for (const op of [...ops].sort((a, b) => a.seq - b.seq)) {
      try {
        results.push(await this.applyOne(schema, op, user));
      } catch (e) {
        // Uma falha inesperada não pode ser lida como "recusada" — isso faria o
        // posto descartar trabalho válido. Devolvemos algo que o motor repete.
        this.logger.error(`push ${op.entity}/${op.opId} falhou: ${(e as Error).message}`);
        results.push({
          opId: op.opId,
          status: 'rejected',
          message: (e as Error).message,
          code: 'SERVER_ERROR',
        });
      }
    }
    return results;
  }

  private async applyOne(schema: string, op: PushOpDto, user: JwtPayload): Promise<PushResultDto> {
    // 2.ª camada: já sabemos a resposta desta operação?
    const known = await this.lookupLedger(schema, op.opId);
    if (known) {
      return {
        ...(known.result as PushResultDto),
        opId: op.opId,
        status: known.status === 'rejected' ? 'rejected' : 'duplicate',
      };
    }

    switch (op.entity) {
      case 'sale':      return this.applySale(schema, op, user);
      case 'customer':  return this.applyCustomer(schema, op, user);
      default:
        return {
          opId: op.opId,
          status: 'rejected',
          message: `A entidade "${op.entity}" ainda não é aceite pela sincronização.`,
          code: 'ENTITY_NOT_SUPPORTED',
        };
    }
  }

  // ── Vendas ─────────────────────────────────────────────────

  private async applySale(schema: string, op: PushOpDto, user: JwtPayload): Promise<PushResultDto> {
    const p = op.payload;
    try {
      const invoice = await this.invoices.emit(schema, {
        docType: (p.docType as DocumentType) ?? DocumentType.FT,
        series: (p.series as string) ?? 'A',
        customerId: (p.customerId as string) ?? null,
        cashierId: user.sub,
        cashierName: user.name ?? user.email,
        storeId: user.storeId ?? null,
        paymentType: (p.paymentType as 'CASH') ?? 'CASH',
        tendered: (p.tendered as number) ?? null,
        changeGiven: (p.changeGiven as number) ?? null,
        dueDate: (p.dueDate as string) ?? null,
        // A data fiscal é a de HOJE (lei), mas registamos a data REAL em que o
        // cliente comprou. Uma venda feita na sexta e sincronizada na segunda
        // não passa a ser uma venda de segunda nos relatórios de operação.
        operationDate: (p.operationDate as string) ?? op.createdAt.slice(0, 10),
        clientOpId: op.opId, // ← 1.ª camada: unicidade imposta pelo Postgres
        lines: p.lines as never,
      });

      const result: PushResultDto = {
        opId: op.opId,
        status: 'applied',
        serverId: invoice.id,
        entity: {
          entity: 'sale',
          id: invoice.id,
          data: invoice as unknown as Record<string, unknown>,
          version: Date.now(),
          updatedAt: new Date().toISOString(),
          deleted: false,
        },
      };
      await this.recordLedger(schema, op, user, 'applied', invoice.id, result);
      return result;
    } catch (e) {
      // O índice único disparou: esta venda JÁ ESTÁ emitida. Não é um erro — é a
      // idempotência a funcionar. Devolvemos a fatura original para o posto
      // ficar com o número fiscal verdadeiro e poder imprimir o recibo.
      if (isUniqueViolation(e, 'invoices_client_op_uidx')) {
        const existing = await this.findInvoiceByOp(schema, op.opId);
        if (existing) {
          return {
            opId: op.opId,
            status: 'duplicate',
            serverId: String(existing.id),
            entity: {
              entity: 'sale', id: String(existing.id),
              data: existing as unknown as Record<string, unknown>,
              version: Date.now(),
              updatedAt: new Date().toISOString(), deleted: false,
            },
          };
        }
      }
      // Recusa de negócio (stock, série fechada, turno fechado): fica registada
      // para não voltar a ser tentada em ciclo, e o posto mostra o motivo.
      const message = (e as Error).message;
      const result: PushResultDto = {
        opId: op.opId, status: 'rejected', message, code: 'SALE_REJECTED',
      };
      await this.recordLedger(schema, op, user, 'rejected', null, result);
      return result;
    }
  }

  private findInvoiceByOp(schema: string, opId: string): Promise<Record<string, unknown> | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(
        Prisma.sql`SELECT id, number, doc_type, series, invoice_date, net_total,
                          iva_total, gross_total, hash
                     FROM invoices WHERE client_op_id = ${opId}::uuid`,
      );
      return rows[0] ?? null;
    });
  }

  // ── Clientes ───────────────────────────────────────────────

  private async applyCustomer(schema: string, op: PushOpDto, user: JwtPayload): Promise<PushResultDto> {
    const p = op.payload;

    if (op.op === 'create') {
      const row = await this.pos.createCustomer(schema, {
        name: String(p.name ?? '').trim(),
        taxId: (p.tax_id as string) ?? (p.taxId as string) ?? null,
        email: (p.email as string) ?? null,
        phone: (p.phone as string) ?? null,
        address: (p.address as string) ?? null,
      });
      const result = this.customerResult(op, row);
      await this.recordLedger(schema, op, user, 'applied', String(row.id), result);
      return result;
    }

    if (op.op === 'update') {
      // Deteção de conflito: se a ficha mudou no servidor DEPOIS da versão em
      // que o posto se baseou, não sobrepomos — devolvemos o estado atual e é o
      // motor no cliente que aplica a política da entidade (união de campos).
      const current = await this.getCustomer(schema, op.localId);
      if (!current) {
        return { opId: op.opId, status: 'rejected', message: 'Cliente não encontrado.', code: 'NOT_FOUND' };
      }
      const serverVersion = new Date(current.updated_at as string).getTime();
      if (op.baseVersion != null && serverVersion > op.baseVersion) {
        return {
          opId: op.opId,
          status: 'conflict',
          entity: {
            entity: 'customer', id: op.localId, data: current,
            version: serverVersion,
            updatedAt: new Date(current.updated_at as string).toISOString(),
            deleted: current.is_active === false,
          },
        };
      }

      const row = await this.pos.updateCustomer(schema, op.localId, {
        ...(p.name !== undefined ? { name: String(p.name) } : {}),
        ...(p.phone !== undefined ? { phone: (p.phone as string) ?? null } : {}),
        ...(p.email !== undefined ? { email: (p.email as string) ?? null } : {}),
        ...(p.address !== undefined ? { address: (p.address as string) ?? null } : {}),
        ...(p.taxId !== undefined ? { taxId: (p.taxId as string) ?? null } : {}),
      });
      const result = this.customerResult(op, row);
      await this.recordLedger(schema, op, user, 'applied', String(row.id), result);
      return result;
    }

    return {
      opId: op.opId, status: 'rejected',
      message: 'Eliminar clientes tem de ser feito no painel de gestão.',
      code: 'OP_NOT_ALLOWED',
    };
  }

  private customerResult(op: PushOpDto, row: object): PushResultDto {
    const r = row as Record<string, unknown>;
    const updatedAt = r.updated_at ? new Date(r.updated_at as string) : new Date();
    return {
      opId: op.opId,
      status: 'applied',
      serverId: String(r.id),
      entity: {
        entity: 'customer',
        id: String(r.id),
        data: r,
        version: updatedAt.getTime(),
        updatedAt: updatedAt.toISOString(),
        deleted: false,
      },
    };
  }

  private getCustomer(schema: string, id: string): Promise<Record<string, unknown> | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(
        Prisma.sql`SELECT * FROM customers WHERE id = ${id}::uuid`,
      );
      return rows[0] ?? null;
    });
  }

  // ── Livro de operações ─────────────────────────────────────

  private lookupLedger(schema: string, opId: string): Promise<LedgerRow | null> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<LedgerRow[]>(
        Prisma.sql`SELECT op_id, status, server_id, result
                     FROM sync_operations WHERE op_id = ${opId}::uuid`,
      );
      return rows[0] ?? null;
    });
  }

  private async recordLedger(
    schema: string,
    op: PushOpDto,
    user: JwtPayload,
    status: 'applied' | 'rejected',
    serverId: string | null,
    result: PushResultDto,
  ): Promise<void> {
    try {
      await this.prisma.runInTenant(schema, (tx) =>
        tx.$executeRaw(
          Prisma.sql`INSERT INTO sync_operations
              (op_id, entity, op, local_id, server_id, status, result, user_id, client_at)
            VALUES (${op.opId}::uuid, ${op.entity}, ${op.op}, ${op.localId},
                    ${serverId}, ${status}, ${JSON.stringify(result)}::jsonb,
                    ${user.sub}::uuid, ${op.createdAt}::timestamptz)
            ON CONFLICT (op_id) DO NOTHING`,
        ),
      );
    } catch (e) {
      // O livro é a 2.ª camada de defesa; a 1.ª (índice único) continua de pé.
      // Falhar a escrever aqui não pode desfazer uma venda já emitida.
      this.logger.warn(`livro de operações não gravado (${op.opId}): ${(e as Error).message}`);
    }
  }
}
