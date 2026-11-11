import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { MembersService } from './members.service';

/** Gestão dos associados da loja online (aprovação das adesões). */
@ApiTags('ecommerce')
@Controller('ecommerce/members')
export class MembersController {
  constructor(private readonly members: MembersService, private readonly ctx: TenantContext) {}

  @Get()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Pedidos de adesão e associados (filtro por estado)' })
  list(@Query('status') status?: string) {
    return this.members.list(this.ctx.requireTenantSchema(), status);
  }

  @Post(':id/approve')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Aprova a adesão' })
  approve(@Param('id') id: string) {
    return this.members.decide(this.ctx.requireTenantSchema(), id, true);
  }

  @Post(':id/reject')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Recusa a adesão' })
  reject(@Param('id') id: string) {
    return this.members.decide(this.ctx.requireTenantSchema(), id, false);
  }

  @Post(':id/revoke')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Retira o acesso de associado' })
  revoke(@Param('id') id: string) {
    return this.members.revoke(this.ctx.requireTenantSchema(), id);
  }
}
