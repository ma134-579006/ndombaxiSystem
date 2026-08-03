import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { SnapshotService } from './snapshot.service';

/**
 * Cópia inicial da empresa para o servidor local (ver `snapshot.service.ts`).
 *
 * Reservado ao **COMPANY_ADMIN**: isto devolve tudo o que a empresa tem —
 * vendas, clientes, salários. Um operador de caixa não tem de poder levar isso
 * consigo. O âmbito é sempre o schema do próprio tenant, tirado do token; não
 * há forma de pedir os dados de outra empresa.
 */
@ApiTags('company')
@Controller('company/snapshot')
export class SnapshotController {
  constructor(
    private readonly snapshot: SnapshotService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('tables')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Tabelas da empresa por ordem de dependência, com contagens' })
  tables() {
    return this.snapshot.tables(this.ctx.requireTenantSchema());
  }

  @Get('rows')
  @Roles(Role.COMPANY_ADMIN)
  @ApiQuery({ name: 'table', required: true })
  @ApiQuery({ name: 'offset', required: false })
  @ApiQuery({ name: 'limit', required: false, description: `máx. ${SnapshotService.MAX_LIMIT}` })
  @ApiOperation({ summary: 'Uma página de linhas de uma tabela da empresa' })
  rows(
    @Query('table') table: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.snapshot.rows(
      this.ctx.requireTenantSchema(),
      table,
      Number(offset ?? 0) || 0,
      Number(limit ?? 200) || 200,
    );
  }
}
