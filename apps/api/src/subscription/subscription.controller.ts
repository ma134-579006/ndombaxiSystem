import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { SubscriptionService } from './subscription.service';
import {
  CreateSubscriptionDto,
  PostSubMessageDto,
  ReviewSubscriptionDto,
  SubmitProofDto,
  UpsertBankAccountDto,
} from './dto/subscription.dto';

/** Lado da EMPRESA (gestor autenticado) — subscrever, pagar, conversar. */
@ApiTags('subscription')
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subs: SubscriptionService) {}

  private companyId(user: JwtPayload): string {
    if (!user.tenantId) throw new BadRequestException('Apenas empresas podem subscrever.');
    return user.tenantId;
  }

  /** Contas bancárias activas (para o cliente escolher ao pagar por IBAN). */
  @Public()
  @Get('bank-accounts')
  @ApiOperation({ summary: 'Contas bancárias activas da plataforma (público)' })
  banks() {
    return this.subs.listBankAccounts(true);
  }

  /** Estado resumido (percentagem do período gasto e dias restantes) para a
   *  barra de topo de TODOS os módulos — qualquer utilizador da empresa. */
  @Get('status')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Estado resumido da subscrição activa (só leitura)' })
  async status(@CurrentUser() user: JwtPayload) {
    const subs = (await this.subs.list({ companyId: this.companyId(user) })) as Array<{
      status: string; expiresAt?: string | Date | null; startsAt?: string | Date | null; durationDays?: number | null; durationMonths?: number | null;
    }>;
    const act = subs.filter((s) => s.status === 'ACTIVE' && s.expiresAt)
      .sort((a, b) => new Date(b.expiresAt as string).getTime() - new Date(a.expiresAt as string).getTime())[0];
    if (!act?.expiresAt) return { active: false, pct: 100, daysLeft: 0, expiresAt: null };
    const end = new Date(act.expiresAt).getTime();
    const start = act.startsAt ? new Date(act.startsAt).getTime() : end - (act.durationDays ?? (act.durationMonths ?? 1) * 30) * 864e5;
    const now = Date.now();
    const pct = end > start ? Math.min(100, Math.max(0, Math.round(((now - start) / (end - start)) * 100))) : 100;
    return { active: true, pct, daysLeft: Math.max(0, Math.ceil((end - now) / 864e5)), expiresAt: new Date(end).toISOString() };
  }

  @Get('mine')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Subscrições da minha empresa' })
  mine(@CurrentUser() user: JwtPayload) {
    return this.subs.list({ companyId: this.companyId(user) });
  }

  @Post()
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Criar subscrição (escolher plano + método)' })
  create(@Body() dto: CreateSubscriptionDto, @CurrentUser() user: JwtPayload) {
    return this.subs.create(this.companyId(user), dto);
  }

  @Post(':id/proof')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Submeter comprovativo de pagamento (IBAN)' })
  proof(@Param('id') id: string, @Body() dto: SubmitProofDto, @CurrentUser() user: JwtPayload) {
    return this.subs.submitProof(this.companyId(user), id, dto);
  }

  @Get(':id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Detalhe de uma subscrição' })
  get(@Param('id') id: string) {
    return this.subs.get(id);
  }

  @Get(':id/messages')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Mensagens do chat da subscrição' })
  messages(@Param('id') id: string) {
    return this.subs.listMessages(id);
  }

  @Post(':id/messages')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Enviar mensagem ao Super Admin sobre o pagamento' })
  send(@Param('id') id: string, @Body() dto: PostSubMessageDto) {
    return this.subs.postMessage(id, 'COMPANY', dto);
  }
}

/** Lado do SUPER ADMIN — bancos, aprovar pagamentos, conversar. */
@ApiTags('super-admin')
@Controller('super-admin/subscriptions')
@Roles(Role.SUPER_ADMIN)
export class SubscriptionAdminController {
  constructor(private readonly subs: SubscriptionService) {}

  @Get()
  @ApiOperation({ summary: 'Todas as subscrições (filtro opcional por estado)' })
  list(@Query('status') status?: string) {
    return this.subs.list({ status });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma subscrição (com comprovativos e chat)' })
  get(@Param('id') id: string) {
    return this.subs.get(id);
  }

  @Patch(':id/review')
  @ApiOperation({ summary: 'Aprovar/rejeitar o comprovativo (aprovar activa a subscrição)' })
  review(@Param('id') id: string, @Body() dto: ReviewSubscriptionDto, @CurrentUser() user: JwtPayload) {
    return this.subs.review(id, user?.sub, dto);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Responder à empresa no chat' })
  send(@Param('id') id: string, @Body() dto: PostSubMessageDto, @CurrentUser() user: JwtPayload) {
    return this.subs.postMessage(id, 'ADMIN', { ...dto, senderName: dto.senderName ?? user?.email });
  }

  // ── Contas bancárias (Super Admin é deus) ──────────────────
  @Get('banks/all')
  @ApiOperation({ summary: 'Todas as contas bancárias da plataforma' })
  banks() {
    return this.subs.listBankAccounts(false);
  }

  @Post('banks')
  @ApiOperation({ summary: 'Adicionar conta bancária (banco angolano + IBAN)' })
  createBank(@Body() dto: UpsertBankAccountDto) {
    return this.subs.createBankAccount(dto);
  }

  @Patch('banks/:id')
  @ApiOperation({ summary: 'Editar conta bancária' })
  updateBank(@Param('id') id: string, @Body() dto: UpsertBankAccountDto) {
    return this.subs.updateBankAccount(id, dto);
  }
}
