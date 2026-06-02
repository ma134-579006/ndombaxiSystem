import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { IntegrationsService } from './integrations.service';
import { UpdateIntegrationDto } from './dto/integration.dto';

/** Integrações externas — configuradas 100% pelo Super Admin (§2, §7). */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista integrações (catálogo + estado), sem expor segredos' })
  list() {
    return this.integrations.list();
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Configura uma integração (URL/IDs/segredo encriptado)' })
  update(@Param('key') key: string, @Body() dto: UpdateIntegrationDto) {
    return this.integrations.update(key, dto);
  }

  @Post(':key/test')
  @ApiOperation({ summary: 'Testa a ligação da integração' })
  test(@Param('key') key: string) {
    return this.integrations.test(key);
  }
}
