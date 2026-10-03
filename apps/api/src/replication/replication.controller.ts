import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { tierForRole } from '@nexus/replication';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
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

  // Caixa e acima: cada papel só sobe/desce o que já pode fazer na aplicação
  // (ver `canPushWithTier` / `canPullWithTier` em @nexus/replication). O resto
  // de cada linha é recusado pelo serviço, linha a linha.
  @Post('push')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Recebe um lote de alterações feitas num posto' })
  push(@Body() body: { rows: IncomingRow[] }, @CurrentUser() user: JwtPayload) {
    return this.repl.push(this.ctx.requireTenantSchema(), body?.rows ?? [], tierForRole(user.role));
  }

  @Get('pull')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'O que mudou na nuvem (alterações de outros dispositivos)' })
  pull(
    @CurrentUser() user: JwtPayload,
    @Query('table') table: string,
    @Query('since') since?: string,
    @Query('limit') limit?: string,
  ) {
    return this.repl.pull(
      this.ctx.requireTenantSchema(), table, since ?? null, Number(limit ?? 200) || 200, tierForRole(user.role),
    );
  }

  @Get('conflicts')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Conflitos registados na sincronização (nada se perde em silêncio)' })
  conflicts(@Query('limit') limit?: string) {
    return this.repl.conflicts(this.ctx.requireTenantSchema(), Number(limit ?? 100) || 100);
  }
}
