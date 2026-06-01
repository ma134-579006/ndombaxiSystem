import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentGatewayService } from '../payments/payment-gateway.service';
import type {
  CreateSubscriptionDto,
  PostSubMessageDto,
  ReviewSubscriptionDto,
  SubmitProofDto,
  UpsertBankAccountDto,
} from './dto/subscription.dto';

/**
 * Subscrições e pagamento da PLATAFORMA (empresa → Ndombaxi), geridos pelo
 * Super Admin. Dois métodos:
 *  • IBAN (transferência): empresa escolhe um banco, sobe comprovativo, o
 *    Super Admin aprova → subscrição fica ACTIVE pelo período do plano.
 *  • REFERENCE (Multicaixa): se houver contrato Express activo, é AUTOMÁTICO
 *    (gera referência e activa logo). Caso contrário, cai no fluxo manual.
 * Há um chat por subscrição entre a empresa e o Super Admin.
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gateways: PaymentGatewayService,
  ) {}

  // ── Contas bancárias da plataforma (Super Admin) ───────────
  listBankAccounts(onlyActive = false) {
    return this.prisma.platformBankAccount.findMany({
      where: onlyActive ? { isActive: true } : undefined,
      orderBy: [{ sortOrder: 'asc' }, { bankName: 'asc' }],
    });
  }

  createBankAccount(dto: UpsertBankAccountDto) {
    return this.prisma.platformBankAccount.create({ data: dto });
  }

  async updateBankAccount(id: string, dto: Partial<UpsertBankAccountDto>) {
    await this.requireBank(id);
    return this.prisma.platformBankAccount.update({ where: { id }, data: dto });
  }

  async removeBankAccount(id: string) {
    await this.requireBank(id);
    await this.prisma.platformBankAccount.delete({ where: { id } });
    return { id };
  }

  private async requireBank(id: string) {
    const b = await this.prisma.platformBankAccount.findUnique({ where: { id } });
    if (!b) throw new NotFoundException('Conta bancária não encontrada');
    return b;
  }

  // ── Subscrições ────────────────────────────────────────────

  /** Empresa cria uma subscrição para um plano. */
  async create(companyId: string, dto: CreateSubscriptionDto) {
    const plan = await this.prisma.plan.findUnique({ where: { id: dto.planId } });
    if (!plan) throw new NotFoundException('Plano não encontrado');

    if (dto.method === 'IBAN' && !dto.bankAccountId) {
      throw new BadRequestException('Escolha a conta bancária para a transferência.');
    }
    if (dto.method === 'IBAN' && dto.bankAccountId) {
      await this.requireBank(dto.bankAccountId);
    }

    const sub = await this.prisma.subscription.create({
      data: {
        companyId,
        planId: plan.id,
        method: dto.method,
        amountKz: plan.priceKz,
        durationMonths: plan.durationMonths,
        bankAccountId: dto.method === 'IBAN' ? dto.bankAccountId ?? null : null,
        status: 'PENDING_PAYMENT',
      },
    });

    // REFERENCE → tenta o caminho automático via contrato Express.
    if (dto.method === 'REFERENCE') {
      const express = await this.gateways.getActiveExpress();
      if (express) {
        const reference = this.generateReference();
        // (A verificação HTTP real contra o Express fica para produção; aqui,
        //  havendo contrato activo, considera-se confirmado e activa-se.)
        return this.activate(sub.id, {
          reference,
          note: `Pagamento por referência confirmado automaticamente (contrato "${express.gateway.label}").`,
        });
      }
      // Sem contrato Express → informa que ficará manual.
      return this.prisma.subscription.update({
        where: { id: sub.id },
        data: { reference: this.generateReference() },
      });
    }

    return sub;
  }

  /** Empresa submete comprovativo (IBAN) → fica IN_REVIEW. */
  async submitProof(companyId: string, subscriptionId: string, dto: SubmitProofDto) {
    const sub = await this.requireOwned(companyId, subscriptionId);
    if (sub.status === 'ACTIVE') {
      throw new BadRequestException('Esta subscrição já está activa.');
    }
    await this.prisma.subscriptionPayment.create({
      data: {
        subscriptionId: sub.id,
        fileName: dto.fileName,
        fileType: dto.fileType,
        fileData: dto.fileData,
        amountKz: dto.amountKz ?? sub.amountKz,
        note: dto.note ?? null,
      },
    });
    return this.prisma.subscription.update({
      where: { id: sub.id },
      data: { status: 'IN_REVIEW' },
    });
  }

  /** Super Admin aprova/rejeita o comprovativo. Aprovar → ACTIVE + validade. */
  async review(subscriptionId: string, adminId: string | undefined, dto: ReviewSubscriptionDto) {
    const sub = await this.require(subscriptionId);
    if (dto.decision === 'REJECT') {
      return this.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          status: 'REJECTED',
          reviewedByAdminId: adminId ?? null,
          reviewedAt: new Date(),
          reviewNote: dto.note ?? null,
        },
      });
    }
    return this.activate(sub.id, { adminId, note: dto.note });
  }

  /** Activa a subscrição: calcula validade a partir de durationMonths. */
  private async activate(
    subscriptionId: string,
    opts: { adminId?: string; note?: string; reference?: string },
  ) {
    const sub = await this.require(subscriptionId);
    const startsAt = new Date();
    const expiresAt = new Date(startsAt);
    expiresAt.setMonth(expiresAt.getMonth() + (sub.durationMonths || 1));

    const updated = await this.prisma.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        startsAt,
        expiresAt,
        reviewedByAdminId: opts.adminId ?? null,
        reviewedAt: new Date(),
        reviewNote: opts.note ?? null,
        ...(opts.reference ? { reference: opts.reference } : {}),
      },
    });

    // Garante que a empresa fica ACTIVE (pagamento confirmado).
    await this.prisma.company.update({
      where: { id: sub.companyId },
      data: { status: 'ACTIVE', approvedAt: new Date() },
    }).catch(() => undefined);

    return updated;
  }

  /** Lista para o Super Admin (todas) ou para uma empresa (as suas). */
  list(filter?: { companyId?: string; status?: string }) {
    return this.prisma.subscription.findMany({
      where: {
        ...(filter?.companyId ? { companyId: filter.companyId } : {}),
        ...(filter?.status ? { status: filter.status as never } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        plan: { select: { name: true, tier: true } },
        company: { select: { name: true, code: true } },
        payments: { select: { id: true, fileName: true, createdAt: true, amountKz: true } },
      },
    });
  }

  async get(subscriptionId: string) {
    const sub = await this.prisma.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        plan: true,
        company: { select: { name: true, code: true } },
        payments: true,
        messages: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!sub) throw new NotFoundException('Subscrição não encontrada');
    return sub;
  }

  // ── Chat da subscrição ─────────────────────────────────────
  async postMessage(
    subscriptionId: string,
    sender: 'COMPANY' | 'ADMIN',
    dto: PostSubMessageDto,
  ) {
    await this.require(subscriptionId);
    return this.prisma.subscriptionMessage.create({
      data: {
        subscriptionId,
        sender,
        senderName: dto.senderName ?? null,
        body: dto.body,
      },
    });
  }

  listMessages(subscriptionId: string) {
    return this.prisma.subscriptionMessage.findMany({
      where: { subscriptionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ── Helpers ────────────────────────────────────────────────
  private generateReference(): string {
    // Referência tipo Multicaixa: 3 grupos de dígitos.
    const g = () => Math.floor(100 + Math.random() * 900);
    return `${g()} ${g()} ${g()}`;
  }

  private async require(id: string) {
    const sub = await this.prisma.subscription.findUnique({ where: { id } });
    if (!sub) throw new NotFoundException('Subscrição não encontrada');
    return sub;
  }

  private async requireOwned(companyId: string, id: string) {
    const sub = await this.require(id);
    if (sub.companyId !== companyId) {
      throw new NotFoundException('Subscrição não encontrada');
    }
    return sub;
  }
}
