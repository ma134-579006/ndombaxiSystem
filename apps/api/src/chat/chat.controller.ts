import { BadRequestException, Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ChatService } from './chat.service';
import { DeleteChatDto, ReadChatDto, SendChatDto } from './dto/chat.dto';

/** Chat de equipa 1:1 (gerente ↔ caixa). Disponível a toda a equipa. */
@ApiTags('chat')
@Controller('chat')
export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('contacts')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Contactos da equipa (com online + não-lidas)' })
  contacts(@CurrentUser() user: JwtPayload) {
    return this.chat.contacts(this.ctx.requireTenantSchema(), user.sub);
  }

  @Get('messages')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Mensagens da conversa com um par' })
  messages(@Query('peer') peer: string, @CurrentUser() user: JwtPayload) {
    if (!peer) throw new BadRequestException('peer é obrigatório');
    return this.chat.messages(this.ctx.requireTenantSchema(), user.sub, peer);
  }

  @Post('messages')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Envia uma mensagem a um membro da equipa' })
  send(@Body() dto: SendChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.send(
      this.ctx.requireTenantSchema(),
      { id: user.sub, name: user.name ?? user.email ?? 'Equipa', role: user.role },
      dto.recipientId,
      dto.body,
    );
  }

  @Post('read')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Marca a conversa como lida' })
  markRead(@Body() dto: ReadChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.markRead(this.ctx.requireTenantSchema(), user.sub, dto.peerId);
  }

  @Post('delete')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Apaga mensagens selecionadas da conversa' })
  remove(@Body() dto: DeleteChatDto, @CurrentUser() user: JwtPayload) {
    return this.chat.remove(this.ctx.requireTenantSchema(), user.sub, dto.ids);
  }

  @Get('unread')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Total de não-lidas (badge) + presença' })
  unread(@CurrentUser() user: JwtPayload) {
    return this.chat.unread(this.ctx.requireTenantSchema(), user.sub);
  }
}
