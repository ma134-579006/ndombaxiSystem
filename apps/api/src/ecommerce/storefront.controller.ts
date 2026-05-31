import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { UploadProofDto } from '../payments/dto/payment.dto';
import { PaymentsService } from '../payments/payments.service';
import { SiteService } from '../site/site.service';
import { CheckoutDto } from './dto/checkout.dto';
import { ExpressPayDto } from './dto/express-pay.dto';
import { PostMessageDto } from './dto/order-message.dto';
import { OrderChatService } from './order-chat.service';
import { OrdersService } from './orders.service';
import { StorefrontService } from './storefront.service';
import { TenantResolverService } from './tenant-resolver.service';

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
  ) {}

  // ── White-label / páginas públicas ─────────────────────────
  @Get('site')
  @ApiOperation({ summary: 'Branding + páginas publicadas da loja' })
  async site_(@Param('code') code: string) {
    const tenant = await this.resolver.resolveByCode(code);
    const [settings, pages] = await Promise.all([
      this.site.getSettings(tenant.schema),
      this.site.listPublishedPages(tenant.schema),
    ]);
    return { store: tenant.name, settings, pages };
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

  @Post('checkout')
  @ApiOperation({ summary: 'Cria uma encomenda online (PENDING)' })
  async checkout(@Param('code') code: string, @Body() dto: CheckoutDto) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.storefront.checkout(tenant.schema, dto);
  }

  @Get('orders/:orderId')
  @ApiOperation({ summary: 'Consulta o estado de uma encomenda' })
  async track(@Param('code') code: string, @Param('orderId') orderId: string) {
    const tenant = await this.resolver.resolveByCode(code);
    return this.orders.get(tenant.schema, orderId);
  }
}
