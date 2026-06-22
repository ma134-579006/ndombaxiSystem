import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { BadRequestException } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CustomerChatService } from './customer-chat.service';
import { StaffDeleteDto, StaffReadDto, StaffSendDto } from './dto/customer-chat.dto';

/** Chat da EQUIPA com os clientes da loja online (back-office autenticado). */
@ApiTags('ecommerce')
@Controller('ecommerce/customer-chat')
export class CustomerChatController {
  constructor(
    private readonly chat: CustomerChatService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('contacts')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Clientes para conversar (online + não-lidas)' })
  contacts() {
    return this.chat.contacts(this.ctx.requireTenantSchema());
  }

  @Get('messages')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Conversa com um cliente' })
  messages(@Query('customer') customer: string) {
    if (!customer) throw new BadRequestException('customer é obrigatório');
    return this.chat.staffMessages(this.ctx.requireTenantSchema(), customer);
  }

  @Post('messages')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Envia uma mensagem a um cliente' })
  send(@Body() dto: StaffSendDto, @CurrentUser() user: JwtPayload) {
    return this.chat.staffSend(
      this.ctx.requireTenantSchema(),
      dto.customerId,
      { id: user.sub, name: user.name ?? user.email ?? 'Loja' },
      dto.body,
    );
  }

  @Post('read')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Marca a conversa do cliente como lida' })
  markRead(@Body() dto: StaffReadDto) {
    return this.chat.staffRead(this.ctx.requireTenantSchema(), dto.customerId);
  }

  @Post('delete')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Apaga mensagens selecionadas' })
  remove(@Body() dto: StaffDeleteDto) {
    return this.chat.remove(this.ctx.requireTenantSchema(), dto.ids);
  }

  @Get('unread')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Total de não-lidas de clientes (badge)' })
  unread() {
    return this.chat.staffUnread(this.ctx.requireTenantSchema());
  }
}
