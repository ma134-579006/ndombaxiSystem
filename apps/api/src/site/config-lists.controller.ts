import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { IsString, Length } from 'class-validator';
import { assertKind, ConfigListsService } from './config-lists.service';

export class ConfigListItemDto {
  @IsString()
  @Length(1, 200)
  label!: string;
}

/** Unidades e Motivos das Notas de Crédito (Configuração › Definições). Ler: todos; mudar: gestor. */
@ApiTags('config-lists')
@Controller('config-lists')
export class ConfigListsController {
  constructor(private readonly lists: ConfigListsService, private readonly ctx: TenantContext) {}

  @Get(':kind')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Itens da lista (units | nc-reasons)' })
  list(@Param('kind') kind: string) {
    return this.lists.list(this.ctx.requireTenantSchema(), assertKind(kind));
  }

  @Post(':kind')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Acrescenta um item à lista' })
  add(@Param('kind') kind: string, @Body() body: ConfigListItemDto) {
    return this.lists.add(this.ctx.requireTenantSchema(), assertKind(kind), body?.label);
  }

  @Patch(':kind/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Muda o nome de um item' })
  rename(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string, @Body() body: ConfigListItemDto) {
    return this.lists.rename(this.ctx.requireTenantSchema(), assertKind(kind), id, body?.label);
  }

  @Delete(':kind/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Apaga um item' })
  remove(@Param('kind') kind: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.lists.remove(this.ctx.requireTenantSchema(), assertKind(kind), id);
  }
}
