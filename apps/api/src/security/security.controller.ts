import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TwoFactorService, type TwoFaMethod } from './two-factor.service';

class ConfigDto {
  @IsOptional() @IsBoolean() allowEmail?: boolean;
  @IsOptional() @IsBoolean() allowWhatsapp?: boolean;
  @IsOptional() @IsString() @MaxLength(120) waTemplate?: string | null;
  @IsOptional() @IsString() @MaxLength(12) waLang?: string;
  @IsOptional() @IsBoolean() waAuthButton?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(3) @Max(30) codeMinutes?: number;
}
class TestDto { @IsIn(['EMAIL', 'WHATSAPP']) channel!: TwoFaMethod; @IsString() @MaxLength(160) target!: string; }
class WhoDto { @IsString() @MaxLength(160) who!: string; }
class SetupDto { @IsIn(['EMAIL', 'WHATSAPP']) method!: TwoFaMethod; @IsString() @MaxLength(160) target!: string; }
class CodeDto { @IsString() @MaxLength(10) code!: string; }
const CODE_THROTTLE = { default: { limit: 12, ttl: 60_000 } };

/** Super Admin → Segurança (2FA): canais, modelo do WhatsApp, teste e desbloqueio de contas. */
@ApiTags('super-admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/security')
export class SecurityAdminController {
  constructor(private readonly tf: TwoFactorService) {}
  @Get() @ApiOperation({ summary: 'Configuração da verificação em 2 passos' })
  async get() { return { config: await this.tf.config(), channels: await this.tf.channels(), stats: await this.tf.stats() }; }
  @Put() @ApiOperation({ summary: 'Guarda a configuração da 2FA' })
  async save(@Body() d: ConfigDto) { await this.tf.saveConfig(d); return this.get(); }
  @Post('test') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Envia um código de teste' })
  test(@Body() d: TestDto) { return this.tf.test(d.channel, d.target); }
  @Post('disable-user') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Desliga a 2FA de quem perdeu o acesso' })
  disableUser(@Body() d: WhoDto) { return this.tf.adminDisable(d.who); }
}

/** A conta da própria pessoa (Super Admin ou utilizador de empresa): ligar/desligar a 2FA. */
@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth/two-factor')
export class TwoFactorController {
  constructor(private readonly tf: TwoFactorService) {}
  private subject(u: JwtPayload) {
    if (u.subjectType === 'PLATFORM') return TwoFactorService.platform(u.sub);
    if (u.subjectType === 'TENANT' && u.tenantSchema) return TwoFactorService.tenant(u.tenantSchema, u.sub);
    throw new ForbiddenException('Conta sem verificação em 2 passos.');
  }
  @Get() status(@CurrentUser() u: JwtPayload) { return this.tf.status(this.subject(u)); }
  @Throttle(CODE_THROTTLE) @Post('setup') @HttpCode(HttpStatus.OK)
  setup(@CurrentUser() u: JwtPayload, @Body() d: SetupDto) { return this.tf.startSetup(this.subject(u), d.method, d.target); }
  @Throttle(CODE_THROTTLE) @Post('setup/confirm') @HttpCode(HttpStatus.OK)
  confirm(@CurrentUser() u: JwtPayload, @Body() d: CodeDto) { return this.tf.confirmSetup(this.subject(u), d.code, u.email?.toLowerCase() ?? null); }
  @Throttle(CODE_THROTTLE) @Post('disable/request') @HttpCode(HttpStatus.OK)
  disableRequest(@CurrentUser() u: JwtPayload) { return this.tf.requestDisable(this.subject(u)); }
  @Throttle(CODE_THROTTLE) @Post('disable') @HttpCode(HttpStatus.OK)
  disable(@CurrentUser() u: JwtPayload, @Body() d: CodeDto) { return this.tf.disable(this.subject(u), d.code); }
  @Throttle(CODE_THROTTLE) @Post('code') @HttpCode(HttpStatus.OK)
  code(@CurrentUser() u: JwtPayload, @Body() d: { purpose?: string }) {
    if (d?.purpose !== 'CHANGE_PW') throw new BadRequestException('Finalidade inválida.');
    return this.tf.requestCode(this.subject(u), 'CHANGE_PW');
  }
}
