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
import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EmitInvoiceDto } from '../pos/dto/emit-invoice.dto';
import { Prisma } from '@prisma/client';
import { DocumentType } from '@nexus/agt-xml';
import type { JwtPayload } from '@nexus/types';
import { PrismaService } from '../prisma/prisma.service';
import { CashboxService } from '../cashbox/cashbox.service';
import { InvoiceService } from '../pos/invoice.service';
import { PosRepository } from '../pos/pos.repository';
import { DiscountGuardService } from '../pos/discount-guard.service';
import { DevicesService } from '../devices/devices.service';
import { localSeries } from '../common/device-series';
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
  // O Postgres pode citar só a coluna ("Key (client_op_id)=… already exists") e não o índice.
  const byColumn = !!indexHint && indexHint.endsWith('client_op_uidx') && msg.includes('(client_op_id)');
  return isUnique && (!indexHint || msg.includes(indexHint) || byColumn);
}

/**
 * Recusa DEFINITIVA (de negócio ou de dados) vs. falha MOMENTÂNEA.
 *
 * Só as primeiras podem ir para o livro como `rejected`: o posto bloqueia a
 * operação e o livro devolve a mesma recusa para sempre. Uma falha momentânea
 * (ligação à base caiu, deadlock, pool esgotado, timeout) gravada como recusa
 * fazia o posto DESCARTAR uma venda ou um fecho de turno válidos.
 *   • definitiva: HttpException 4xx (stock, turno, validação) ou erro de dados do
 *     Postgres (SQLSTATE classe 22 — valor inválido; 23 — restrição violada);
 *   • tudo o resto é momentâneo → sem resultado para essa operação, e o motor do
 *     posto repõe-na na fila com espera crescente (reenviar é idempotente).
 */
export function isPermanentRejection(e: unknown): boolean {
  if (e instanceof HttpException) return e.getStatus() < 500;
  const err = e as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const candidates = [err?.meta?.code, err?.code].filter((c): c is string => typeof c === 'string');
  const msg = typeof err?.message === 'string' ? err.message : '';
  const fromMsg = msg.match(/(2[23][0-9A-Z]{3})/);
  if (fromMsg) candidates.push(fromMsg[1]);
  return candidates.some((c) => /^2[23][0-9A-Z]{3}$/.test(c));
}

/**
 * Valida o payload de uma venda vinda da fila com o MESMO DTO do POST
 * /pos/invoices. Inválido → recusa definitiva (400), nunca emissão parcial.
 */
export function sanitizeSalePayload(payload: Record<string, unknown>): EmitInvoiceDto & Record<string, unknown> {
  const dto = plainToInstance(EmitInvoiceDto, payload ?? {});
  const errors = validateSync(dto, { whitelist: true, forbidUnknownValues: false });
  if (errors.length) {
    const msg = errors.flatMap((e) => [
      ...Object.values(e.constraints ?? {}),
      ...(e.children ?? []).flatMap((c) => (c.children ?? []).flatMap((cc) => Object.values(cc.constraints ?? {}))),
    ]).slice(0, 3).join('; ');
    throw new BadRequestException(`Venda inválida: ${msg || 'dados recusados'}`);
  }
  return dto as EmitInvoiceDto & Record<string, unknown>;
}

