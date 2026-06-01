import { Body, Controller, Get, Param, Patch } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { LandingService } from './landing.service';
import { UpdateLandingDto, UpdatePlanDto } from './dto/landing.dto';

/** Landing PÚBLICA — sem autenticação. Conteúdo + planos para a página inicial. */
@ApiTags('public')
@Controller('public')
export class PublicLandingController {
  constructor(private readonly landing: LandingService) {}

  @Public()
  @Get('landing')
  @ApiOperation({ summary: 'Conteúdo da página inicial (hero, features, anúncios) + planos públicos' })
  getLanding() {
    return this.landing.getPublicLanding();
  }

  @Public()
  @Get('plans')
  @ApiOperation({ summary: 'Lista de planos públicos com preços em Kwanzas' })
  getPlans() {
    return this.landing.listPublicPlans();
  }
}

/** Gestão da landing + planos — só o Super Admin ("deus do sistema"). */
@ApiTags('super-admin')
@Controller('super-admin/landing')
@Roles(Role.SUPER_ADMIN)
export class LandingAdminController {
  constructor(private readonly landing: LandingService) {}

  @Get()
  @ApiOperation({ summary: 'Lê o conteúdo da landing para edição' })
  get() {
    return this.landing.get();
  }

  @Patch()
  @ApiOperation({ summary: 'Edita o conteúdo da landing (hero, imagens, textos, anúncios)' })
  update(@Body() dto: UpdateLandingDto) {
    return this.landing.update(dto);
  }

  @Get('plans')
  @ApiOperation({ summary: 'Lista todos os planos para gestão' })
  listPlans() {
    return this.landing.listPlans();
  }

  @Patch('plans/:id')
  @ApiOperation({ summary: 'Edita um plano (preço em Kz, limites, apresentação)' })
  updatePlan(@Param('id') id: string, @Body() dto: UpdatePlanDto) {
    return this.landing.updatePlan(id, dto);
  }
}
