import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsNumber, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateNested } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenancy/tenant-context';

class PriceGroupDto {
  @IsString() @Length(1, 80) name!: string;
}

class GroupPriceDto {
  @IsUUID() productId!: string;
  /** Preço SEM IVA (como o preço do produto). null = deixa de ter preço próprio no grupo. */
  @IsOptional() @IsNumber() @Min(0) @Max(99_999_999) unitPrice?: number | null;
}

class GroupPricesDto {
  @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => GroupPriceDto) prices!: GroupPriceDto[];
}

/**
 * GRUPOS DE PREÇO (paridade Vendus): cada cliente pode pertencer a um grupo e o
 * grupo tem preços próprios por produto. A venda usa o preço do grupo do cliente
 * (decidido no SERVIDOR — o caixa não envia preços); sem preço no grupo, vale o
 * preço normal do produto.
 */
@ApiTags('pos')
@Controller('pos/price-groups')
export class PriceGroupsController {
  constructor(private readonly prisma: PrismaService, private readonly ctx: TenantContext) {}

  @Get()
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Grupos de preço (com nº de clientes e de preços)' })
  list() {
    return this.prisma.runInTenant(this.ctx.requireTenantSchema(), (tx) => tx.$queryRaw`
      SELECT g.id, g.name, g.created_at,
             (SELECT COUNT(*)::int FROM customers c WHERE c.price_group_id = g.id) AS customers,
             (SELECT COUNT(*)::int FROM price_group_prices p WHERE p.price_group_id = g.id) AS prices
      FROM price_groups g ORDER BY g.name`);
  }

  @Post()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um grupo de preço' })
  async create(@Body() dto: PriceGroupDto) {
    const name = dto.name.trim();
    if (!name) throw new BadRequestException('Indique o nome do grupo.');
    try {
      const rows = await this.prisma.runInTenant(this.ctx.requireTenantSchema(), (tx) => tx.$queryRaw<{ id: string }[]>`
        INSERT INTO price_groups (name) VALUES (${name}) RETURNING id, name, created_at`);
      return rows[0];
    } catch (e) {
      if (String(e).includes('price_groups_name_key') || String(e).includes('23505')) throw new ConflictException('Já existe um grupo com esse nome.');
      throw e;
    }
  }

  @Patch(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Renomeia um grupo de preço' })
  async rename(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PriceGroupDto) {
    const rows = await this.prisma.runInTenant(this.ctx.requireTenantSchema(), (tx) => tx.$queryRaw<{ id: string }[]>`
      UPDATE price_groups SET name = ${dto.name.trim()} WHERE id = ${id}::uuid RETURNING id, name, created_at`)
      .catch((e) => { if (String(e).includes('23505') || String(e).includes('price_groups_name_key')) throw new ConflictException('Já existe um grupo com esse nome.'); throw e; });
    if (!rows[0]) throw new NotFoundException('Grupo não encontrado.');
    return rows[0];
  }

  @Delete(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Apaga um grupo (os clientes ficam sem grupo; os preços do grupo apagam-se)' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    const n = await this.prisma.runInTenant(this.ctx.requireTenantSchema(), (tx) => tx.$executeRaw`DELETE FROM price_groups WHERE id = ${id}::uuid`);
    if (!n) throw new NotFoundException('Grupo não encontrado.');
    return { deleted: true };
  }

  @Get(':id/prices')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Preços do grupo (só os produtos com preço próprio)' })
  prices(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.runInTenant(this.ctx.requireTenantSchema(), (tx) => tx.$queryRaw`
      SELECT p.id AS product_id, p.code, p.name, p.unit_price AS base_price, g.unit_price
      FROM price_group_prices g JOIN products p ON p.id = g.product_id
      WHERE g.price_group_id = ${id}::uuid ORDER BY p.name`);
  }

  @Put(':id/prices')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Define/retira preços do grupo (unitPrice null retira)' })
  async setPrices(@Param('id', ParseUUIDPipe) id: string, @Body() dto: GroupPricesDto) {
    const schema = this.ctx.requireTenantSchema();
    return this.prisma.runInTenant(schema, async (tx) => {
      const g = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM price_groups WHERE id = ${id}::uuid`;
      if (!g[0]) throw new NotFoundException('Grupo não encontrado.');
      let set = 0, removed = 0;
      for (const p of dto.prices) {
        if (p.unitPrice == null) {
          removed += await tx.$executeRaw`DELETE FROM price_group_prices WHERE price_group_id = ${id}::uuid AND product_id = ${p.productId}::uuid`;
        } else {
          set += await tx.$executeRaw(Prisma.sql`
            INSERT INTO price_group_prices (price_group_id, product_id, unit_price)
            SELECT ${id}::uuid, pr.id, ${Math.round(p.unitPrice * 100) / 100} FROM products pr WHERE pr.id = ${p.productId}::uuid
            ON CONFLICT (price_group_id, product_id) DO UPDATE SET unit_price = EXCLUDED.unit_price, updated_at = now()`);
        }
      }
      return { set, removed };
    });
  }
}
