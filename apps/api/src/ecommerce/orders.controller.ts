import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PostMessageDto } from './dto/order-message.dto';
import { OrderChatService } from './order-chat.service';
import { OrdersService } from './orders.service';

/** Gestão de encomendas online (back-office autenticado). */
@ApiTags('ecommerce')
@Controller('ecommerce/orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly chat: OrderChatService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista encomendas online' })
  list() {
    return this.orders.list(this.ctx.requireTenantSchema());
  }

  @Get('count/pending')
  @ApiOperation({ summary: 'Nº de encomendas novas por tratar (sino de notificações)' })
  pendingCount() {
    return this.orders.pendingCount(this.ctx.requireTenantSchema());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhe de uma encomenda' })
  get(@Param('id') id: string) {
    return this.orders.get(this.ctx.requireTenantSchema(), id);
  }

  @Post(':id/pay')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Confirma pagamento e emite factura' })
  pay(@Param('id') id: string) {
    return this.orders.pay(this.ctx.requireTenantSchema(), id);
  }

  @Post('proofs/:proofId/approve')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Aprova o comprovativo (transferência/referência) e emite a factura' })
  approveProof(
    @Param('proofId') proofId: string,
    @Body('note') note: string | undefined,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.orders.approveProofAndPay(this.ctx.requireTenantSchema(), proofId, user?.sub, note);
  }

  @Post(':id/ship')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Marca encomenda como expedida' })
  async ship(@Param('id') id: string) {
    await this.orders.setStatus(this.ctx.requireTenantSchema(), id, 'SHIPPED');
    return { status: 'SHIPPED' };
  }

  @Post(':id/deliver')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Marca encomenda como entregue' })
  async deliver(@Param('id') id: string) {
    await this.orders.setStatus(this.ctx.requireTenantSchema(), id, 'DELIVERED');
    return { status: 'DELIVERED' };
  }

  @Post(':id/cancel')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cancela uma encomenda PENDING' })
  async cancel(@Param('id') id: string) {
    await this.orders.setStatus(this.ctx.requireTenantSchema(), id, 'CANCELLED');
    return { status: 'CANCELLED' };
  }

  // ── Conversa com o cliente ─────────────────────────────────
  @Get(':id/messages')
  @ApiOperation({ summary: 'Histórico da conversa de uma encomenda' })
  messages(@Param('id') id: string) {
    return this.chat.list(this.ctx.requireTenantSchema(), id);
  }

  @Post(':id/messages')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Responde ao cliente na conversa da encomenda' })
  sendMessage(
    @Param('id') id: string,
    @Body() dto: PostMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.chat.postStaffMessage(
      this.ctx.requireTenantSchema(),
      id,
      dto.body,
      user.sub,
      dto.senderName?.trim() || user.email,
    );
  }
}
