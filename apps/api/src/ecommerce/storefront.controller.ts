import { Body, Controller, ForbiddenException, Get, Headers, Param, Post, Put, Query, ServiceUnavailableException } from '@nestjs/common';
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
import { CustomerEmailLoginDto, CustomerGoogleLoginDto } from './dto/customer-auth.dto';
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
  @Post('auth/email')
  @ApiOperation({ summary: 'Login/registo rápido do cliente por email' })
  async authEmail(@Param('code') code: string, @Body() dto: CustomerEmailLoginDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.customers.emailLogin(tenant.schema, dto.email, dto.name);
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
      await this.customers.upsertCustomer(tenant.schema, dto.guestEmail.trim().toLowerCase(), dto.guestName || 'Hóspede', { phone: dto.guestPhone }).catch(() => undefined);
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
      await this.customers.upsertCustomer(tenant.schema, dto.customerEmail.trim().toLowerCase(), dto.customerName || 'Cliente', { phone: dto.customerPhone }).catch(() => undefined);
    }
    return { ok: true, id: r.id };
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
    const r = await this.clinic.createAppointment(tenant.schema, {
      patientName: dto.patientName, professional: dto.professional, scheduledAt: dto.scheduledAt, reason: dto.reason,
    });
    if (dto.patientEmail) {
      await this.customers.upsertCustomer(tenant.schema, dto.patientEmail.trim().toLowerCase(), dto.patientName || 'Paciente', { phone: dto.patientPhone }).catch(() => undefined);
    }
    return { ok: true, id: r[0]?.id };
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
  @ApiOperation({ summary: 'Pagar por Multicaixa Express (aprovação automática verificada)' })
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

  @Post('checkout')
  @ApiOperation({ summary: 'Cria uma encomenda online (PENDING)' })
  async checkout(@Param('code') code: string, @Body() dto: CheckoutDto) {
    const tenant = await this.resolver.resolveByCode(code);
    const result = await this.storefront.checkout(tenant.schema, dto);
    // Lembra/atualiza o perfil do cliente (e sincroniza com o caixa/gestor):
    // assim, na próxima compra os dados já vêm preenchidos.
    if (dto.customerEmail) {
      await this.customers.upsertCustomer(tenant.schema, dto.customerEmail.trim().toLowerCase(), dto.customerName, {
        phone: dto.customerPhone, address: dto.shippingAddress, province: dto.province,
        municipality: dto.municipality, neighborhood: dto.neighborhood, taxId: dto.customerTaxId,
      }).catch(() => undefined);
    }
    return result;
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Consulta o estado de uma encomenda' })
  async track(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.orders.get(tenant.schema, orderId);
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