/** Falha momentânea durante uma operação: não se grava nada, o posto volta a tentar. */
class TransientPushError extends Error {}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
    private readonly pos: PosRepository,
    private readonly cashbox: CashboxService,
    private readonly discounts: DiscountGuardService,
    private readonly devices: DevicesService,
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
        // posto BLOQUEAR (ou descartar) trabalho válido. Sem resultado para esta
        // operação, o posto repõe-na na fila e volta a tentar mais tarde.
        const cause = e instanceof TransientPushError ? (e.cause as Error) : (e as Error);
        this.logger.error(`push ${op.entity}/${op.opId} falhou (fica para nova tentativa): ${cause?.message ?? e}`);
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
      case 'sale':         return this.applySale(schema, op, user);
      case 'customer':     return this.applyCustomer(schema, op, user);
      case 'cashSession':  return this.applyCashSession(schema, op, user);
      case 'cashMovement': return this.applyCashMovement(schema, op, user);
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
    try {
      // O payload chega como objeto livre (IsObject): sem isto, uma venda pela fila
      // podia trazer `unitPrice` à escolha numa linha de produto, quantidades
      // negativas (total negativo e stock a SUBIR) ou linhas livres de valor
      // arbitrário — tudo o que o POST /pos/invoices recusa. Passa pela MESMA
      // validação (whitelist: campos desconhecidos são descartados).
      const p = sanitizeSalePayload(op.payload);
      const lines = p.lines;
      // As MESMAS regras do POST /pos/invoices (ver pos.controller.ts):
      //  • desconto acima da promoção fica auditado (offline → "não verificado");
      //  • pelo caixa só se VENDE (FT/FS) — uma "NC" vinda da fila baixava stock e
      //    contava como venda no turno;
      //  • a SÉRIE é a do posto registado, não a que o pedido escolher (duas caixas
      //    na mesma série sem rede = duas cadeias de hash divergentes).
      if (Array.isArray(lines)) {
        await this.discounts.check(schema, user, lines, {
          approvalPin: typeof p.approvalPin === 'string' ? p.approvalPin : null, offline: true,
        });
      }
      const deviceSeries = await this.devices.seriesFor(schema, typeof p.deviceKey === 'string' ? p.deviceKey : null);
      const invoice = await this.invoices.emit(schema, {
        docType: p.docType === DocumentType.FS ? DocumentType.FS : DocumentType.FT,
        series: deviceSeries ?? localSeries() ?? (typeof p.series === 'string' && /^[A-Z0-9]{1,5}$/.test(p.series) ? p.series : 'A'),
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
        // Venda que vem da fila do posto JÁ ACONTECEU sem rede: regista-se mesmo com stock
        // desatualizado (como no POST /pos/invoices com offline:true), em vez de ficar presa.
        offline: true,
        payments: (p.payments as never) ?? null,
        lines: p.lines,
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
      if (!isPermanentRejection(e)) throw new TransientPushError('falha momentânea', { cause: e });
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

  // ── Turnos de caixa ────────────────────────────────────────

  /**
   * Abertura (`create`) e fecho (`update`) do turno feitos sem rede.
   *
   * A ORDEM é o que torna isto correto, e vem de graça: o `push()` ordena por
   * `seq`, a sequência que o posto atribuiu. Assim a ABERTURA entra antes das
   * vendas do turno e o FECHO entra depois — que é exatamente o que o dinheiro
   * na gaveta exige. Se as vendas entrassem sem o turno aberto, o
   * `InvoiceService` emitia na mesma (o movimento de caixa é best-effort) mas o
   * dinheiro não era registado no turno, e o fecho nunca batia certo.
   *
   * Não recalculamos nada do fecho aqui: quem fecha é o `CashboxService`, com a
   * mesma agregação do fecho online. O servidor é a autoridade do valor
   * esperado; o posto só declara o que CONTOU.
   */
  private async applyCashSession(schema: string, op: PushOpDto, user: JwtPayload): Promise<PushResultDto> {
    const p = op.payload;
    const actor = { id: user.sub, name: user.name ?? user.email };

    if (op.op === 'create') {
      try {
        const { id } = await this.cashbox.open(
          schema,
          {
            openingFloat: Number(p.openingFloat ?? 0),
            registerCode: (p.registerCode as string) ?? undefined,
            storeId: (p.storeId as string) ?? user.storeId ?? undefined,
          },
          actor,
          op.opId, // ← unicidade imposta pelo Postgres
        );
        const result = this.sessionResult(op, id);
        await this.recordLedger(schema, op, user, 'applied', id, result);
        return result;
      } catch (e) {
        // Já existe: é a idempotência a funcionar, não um erro. Devolvemos o
        // turno original para o posto poder continuar a referenciá-lo.
        if (isUniqueViolation(e, 'cash_sessions_client_op_uidx')) {
          const existing = await this.findByClientOp(schema, 'cash_sessions', op.opId);
          if (existing) return { ...this.sessionResult(op, String(existing.id)), status: 'duplicate' };
        }
        // Recusa de negócio (ex.: já tem um turno aberto no servidor). Fica
        // registada para não repetir em ciclo e o posto mostra o motivo.
        if (!isPermanentRejection(e)) throw new TransientPushError('falha momentânea', { cause: e });
        const result: PushResultDto = {
          opId: op.opId, status: 'rejected',
          message: (e as Error).message, code: 'SHIFT_REJECTED',
        };
        await this.recordLedger(schema, op, user, 'rejected', null, result);
        return result;
      }
    }

    if (op.op === 'update') {
      try {
        const summary = await this.cashbox.close(
          schema,
          { countedCash: Number(p.countedCash ?? 0), notes: (p.notes as string) ?? undefined },
          actor,
        );
        const result: PushResultDto = {
          opId: op.opId,
          status: 'applied',
          serverId: op.localId,
          entity: {
            entity: 'cashSession', id: op.localId,
            data: summary as unknown as Record<string, unknown>,
            version: Date.now(), updatedAt: new Date().toISOString(), deleted: false,
          },
        };
        await this.recordLedger(schema, op, user, 'applied', op.localId, result);
        return result;
      } catch (e) {
        if (!isPermanentRejection(e)) throw new TransientPushError('falha momentânea', { cause: e });
        const result: PushResultDto = {
          opId: op.opId, status: 'rejected',
          message: (e as Error).message, code: 'SHIFT_CLOSE_REJECTED',
        };
        await this.recordLedger(schema, op, user, 'rejected', null, result);
        return result;
      }
    }

    return {
      opId: op.opId, status: 'rejected',
      message: 'Um turno de caixa não pode ser eliminado.',
      code: 'OP_NOT_ALLOWED',
    };
  }

  /** Reforço (CASH_IN) e sangria (CASH_OUT) feitos sem rede. */
  private async applyCashMovement(schema: string, op: PushOpDto, user: JwtPayload): Promise<PushResultDto> {
    const p = op.payload;
    if (op.op !== 'create') {
      return {
        opId: op.opId, status: 'rejected',
        message: 'Um movimento de caixa não pode ser alterado nem eliminado — corrige-se com outro movimento.',
        code: 'OP_NOT_ALLOWED',
      };
    }
    try {
      const { id } = await this.cashbox.addMovement(
        schema,
        {
          type: p.type === 'CASH_OUT' ? 'CASH_OUT' : 'CASH_IN',
          amount: Number(p.amount ?? 0),
          reference: (p.reference as string) ?? undefined,
        },
        { id: user.sub, name: user.name ?? user.email },
        op.opId,
      );
      const result: PushResultDto = {
        opId: op.opId, status: 'applied', serverId: id,
        entity: {
          entity: 'cashMovement', id, data: { id, ...p },
          version: Date.now(), updatedAt: new Date().toISOString(), deleted: false,
        },
      };
      await this.recordLedger(schema, op, user, 'applied', id, result);
      return result;
    } catch (e) {
      if (isUniqueViolation(e, 'cash_movements_client_op_uidx')) {
        const existing = await this.findByClientOp(schema, 'cash_movements', op.opId);
        if (existing) {
          return {
            opId: op.opId, status: 'duplicate', serverId: String(existing.id),
            entity: {
              entity: 'cashMovement', id: String(existing.id), data: existing,
              version: Date.now(), updatedAt: new Date().toISOString(), deleted: false,
            },
          };
        }
      }
      if (!isPermanentRejection(e)) throw new TransientPushError('falha momentânea', { cause: e });
      const result: PushResultDto = {
        opId: op.opId, status: 'rejected',
        message: (e as Error).message, code: 'CASH_MOVEMENT_REJECTED',
      };
      await this.recordLedger(schema, op, user, 'rejected', null, result);
      return result;
    }
  }

  private sessionResult(op: PushOpDto, id: string): PushResultDto {
    return {
      opId: op.opId,
      status: 'applied',
      serverId: id,
      entity: {
        entity: 'cashSession', id,
        data: { id, ...op.payload },
        version: Date.now(), updatedAt: new Date().toISOString(), deleted: false,
      },
    };
  }

  /**
   * Procura a linha que uma operação já criou. O nome da tabela NUNCA vem do
   * pedido — é escolhido aqui, num conjunto fechado, para não haver superfície
   * de injeção no identificador (que não é parametrizável em SQL).
   */
  private findByClientOp(
    schema: string,
    table: 'cash_sessions' | 'cash_movements',
    opId: string,
  ): Promise<Record<string, unknown> | null> {
    const sql = table === 'cash_sessions'
      ? Prisma.sql`SELECT * FROM cash_sessions WHERE client_op_id = ${opId}::uuid`
      : Prisma.sql`SELECT * FROM cash_movements WHERE client_op_id = ${opId}::uuid`;
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<Record<string, unknown>[]>(sql);
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
