import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, Param, Post, Put, Query, ServiceUnavailableException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { CustomerProfileDto } from './dto/customer-profile.dto';
import { UploadProofDto } from '../payments/dto/payment.dto';
import { PaymentsService } from '../payments/payments.service';
import { PaymentGatewayService } from '../payments/payment-gateway.service';
import { SiteService } from '../site/site.service';
import { CheckoutDto, CustomerLocationDto, VisualSearchDto } from './dto/checkout.dto';
import { AssistantService } from '../ai/assistant.service';
import { CustomerEmailLoginDto, CustomerGoogleLoginDto, CustomerQuickSignupDto } from './dto/customer-auth.dto';
import { ExpressPayDto } from './dto/express-pay.dto';
import { PostMessageDto } from './dto/order-message.dto';
import { CustomerAuthService } from './customer-auth.service';
import { OrderChatService } from './order-chat.service';
import { CustomerChatService } from './customer-chat.service';
import { OrdersService } from './orders.service';
import { StorefrontService } from './storefront.service';
import { TenantResolverService } from './tenant-resolver.service';
import { HotelService } from '../hotel/hotel.service';
import { ServiceOrdersService } from '../services/service-orders.service';
import { ClinicService } from '../clinic/clinic.service';
import { OnlineAppointmentDto, OnlineReservationDto, OnlineServiceRequestDto } from './dto/online-request.dto';
import { MarketingService } from './marketing.service';
import { MembersService } from './members.service';
import { BannersService } from './banners.service';
import { AffiliatesService } from './affiliates.service';
import { KwanzaService } from './kwanza.service';
import { AdminNotificationsService } from './admin-notifications';
import { IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

class CouponCheckDto {
  @IsString() @MaxLength(32) code!: string;
  @IsNumber() @Min(0) total!: number;
}
class MemberRequestDto {
  @IsOptional() @IsString() @MaxLength(300) note?: string;
}
class WithdrawalDto {
  @IsNumber() @Min(1) amount!: number;
  @IsOptional() @IsString() @MaxLength(40) accountId?: string;
  @IsOptional() @IsString() @MaxLength(40) method?: string;
  @IsOptional() @IsString() @MaxLength(300) details?: string;
}
class PayoutAccountDto {
  @IsString() @MaxLength(40) method!: string;
  @IsOptional() @IsString() @MaxLength(60) bank?: string;
  @IsString() @MaxLength(120) holder!: string;
  @IsString() @MaxLength(60) details!: string;
}
class ReviewDto {
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string;
}

/** Montra pública (sem autenticação). O tenant é resolvido pelo código da empresa. */
@ApiTags('storefront')
@Public()
@Controller('store/:code')
export class StorefrontController {
  constructor(
    private readonly resolver: TenantResolverService,
    private readonly storefront: StorefrontService,
    private readonly orders: OrdersService,
    private readonly site: SiteService,
    private readonly payments: PaymentsService,
    private readonly chat: OrderChatService,
    private readonly customerChat: CustomerChatService,
    private readonly customers: CustomerAuthService,
    private readonly assistant: AssistantService,
    private readonly gateways: PaymentGatewayService,
    private readonly hotel: HotelService,
    private readonly serviceOrders: ServiceOrdersService,
    private readonly clinic: ClinicService,
    private readonly marketing: MarketingService,
    private readonly members: MembersService,
    private readonly banners: BannersService,
    private readonly affiliates: AffiliatesService,
    private readonly kwanza: KwanzaService,
    private readonly adminNotes: AdminNotificationsService,
  ) {}

  // ── Chat livre com a loja (cliente autenticado, sem encomenda) ─
  @Get('chat')
  @ApiOperation({ summary: 'Conversa livre do cliente com a loja (+ equipa online)' })
  async chatThread(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.customerChat.customerThread(tenant.schema, claims.email);
  }

  @Post('chat')
  @ApiOperation({ summary: 'Cliente envia mensagem livre à loja' })
  async chatSend(@Param('code') code: string, @Body() dto: PostMessageDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.customerChat.customerSend(tenant.schema, claims.email, claims.name, dto.body);
  }

  // ── Conta do cliente (login simples / Google) ──────────────
  @Get('auth/methods')
  @ApiOperation({ summary: 'Formas de login de cliente disponíveis (email/Google); sem nenhuma, a loja vende como convidado' })
  async authMethods(@Param('code') code: string) {
    await this.resolver.resolveByCode(code);
    return this.customers.loginMethods();
  }

  @Post('auth/quick')
  @ApiOperation({ summary: 'Conta rápida do cliente (sem código; nome/telefone/email opcionais)' })
  async authQuick(@Param('code') code: string, @Body() dto: CustomerQuickSignupDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.customers.quickSignup(tenant.schema, dto);
  }

  @Post('auth/email/code')
  @ApiOperation({ summary: 'Envia um código de verificação para o email do cliente (passo 1)' })
  async authEmailCode(@Param('code') code: string, @Body() dto: CustomerEmailLoginDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.customers.sendEmailCode(tenant.schema, dto.email, dto.existing);
  }

  @Post('auth/email')
  @ApiOperation({ summary: 'Login/registo do cliente por email, com o código recebido (passo 2)' })
  async authEmail(@Param('code') code: string, @Body() dto: CustomerEmailLoginDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.customers.emailLogin(tenant.schema, dto.email, dto.name, dto.existing, dto.code);
  }

  @Post('auth/google')
  @ApiOperation({ summary: 'Login do cliente com Google (valida o ID token)' })
  async authGoogle(@Param('code') code: string, @Body() dto: CustomerGoogleLoginDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.customers.googleLogin(tenant.schema, dto.idToken);
  }

  @Get('my/orders')
  @ApiOperation({ summary: 'Histórico de encomendas do cliente autenticado' })
  async myOrders(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.customers.listOrders(tenant.schema, claims.email);
  }

  @Get('my/profile')
  @ApiOperation({ summary: 'Perfil guardado do cliente (pré-preenche o checkout)' })
  async myProfile(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.customers.getProfile(tenant.schema, claims.email);
  }

  @Put('my/profile')
  @ApiOperation({ summary: 'Atualiza o perfil do cliente (nome, telefone, morada, localização)' })
  async updateMyProfile(@Param('code') code: string, @Body() dto: CustomerProfileDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.customers.updateProfile(tenant.schema, claims.email, claims.name, dto);
  }

  // ── White-label / páginas públicas ─────────────────────────
  @Get('site')
  @ApiOperation({ summary: 'Branding + páginas publicadas da loja' })
  async site_(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const [settings, pages] = await Promise.all([
      this.site.getSettings(tenant.schema),
      this.site.listPublishedPages(tenant.schema),
    ]);
    return { store: tenant.name, businessType: tenant.businessType, settings, pages };
  }

  // ── Pedidos/Reservas a partir da loja online (verticais) ───────
  @Get('rooms')
  @ApiOperation({ summary: 'Quartos disponíveis para reserva (Booking) — filtra por datas se indicadas' })
  async rooms(@Param('code') code: string, @Query('checkIn') checkIn?: string, @Query('checkOut') checkOut?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return { businessType: tenant.businessType, rooms: await this.hotel.publicRooms(tenant.schema, checkIn, checkOut) };
  }

  @Post('reservation')
  @ApiOperation({ summary: 'Cliente reserva um quarto pela loja (fica BOOKED, origem ONLINE)' })
  async reservation(@Param('code') code: string, @Body() dto: OnlineReservationDto) {
    const tenant = await this.resolver.resolveByCode(code);
    const r = await this.hotel.create(tenant.schema, null, { ...dto, source: 'ONLINE' });
    if (dto.guestEmail) {
      await this.customers.upsertCustomer(tenant.schema, dto.guestEmail.trim().toLowerCase(), dto.guestName || 'Hóspede', { phone: dto.guestPhone }, true).catch(() => undefined);
    }
    return { ok: true, id: r.id };
  }

  @Post('service-request')
  @ApiOperation({ summary: 'Cliente pede um serviço/orçamento pela loja (OS aberta, origem ONLINE)' })
  async serviceRequest(@Param('code') code: string, @Body() dto: OnlineServiceRequestDto) {
    const tenant = await this.resolver.resolveByCode(code);
    const r = await this.serviceOrders.create(tenant.schema, { id: null, name: 'Loja online' }, {
      customerName: dto.customerName, customerPhone: dto.customerPhone,
      equipmentType: dto.equipmentType, equipmentLabel: dto.equipmentLabel, equipmentRef: dto.equipmentRef,
      problem: dto.problem, source: 'ONLINE',
    });
    if (dto.customerEmail) {
      await this.customers.upsertCustomer(tenant.schema, dto.customerEmail.trim().toLowerCase(), dto.customerName || 'Cliente', { phone: dto.customerPhone }, true).catch(() => undefined);
    }
    // Devolve o número e o token de rastreio para o cliente seguir o reparo.
    return { ok: true, id: r.id, number: r.number, trackToken: r.trackToken };
  }

  @Get('service-order/:token')
  @ApiOperation({ summary: 'Portal do cliente: estado do reparo por token (público, sem dados sensíveis)' })
  async trackServiceOrder(@Param('code') code: string, @Param('token') token: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.serviceOrders.trackByToken(tenant.schema, token);
  }

  @Get('professionals')
  @ApiOperation({ summary: 'Médicos disponíveis para marcação (Portal do Paciente — vertical Clínica)' })
  async professionals(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return { businessType: tenant.businessType, professionals: await this.clinic.publicProfessionals(tenant.schema) };
  }

  @Post('appointment')
  @ApiOperation({ summary: 'Paciente marca uma consulta pela loja (vertical Clínica)' })
  async appointment(@Param('code') code: string, @Body() dto: OnlineAppointmentDto) {
    const tenant = await this.resolver.resolveByCode(code);
    // Com email: liga a marcação a uma FICHA de paciente do cliente (para a área
    // "A minha saúde" reconhecê-la). Best-effort — nunca impede a marcação.
    let patientId: string | undefined;
    if (dto.patientEmail) {
      const em = dto.patientEmail.trim().toLowerCase();
      await this.customers.upsertCustomer(tenant.schema, em, dto.patientName || 'Paciente', { phone: dto.patientPhone }, true).catch(() => undefined);
      patientId = (await this.clinic.ensurePatientForCustomer(tenant.schema, em, dto.patientName || 'Paciente', dto.patientPhone).catch(() => null)) ?? undefined;
    }
    const r = await this.clinic.createAppointment(tenant.schema, {
      patientId, patientName: dto.patientName, professional: dto.professional, scheduledAt: dto.scheduledAt, reason: dto.reason,
    });
    return { ok: true, id: r[0]?.id };
  }

  @Get('my/clinical')
  @ApiOperation({ summary: 'A minha saúde — consultas, receitas e exames do paciente autenticado (Portal do Paciente)' })
  async myClinical(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.clinic.myClinical(tenant.schema, claims.email);
  }

  @Get('my/prescriptions/:id')
  @ApiOperation({ summary: 'Detalhe da minha receita (para imprimir/PDF) — só do próprio paciente' })
  async myPrescription(@Param('code') code: string, @Param('id') id: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.clinic.myPrescriptionDetail(tenant.schema, claims.email, id);
  }

  @Get('pages/:slug')
  @ApiOperation({ summary: 'Página publicada por slug' })
  async page(@Param('code') code: string, @Param('slug') slug: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.site.getPublishedPageBySlug(tenant.schema, slug);
  }

  // ── Pagamentos públicos ─────────────────────────────────────
  @Get('payment-methods')
  @ApiOperation({ summary: 'Métodos de pagamento activos da loja' })
  async paymentMethods(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.payments.listMethods(tenant.schema, true);
  }

  @Post('orders/:orderId/reference')
  @ApiOperation({ summary: 'Gera a referência Multicaixa da encomenda (Entidade + Referência + valor)' })
  async generateReference(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const ref = await this.payments.generateOrderReference(tenant.schema, orderId);
    if (!ref) {
      return { available: false, message: 'A loja ainda não configurou o pagamento por referência (Entidade EMIS).' };
    }
    return { available: true, ...ref };
  }

  @Post('orders/:orderId/proof')
  @ApiOperation({ summary: 'Cliente envia o comprovativo (IBAN/referência) — aguarda aprovação do gestor' })
  async uploadProof(
    @Param('code') code: string,
    @Param('orderId') orderId: string,
    @Body() dto: UploadProofDto,
  ) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.payments.uploadProof(tenant.schema, orderId, dto);
  }

  @Post('orders/:orderId/pay/express')
  @ApiOperation({ summary: 'Pagar por Multicaixa Express (fica por confirmar pela loja até haver verificação do gateway)' })
  async payExpress(
    @Param('code') code: string,
    @Param('orderId') orderId: string,
    @Body() dto: ExpressPayDto,
  ) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.orders.payByExpress(tenant.schema, orderId, dto);
  }

  /**
   * Callback da EMIS para PAGAMENTO POR REFERÊNCIA confirmado ("done").
   * A EMIS é configurada (portal do contrato) para POST nesta URL, específica
   * da empresa: `…/store/<código>/payments/reference/callback`. Protegido por um
   * segredo partilhado no cabeçalho `x-emis-secret` (env EMIS_CALLBACK_SECRET).
   * Quando o pagamento é reconhecido, a encomenda é APROVADA automaticamente
   * (emite factura, fica PAID) sem intervenção do gestor.
   */
  @Post('payments/reference/callback')
  @ApiOperation({ summary: 'Callback EMIS: referência paga → aprova a encomenda automaticamente' })
  async referenceCallback(
    @Param('code') code: string,
    @Body() dto: { entity?: string; reference: string; amount?: number },
    @Headers('x-emis-secret') secret?: string,
  ) {
    const tenant = await this.resolver.resolveByCode(code);
    // Segredo do callback é do GESTOR (encomendas), definido na Loja → Pagamentos
    // (método Referência). NÃO usa o EMIS da plataforma (esse é dos planos).
    // Fallback para a env EMIS_CALLBACK_SECRET.
    const expected = (await this.payments.getReferenceCallbackSecret(tenant.schema)) || process.env.EMIS_CALLBACK_SECRET;
    if (!expected) {
      throw new ServiceUnavailableException(
        'Callback de referência não configurado. Defina o "Segredo do callback EMIS" na Loja → Pagamentos (método Referência).',
      );
    }
    // Comparação em TEMPO CONSTANTE (via hash de comprimento fixo) — a
    // comparação simples de strings vaza o nº de caracteres certos pelo tempo.
    const a = createHash('sha256').update(secret ?? '').digest();
    const b = createHash('sha256').update(expected).digest();
    if (!secret || !timingSafeEqual(a, b)) {
      throw new ForbiddenException('Segredo de callback inválido.');
    }
    // O banco informa SEMPRE o valor pago: sem ele (ou inválido) não se aprova a encomenda.
    if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException('Valor pago em falta ou inválido.');
    }
    return this.orders.confirmReferencePayment(tenant.schema, dto);
  }

  // ── Conversa com a loja (depois de aprovada) ───────────────
  @Get('orders/:orderId/messages')
  @ApiOperation({ summary: 'Histórico da conversa da encomenda' })
  async messages(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.chat.list(tenant.schema, orderId);
  }

  @Post('orders/:orderId/messages')
  @ApiOperation({
    summary: 'Cliente envia mensagem à loja (OpenManus responde se a equipa estiver offline)',
  })
  async sendMessage(
    @Param('code') code: string,
    @Param('orderId') orderId: string,
    @Body() dto: PostMessageDto,
  ) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.chat.postCustomerMessage(tenant.schema, orderId, dto.body, dto.senderName);
  }

  // ── Loja de associados (acesso só para clientes aprovados) ─
  @Get('my/membership')
  @ApiOperation({ summary: 'Estado de associado do cliente (NONE/PENDING/APPROVED/REJECTED)' })
  async myMembership(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.members.statusOf(tenant.schema, claims.email);
  }

  @Post('my/membership/request')
  @ApiOperation({ summary: 'Pede adesão à loja de associados' })
  async requestMembership(@Param('code') code: string, @Body() dto: MemberRequestDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.members.request(tenant.schema, claims.email, dto.note);
  }

  @Get('members/banners')
  @ApiOperation({ summary: 'Anúncios do carrossel da loja de associados (só associados aprovados)' })
  async membersBanners(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.banners.list(tenant.schema, true);
  }

  @Get('members/market')
  @ApiOperation({ summary: 'Mercado de associados: produtos com comissão (só associados aprovados)' })
  async membersMarket(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.affiliates.market(tenant.schema);
  }

  @Get('members/affiliate')
  @ApiOperation({ summary: 'Painel do associado: código, vendas, saldo e saques' })
  async membersAffiliate(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.affiliates.summary(tenant.schema, claims.email);
  }

  @Post('members/withdrawals')
  @ApiOperation({ summary: 'Pede o saque do saldo disponível' })
  async membersWithdraw(@Param('code') code: string, @Body() dto: WithdrawalDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    if (dto.accountId) return this.affiliates.withdrawToAccount(tenant.schema, claims.email, dto.amount, dto.accountId);
    if (!dto.method || !dto.details) throw new BadRequestException('Escolha uma conta para receber.');
    return this.affiliates.requestWithdrawal(tenant.schema, claims.email, dto.amount, dto.method, dto.details);
  }

  @Get('members/accounts')
  @ApiOperation({ summary: 'Contas do associado para receber os saques' })
  async membersAccounts(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.affiliates.listAccounts(tenant.schema, claims.email);
  }

  @Post('members/accounts')
  @ApiOperation({ summary: 'Regista uma conta para receber os saques (máx. 3)' })
  async membersAddAccount(@Param('code') code: string, @Body() dto: PayoutAccountDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.affiliates.addAccount(tenant.schema, claims.email, dto);
  }

  @Post('members/accounts/:accountId/delete')
  @ApiOperation({ summary: 'Elimina uma conta de saque' })
  async membersRemoveAccount(@Param('code') code: string, @Param('accountId') accountId: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    return this.affiliates.removeAccount(tenant.schema, claims.email, accountId);
  }

  @Get('members/catalog')
  @ApiOperation({ summary: 'Catálogo da loja de associados (só associados aprovados)' })
  async membersCatalog(@Param('code') code: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    await this.members.assertApproved(tenant.schema, claims.email);
    const products = await this.storefront.catalog(tenant.schema);
    return { store: tenant.name, products };
  }

  @Get('ref-markups')
  @ApiOperation({ summary: 'Preço próprio do associado da ligação (% por produto)' })
  async refMarkups(@Param('code') code: string, @Query('ref') ref?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.kwanza.markupsFor(tenant.companyId, ref);
  }

  @Get('catalog')
  @ApiOperation({ summary: 'Catálogo público da loja (preços com IVA)' })
  async catalog(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const products = await this.storefront.catalog(tenant.schema);
    return { store: tenant.name, products };
  }

  @Post('visual-search')
  @ApiOperation({ summary: 'Pesquisa por imagem (Google Lens): produtos semelhantes à foto' })
  async visualSearch(@Param('code') code: string, @Body() dto: VisualSearchDto) {
    const tenant = await this.resolver.resolveByCode(code);
    const products = await this.storefront.catalog(tenant.schema);
    try {
      const dataUrl = dto.imageBase64.startsWith('data:')
        ? dto.imageBase64
        : `data:${dto.mimeType || 'image/jpeg'};base64,${dto.imageBase64}`;
      const codes = await this.assistant.visualSearchCodes(
        products.map((p) => ({ code: p.code, name: p.name, category: p.category })),
        dataUrl,
      );
      if (codes.length === 0) {
        return { available: true, products: [], message: 'Não encontrámos produtos parecidos com a imagem.' };
      }
      const byCode = new Map(products.map((p) => [p.code, p]));
      const matched = codes.map((c) => byCode.get(c)).filter((p): p is (typeof products)[number] => !!p);
      return { available: true, products: matched };
    } catch {
      return { available: false, products: [], message: 'Pesquisa por imagem indisponível de momento.' };
    }
  }

  @Get('coupons')
  @ApiOperation({ summary: 'Cupões que a loja mostra na montra' })
  async coupons(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.marketing.publicCoupons(tenant.schema);
  }

  @Post('coupon/check')
  @ApiOperation({ summary: 'Valida um cupão para o cliente com sessão e devolve o desconto' })
  async couponCheck(@Param('code') code: string, @Body() dto: CouponCheckDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.marketing.previewCoupon(tenant.schema, dto.code, claims.email, dto.total);
  }

  @Post('products/:productCode/view')
  @ApiOperation({ summary: 'Conta uma visualização da página do produto' })
  async productView(@Param('code') code: string, @Param('productCode') productCode: string) {
    const tenant = await this.resolver.resolveByCode(code);
    await this.storefront.countView(tenant.schema, productCode).catch(() => undefined);
    return { ok: true };
  }

  @Get('products/:productCode/reviews')
  @ApiOperation({ summary: 'Avaliações visíveis de um produto (+ a do cliente com sessão)' })
  async reviews(@Param('code') code: string, @Param('productCode') productCode: string, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = auth ? await this.customers.verify(tenant.schema, auth).catch(() => null) : null;
    return this.marketing.productReviews(tenant.schema, productCode, claims?.email ?? null);
  }

  @Post('products/:productCode/reviews')
  @ApiOperation({ summary: 'Avalia um produto comprado (1 por cliente; volta a enviar para editar)' })
  async review(@Param('code') code: string, @Param('productCode') productCode: string, @Body() dto: ReviewDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.marketing.submitReview(tenant.schema, productCode, claims.email, claims.name || 'Cliente', dto.rating, dto.comment);
  }

  @Post('checkout')
  @ApiOperation({ summary: 'Cria uma encomenda online (PENDING)' })
  async checkout(@Param('code') code: string, @Body() dto: CheckoutDto, @Headers('authorization') auth?: string) {
    const tenant = await this.resolver.resolveByCode(code);
    // Só o GPS é obrigatório: sem nome, usa o da conta (ou "Cliente"); morada opcional.
    const claimsForName = !dto.customerName?.trim() && auth ? await this.customers.verify(tenant.schema, auth).catch(() => null) : null;
    dto.customerName = (dto.customerName?.trim() || claimsForName?.name || 'Cliente').slice(0, 200);
    dto.province = dto.province?.trim() || undefined;
    dto.municipality = dto.municipality?.trim() || undefined;
    dto.neighborhood = dto.neighborhood?.trim() || undefined;
    // Cupão: só com sessão; a encomenda fica no email verificado (limites por cliente).
    let couponEmail: string | null = null;
    if (dto.couponCode?.trim()) {
      const claims = await this.customers.verify(tenant.schema, auth);
      couponEmail = claims.email.toLowerCase();
      dto.customerEmail = couponEmail;
    }
    // Com sessão, a encomenda fica sempre ligada à conta do cliente ("Minhas compras").
    if (!dto.customerEmail && auth) {
      const owner = await this.customers.verify(tenant.schema, auth).catch(() => null);
      if (owner) dto.customerEmail = owner.email.toLowerCase();
    }
    const markups = dto.affiliateCode ? await this.kwanza.markupsFor(tenant.companyId, dto.affiliateCode).catch(() => ({})) : {};
    const result = await this.storefront.checkout(tenant.schema, dto, couponEmail, markups);
    if (dto.affiliateCode) {
      const buyer = auth ? await this.customers.verify(tenant.schema, auth).catch(() => null) : null;
      await this.affiliates.attribute(tenant.schema, result.id, dto.affiliateCode, buyer?.email ?? dto.customerEmail ?? null).catch(() => undefined);
      // Associado do marketplace central (LPS Kwanza): código global.
      await this.kwanza.attribute(tenant, code, result.id, dto.affiliateCode, buyer?.email ?? dto.customerEmail ?? null, markups).catch(() => undefined);
    }
    await this.adminNotes.push(tenant.schema, { kind: 'ORDER', title: `Nova encomenda ${result.orderNumber}`, body: `${dto.customerName} · ${Number(result.grossTotal).toLocaleString('pt-PT')} Kz${dto.affiliateCode ? ' · via associado' : ''}`, section: 'orders', ref: result.id });
    // Lembra/atualiza o perfil do cliente (e sincroniza com o caixa/gestor):
    // assim, na próxima compra os dados já vêm preenchidos. Só ATUALIZA um
    // cliente existente com sessão desse mesmo email; anónimo apenas cria.
    if (dto.customerEmail) {
      const email = dto.customerEmail.trim().toLowerCase();
      const claims = auth ? await this.customers.verify(tenant.schema, auth).catch(() => null) : null;
      const own = !!claims && claims.email.toLowerCase() === email;
      await this.customers.upsertCustomer(tenant.schema, email, dto.customerName, {
        phone: dto.customerPhone, address: dto.shippingAddress, province: dto.province,
        municipality: dto.municipality, neighborhood: dto.neighborhood, taxId: dto.customerTaxId,
      }, !own).catch(() => undefined);
    }
    return result;
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Consulta o estado de uma encomenda' })
  async track(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.orders.get(tenant.schema, orderId);
  }

  @Get('orders/:orderId/invoice')
  @ApiOperation({ summary: 'Fatura fiscal da encomenda (para o cliente descarregar em PDF A4)' })
  async orderInvoice(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.orders.invoiceForCustomer(tenant.schema, tenant.companyId, orderId);
  }

  @Post('orders/:orderId/location')
  @ApiOperation({ summary: 'Cliente envia a sua localização GPS (entrega, tempo real)' })
  async updateLocation(
    @Param('code') code: string,
    @Param('orderId') orderId: string,
    @Body() dto: CustomerLocationDto,
    @Headers('authorization') auth?: string,
  ) {
    const tenant = await this.resolver.resolveByCode(code);
    const claims = await this.customers.verify(tenant.schema, auth);
    return this.orders.updateLocation(tenant.schema, orderId, dto, claims.email);
  }
}
