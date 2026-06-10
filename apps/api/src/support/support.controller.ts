import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { SupportService } from './support.service';

class StartChatDto {
  @IsOptional() @IsString() @Length(0, 80)
  name?: string;
}
class MessageDto {
  @IsString() @Length(1, 3000)
  body!: string;

  /** Histórico vindo do navegador (o servidor não guarda conversas do bot).
   *  Cada item {role:'user'|'assistant', content:string} — saneado no serviço. */
  @IsOptional() @IsArray() @ArrayMaxSize(12)
  history?: { role: 'user' | 'assistant'; content: string }[];
}
class FeedbackDto {
  @IsOptional() @IsString() @Length(0, 80)
  name?: string;

  @IsString() @Length(3, 1200)
  body!: string;
}
class VoteDto {
  @IsIn(['up', 'down'])
  dir!: 'up' | 'down';
}

/** Chat de suporte + comentários públicos da landing (visitantes). */
@ApiTags('support')
@Controller('public/support')
export class PublicSupportController {
  constructor(private readonly support: SupportService) {}

  @Public()
  @Post('chats')
  @ApiOperation({ summary: 'Abre uma conversa com o assistente do sistema' })
  start(@Body() dto: StartChatDto) {
    return this.support.createChat(dto.name);
  }

  @Public()
  @Post('chats/:id/messages')
  @ApiOperation({ summary: 'Envia mensagem; o bot responde (ou escala para o Super Admin)' })
  send(@Param('id') id: string, @Body() dto: MessageDto) {
    return this.support.sendVisitorMessage(id, dto.body, dto.history);
  }

  @Public()
  @Get('chats/:id/messages')
  @ApiOperation({ summary: 'Mensagens da conversa (polling do visitante)' })
  messages(@Param('id') id: string, @Query('after') after?: string) {
    return this.support.listMessages(id, after);
  }

  @Public()
  @Post('feedback')
  @ApiOperation({ summary: 'Publica um comentário/sugestão no site' })
  addFeedback(@Body() dto: FeedbackDto) {
    return this.support.addFeedback(dto.name ?? '', dto.body);
  }

  @Public()
  @Get('feedback')
  @ApiOperation({ summary: 'Lista os comentários públicos' })
  listFeedback() {
    return this.support.listFeedback();
  }

  @Public()
  @Post('feedback/:id/vote')
  @ApiOperation({ summary: 'Gosto / não gosto num comentário' })
  vote(@Param('id') id: string, @Body() dto: VoteDto) {
    return this.support.vote(id, dto.dir);
  }
}

/** Lado do Super Admin: conversas, respostas e painel de comentários. */
@ApiTags('support')
@Controller('super-admin/support')
export class AdminSupportController {
  constructor(private readonly support: SupportService) {}

  @Get('notifications')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Sino: conversas por ler + comentários novos' })
  notifications() {
    return this.support.notifications();
  }

  @Get('chats')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Conversas de suporte (por ler primeiro)' })
  chats() {
    return this.support.listChats();
  }

  @Get('chats/:id/messages')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Mensagens de uma conversa' })
  messages(@Param('id') id: string, @Query('after') after?: string) {
    return this.support.listMessages(id, after);
  }

  @Post('chats/:id/messages')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Responde ao visitante (assume a conversa)' })
  reply(@Param('id') id: string, @Body() dto: MessageDto) {
    return this.support.adminReply(id, dto.body);
  }

  @Post('chats/:id/read')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Marca a conversa como lida' })
  read(@Param('id') id: string) {
    return this.support.markRead(id);
  }

  @Post('chats/:id/close')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Fecha a conversa' })
  close(@Param('id') id: string) {
    return this.support.closeChat(id);
  }

  @Get('feedback')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Comentários + estatísticas (marca como vistos)' })
  feedback() {
    return this.support.feedbackAdmin();
  }
}
