import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { MigrationFileDto } from './dto/migration.dto';
import { MigrationService } from './migration.service';

/** Migração inteligente de dados de outros sistemas (Vendus, Primavera, PHC/
 *  "Negócio", Excel genérico) — produtos, clientes e fornecedores. */
@ApiTags('migration')
@Controller('migration')
@Roles(Role.COMPANY_ADMIN)
export class MigrationController {
  constructor(
    private readonly svc: MigrationService,
    private readonly ctx: TenantContext,
  ) {}

  @Post('preview')
  @ApiOperation({ summary: 'Pré-visualiza a importação — nunca escreve na base de dados' })
  preview(@Body() dto: MigrationFileDto) {
    const buf = Buffer.from(dto.contentBase64, 'base64');
    return this.svc.preview(this.ctx.requireTenantSchema(), dto.kind, buf, dto.fileName);
  }

  @Post('apply')
  @ApiOperation({ summary: 'Aplica a importação (upsert por código/NIF/nome; nunca apaga nada)' })
  apply(@Body() dto: MigrationFileDto, @CurrentUser() user: JwtPayload) {
    const buf = Buffer.from(dto.contentBase64, 'base64');
    return this.svc.apply(this.ctx.requireTenantSchema(), dto.kind, buf, dto.fileName, { id: user.sub, name: user.name });
  }
}
