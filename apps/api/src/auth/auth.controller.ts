import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Ip,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { AuthService } from './auth.service';
import {
  EnableTwoFaDto,
  PlatformLoginDto,
  RefreshDto,
  TenantLoginDto,
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
