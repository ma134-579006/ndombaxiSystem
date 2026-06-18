import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { AuthService } from './auth.service';
import {
  EnableTwoFaDto,
  ForgotPasswordDto,
  GoogleLoginDto,
  PinLoginDto,
  PlatformLoginDto,
  RefreshDto,
  ResetPasswordDto,
  StaffPinLoginDto,
  TenantLoginDto,
  UpdateThemeDto,
} from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('super-admin/login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do Super Admin (plataforma)' })
  platformLogin(
    @Body() dto: PlatformLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.platformLogin(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Esqueci a senha/PIN — envia link de recuperação por e-mail' })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.auth.requestPasswordReset(dto.email, dto.kind === 'PIN' ? 'PIN' : 'PASSWORD', dto.companyCode);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Define a nova senha/PIN a partir do token do e-mail' })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.auth.performPasswordReset(dto.token, dto.secret);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de utilizador de empresa (tenant)' })
  tenantLogin(
    @Body() dto: TenantLoginDto,
    @Ip() ip: string,
    @Headers('x-tenant-code') headerCode?: string,
    @Headers('user-agent') ua?: string,
  ) {
    if (!dto.companyCode && headerCode) dto.companyCode = headerCode;
    return this.auth.tenantLogin(dto, { ip, userAgent: ua });
  }

  @Public()
  @Get('operators')
  @ApiOperation({ summary: 'Operadores da empresa para a caixa (por e-mail registado ou código)' })
  operators(
    @Query('company') company?: string,
    @Query('companyCode') companyCode?: string,
    @Headers('x-tenant-code') headerCode?: string,
  ) {
    return this.auth.listOperators((company || companyCode || headerCode || '').toLowerCase());
  }

  @Public()
  @Post('login/pin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login do operador da caixa por nome (id) + PIN' })
  pinLogin(
    @Body() dto: PinLoginDto,
    @Ip() ip: string,
    @Headers('x-tenant-code') headerCode?: string,
    @Headers('user-agent') ua?: string,
  ) {
    if (!dto.companyCode && headerCode) dto.companyCode = headerCode.toLowerCase();
    return this.auth.pinLogin(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('login/staff')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login da caixa por E-MAIL do funcionário + PIN (descobre empresa+loja)' })
  staffLogin(
    @Body() dto: StaffPinLoginDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.staffPinLogin(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login de empresa com Google (ID token) + companyCode' })
  googleLogin(
    @Body() dto: GoogleLoginDto,
    @Ip() ip: string,
    @Headers('x-tenant-code') headerCode?: string,
    @Headers('user-agent') ua?: string,
  ) {
    if (!dto.companyCode && headerCode) dto.companyCode = headerCode.toLowerCase();
    return this.auth.googleLogin(dto, { ip, userAgent: ua });
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotação de tokens via refresh token' })
  refresh(
    @Body() dto: RefreshDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
  ) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoga o refresh token (logout)' })
  async logout(@Body() dto: RefreshDto): Promise<void> {
    await this.auth.logout(dto.refreshToken);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('me/preferences')
  @ApiOperation({ summary: 'Preferências do utilizador autenticado (tema)' })
  getPreferences(@CurrentUser() user: JwtPayload) {
    return this.auth.getPreferences(user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Patch('me/preferences')
  @ApiOperation({ summary: 'Grava preferências do utilizador (tema por perfil)' })
  setPreferences(@CurrentUser() user: JwtPayload, @Body() dto: UpdateThemeDto) {
    return this.auth.setPreferences(user, dto.theme);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('2fa/setup')
  @ApiOperation({ summary: 'Inicia o enrolamento de 2FA (devolve QR Code)' })
  beginTwoFa(@CurrentUser() user: JwtPayload) {
    return this.auth.beginTwoFaSetup(user);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('2fa/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirma e activa o 2FA' })
  async confirmTwoFa(
    @CurrentUser() user: JwtPayload,
    @Body() dto: EnableTwoFaDto,
  ): Promise<void> {
    await this.auth.confirmTwoFa(user, dto.token);
  }
}
