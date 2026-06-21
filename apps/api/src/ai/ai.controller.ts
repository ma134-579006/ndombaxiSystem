import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AgentService } from './agent.service';
import { AssistantService } from './assistant.service';
import { AiMemoryService } from './ai-memory.service';
import { ChatDto, ImageDto, SttDto, TtsDto } from './dto/chat.dto';

/**
 * Assistente OpenManus para utilizadores das empresas (§ Fase 7).
 * Profissional e humano: chat (Markdown com emojis/tabelas/gráficos/imagens),
 * voz (TTS/STT) e sessão de chamada. Os provedores reais são os que o Super
 * Admin configurou no painel.
 */
@ApiTags('ai-assistant')
@ApiBearerAuth()
@Controller('ai')
export class AiController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly agent: AgentService,
    private readonly memory: AiMemoryService,
  ) {}

  /**
   * AGENTE com ferramentas reais — stream de eventos (SSE) em tempo real:
   * cada passo (ferramenta + resultado), anexos e o texto final, para o
   * painel de atividade do frontend.
   */
  @Post('agent/chat')
  @ApiOperation({ summary: 'Agente IA do gestor (ferramentas reais, eventos SSE em tempo real)' })
  async agentChat(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload, @Res() res: Response) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    const send = (e: unknown) => res.write(`data: ${JSON.stringify(e)}\n\n`);
    try {
      await this.agent.run(
        user,
        dto.messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' as const : 'user' as const, content: m.content })),
        send,
      );
    } catch (e) {
      send({ type: 'error', text: e instanceof Error ? e.message : 'Falha no agente.' });
    } finally {
      res.end();
    }
  }

  @Get('greeting')
  @ApiOperation({ summary: 'Saudação inicial do assistente' })
  greeting() {
    return this.assistant.greeting();
  }

  @Post('chat')
  @ApiOperation({ summary: 'Conversar com o assistente (texto)' })
  chat(@Body() dto: ChatDto, @CurrentUser() user: JwtPayload) {
    return this.assistant.chat(dto.messages, {
      channel: dto.channel ?? 'chat',
      userRole: user?.role,
    });
  }

  @Post('voice/tts')
  @ApiOperation({ summary: 'Converter texto em voz (áudio base64)' })
  tts(@Body() dto: TtsDto) {
    return this.assistant.speak(dto.text, dto.voice);
  }

  @Post('voice/stt')
  @ApiOperation({ summary: 'Transcrever voz em texto' })
  stt(@Body() dto: SttDto) {
    return this.assistant.transcribe(dto.audioBase64, dto.mimeType);
  }

  @Post('voice/turn')
  @ApiOperation({ summary: 'Turno de voz completo (áudio→resposta falada)' })
  voiceTurn(@Body() dto: SttDto, @CurrentUser() user: JwtPayload) {
    return this.assistant.voiceTurn(dto.audioBase64, dto.mimeType, { userRole: user?.role }, { schema: user?.tenantSchema, userId: user?.sub });
  }

  @Get('history')
  @ApiOperation({ summary: 'Histórico do assistente (memória) do utilizador' })
  history(@CurrentUser() user: JwtPayload) {
    if (!user?.tenantSchema) return [];
    return this.memory.history(user.tenantSchema, user.sub);
  }

  @Post('history/clear')
  @ApiOperation({ summary: 'Limpa a memória do assistente do utilizador (nova conversa)' })
  clearHistory(@CurrentUser() user: JwtPayload) {
    if (!user?.tenantSchema) return { ok: true };
    return this.memory.clear(user.tenantSchema, user.sub);
  }

  @Post('image')
  @ApiOperation({ summary: 'Gerar uma imagem a partir de um prompt' })
  image(@Body() dto: ImageDto) {
    return this.assistant.generateImage(dto.prompt, dto.size);
  }

  @Get('call/session')
  @ApiOperation({ summary: 'Abrir sessão de chamada de voz com o assistente' })
  callSession() {
    return this.assistant.callSession();
  }
}
