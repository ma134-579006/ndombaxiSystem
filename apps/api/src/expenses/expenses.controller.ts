import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/expense.dto';

function actor(u: JwtPayload) {
  return { id: u?.sub ?? null, name: u?.email ?? null };
}

/** Despesas operacionais — só o gestor da empresa (STORE_MANAGER+). */
@ApiTags('expenses')
@Controller('expenses')
@Roles(Role.STORE_MANAGER)
export class ExpensesController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Lista despesas do período (filtro opcional por categoria)' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'category', required: false })
  list(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('category') category?: string,
  ) {
    return this.expenses.list(this.ctx.requireTenantSchema(), from, to, category || undefined);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Total de despesas por categoria no período' })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.expenses.summary(this.ctx.requireTenantSchema(), from, to);
  }

  @Post()
  @ApiOperation({ summary: 'Regista uma despesa (auditada)' })
  create(@Body() dto: CreateExpenseDto, @CurrentUser() u: JwtPayload) {
    return this.expenses.create(this.ctx.requireTenantSchema(), dto, actor(u));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Elimina uma despesa (auditada)' })
  remove(@Param('id') id: string, @CurrentUser() u: JwtPayload) {
    return this.expenses.remove(this.ctx.requireTenantSchema(), id, actor(u));
  }
}
