import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ChatService } from './chat.service';
import { SendChatDto } from './dto/chat.dto';

/** Chat de equipa da empresa (gerente ↔ caixa). Disponível a toda a equipa. */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('messages')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Histórico de mensagens da equipa' })
  list() {
    return this.chat.list(this.ctx.requireTenantSchema());
  }

  @Post('messages')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Envia uma mensagem para a equipa' })
  send(@Body() dto: SendChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.send(
      this.ctx.requireTenantSchema(),
      { id: user.sub, name: user.name ?? user.email ?? 'Equipa', role: user.role },
      dto.body,
    );
  }

  @Get('unread')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Nº de mensagens não-lidas (badge)' })
  unread(@CurrentUser() user: JwtPayload) {
    return this.chat.unread(this.ctx.requireTenantSchema(), user.sub);
  }

  @Post('read')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Marca o chat como lido (zera o badge)' })
  markRead(@CurrentUser() user: JwtPayload) {
    return this.chat.markRead(this.ctx.requireTenantSchema(), user.sub);
  }
}
