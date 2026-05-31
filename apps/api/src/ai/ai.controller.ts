import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AssistantService } from './assistant.service';
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
  constructor(private readonly assistant: AssistantService) {}

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
    return this.assistant.voiceTurn(dto.audioBase64, dto.mimeType, { userRole: user?.role });
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
