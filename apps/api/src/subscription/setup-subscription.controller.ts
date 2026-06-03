import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.validation';
import { Public } from '../auth/decorators/public.decorator';
import { SubscriptionService } from './subscription.service';
import { SetupCreateSubscriptionDto, SetupProofDto } from './dto/subscription.dto';

/**
 * Conclusão da subscrição na LANDING, logo após criar conta e SEM login.
 * Autorizado pelo `setupToken` (JWT typ:'setup') devolvido no registo. Reutiliza
 * o SubscriptionService; o Super Admin aprova o comprovativo como habitual,
 * o que activa a subscrição e a empresa.
 */
@ApiTags('onboarding')
@Public()
@Controller('onboarding/setup')
export class SetupSubscriptionController {
  constructor(
    private readonly subs: SubscriptionService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private async companyId(token?: string): Promise<string> {
    if (!token) throw new UnauthorizedException('Token de configuração em falta.');
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; typ: string }>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
      if (claims.typ !== 'setup' || !claims.sub) throw new Error('bad token');
      return claims.sub;
    } catch {
      throw new UnauthorizedException('Sessão de configuração inválida ou expirada.');
    }
  }

  @Get('subscriptions')
  @ApiOperation({ summary: 'Subscrições da empresa em configuração (estado)' })
  async list(@Query('setupToken') setupToken?: string) {
    return this.subs.list({ companyId: await this.companyId(setupToken) });
  }

  @Post('subscription')
  @ApiOperation({ summary: 'Criar subscrição (escolher plano) — pós-registo, sem login' })
  async create(@Body() dto: SetupCreateSubscriptionDto) {
    const companyId = await this.companyId(dto.setupToken);
    return this.subs.create(companyId, {
      planId: dto.planId,
      method: dto.method,
      bankAccountId: dto.bankAccountId,
    });
  }

  @Post('subscription/:id/proof')
  @ApiOperation({ summary: 'Enviar comprovativo (imagem) — pós-registo, sem login' })
  async proof(@Param('id') id: string, @Body() dto: SetupProofDto) {
    const companyId = await this.companyId(dto.setupToken);
    return this.subs.submitProof(companyId, id, {
      fileName: dto.fileName,
      fileType: dto.fileType,
      fileData: dto.fileData,
      amountKz: dto.amountKz,
      note: dto.note,
    });
  }
}
