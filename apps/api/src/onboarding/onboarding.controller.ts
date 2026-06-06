import { Body, Controller, Get, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantContext } from '../tenancy/tenant-context';
import { OnboardingService } from './onboarding.service';
import { RegisterCompanyDto } from './dto/register-company.dto';
import { CompleteSetupDto, RegisterSimpleDto } from './dto/register-simple.dto';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(
    private readonly onboarding: OnboardingService,
    private readonly ctx: TenantContext,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Registo público de nova empresa (tenant) — completo' })
  register(@Body() dto: RegisterCompanyDto) {
    return this.onboarding.register(dto);
  }

  @Public()
  @Post('register-simple')
  @ApiOperation({ summary: 'Registo simples: email+palavra-passe OU Google (auto-login)' })
  registerSimple(@Body() dto: RegisterSimpleDto, @Ip() ip: string) {
    return this.onboarding.registerSimple(dto, { ip });
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('my-plan')
  @ApiOperation({ summary: 'Plano atual da empresa (passo de pagamento do setup)' })
  myPlan(@CurrentUser() user: JwtPayload) {
    return this.onboarding.getMyPlan(user.tenantId);
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Get('setup-status')
  @ApiOperation({ summary: 'Estado do setup + aprovação da empresa autenticada' })
  setupStatus(@CurrentUser() user: JwtPayload) {
    return this.onboarding.getSetupStatus(user.tenantId, this.ctx.requireTenantSchema());
  }

  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Post('complete-setup')
  @ApiOperation({ summary: 'Conclui o setup obrigatório (nome, código, NIF, logo)' })
  completeSetup(@Body() dto: CompleteSetupDto, @CurrentUser() user: JwtPayload) {
    return this.onboarding.completeSetup(user.tenantId, this.ctx.requireTenantSchema(), dto);
  }
}
