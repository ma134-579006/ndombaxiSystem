import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ReplicationService, type IncomingRow } from './replication.service';

/**
 * O que os postos sobem para a nuvem depois de trabalharem sem internet.
 *
 * Reservado ao COMPANY_ADMIN — que é o papel com que o posto se provisiona e
 * replica. Um operador de caixa não empurra dados de tabelas arbitrárias.
 */
@ApiTags('replication')
@Controller('replication')
export class ReplicationController {
  constructor(
    private readonly repl: ReplicationService,
    private readonly ctx: TenantContext,
  ) {}

  @Post('push')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Recebe um lote de alterações feitas num posto' })
  push(@Body() body: { rows: IncomingRow[] }) {
    return this.repl.push(this.ctx.requireTenantSchema(), body?.rows ?? []);
  }

  @Get('conflicts')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Conflitos registados na sincronização (nada se perde em silêncio)' })
  conflicts(@Query('limit') limit?: string) {
    return this.repl.conflicts(this.ctx.requireTenantSchema(), Number(limit ?? 100) || 100);
  }
}
