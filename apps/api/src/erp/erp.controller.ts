import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateSupplierDto } from './dto/supplier.dto';
import { CreateWarehouseDto } from './dto/warehouse.dto';
import { AdjustStockDto, StockEntryDto } from './dto/stock.dto';
import { CreatePurchaseOrderDto } from './dto/purchase-order.dto';
import { ErpRepository } from './erp.repository';
import { StockService } from './stock.service';
import { PurchasingService } from './purchasing.service';

@ApiTags('erp')
@Controller('erp')
export class ErpController {
  constructor(
    private readonly repo: ErpRepository,
    private readonly stock: StockService,
    private readonly purchasing: PurchasingService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Fornecedores ───────────────────────────────────────────
  @Get('suppliers')
  @ApiOperation({ summary: 'Lista fornecedores' })
  listSuppliers() {
    return this.repo.listSuppliers(this.ctx.requireTenantSchema());
  }

  @Post('suppliers')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria fornecedor' })
  createSupplier(@Body() dto: CreateSupplierDto) {
    return this.repo.createSupplier(this.ctx.requireTenantSchema(), dto);
  }

  // ── Armazéns ───────────────────────────────────────────────
  @Get('warehouses')
  @ApiOperation({ summary: 'Lista armazéns' })
  listWarehouses() {
    return this.repo.listWarehouses(this.ctx.requireTenantSchema());
  }

  @Post('warehouses')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria armazém' })
  createWarehouse(@Body() dto: CreateWarehouseDto) {
    return this.repo.createWarehouse(this.ctx.requireTenantSchema(), dto);
  }

  // ── Stock ──────────────────────────────────────────────────
  @Get('stock')
  @ApiOperation({ summary: 'Saldos de stock por produto/armazém' })
  listStock() {
    return this.repo.listStock(this.ctx.requireTenantSchema());
  }

  @Get('stock/low')
  @ApiOperation({ summary: 'Produtos abaixo do stock mínimo' })
  listLowStock() {
    return this.repo.listLowStock(this.ctx.requireTenantSchema());
  }

  @Get('stock/movements')
  @ApiOperation({ summary: 'Movimentos de stock (consulta com filtros)' })
  listMovements(
    @Query('q') q?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.stock.listMovements(this.ctx.requireTenantSchema(), { q, warehouseId, from, to });
  }

  @Get('stock/categories')
  @ApiOperation({ summary: 'Categorias de produto (para filtros)' })
  listCategories() {
    return this.repo.listCategories(this.ctx.requireTenantSchema());
  }

  @Get('stock/analysis')
  @ApiOperation({ summary: 'Análise de stock (valor, vendas, previsão) com filtros' })
  stockAnalysis(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('warehouseId') warehouseId?: string,
    @Query('categoryId') categoryId?: string,
    @Query('state') state?: 'all' | 'positive' | 'zero' | 'negative' | 'low',
  ) {
    return this.stock.stockAnalysis(this.ctx.requireTenantSchema(), { from, to, warehouseId, categoryId, state });
  }

  @Post('stock/adjust')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Acerto de inventário (define saldo absoluto)' })
  adjustStock(@Body() dto: AdjustStockDto, @CurrentUser() user: JwtPayload) {
    return this.stock.adjust(this.ctx.requireTenantSchema(), {
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      newQuantity: dto.newQuantity,
      reason: dto.reason,
      createdBy: user.sub,
    });
  }

  @Post('stock/entry')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Entrada de stock em lote (actualiza custo e preço; lucro automático)' })
  stockEntry(@Body() dto: StockEntryDto, @CurrentUser() user: JwtPayload) {
    return this.stock.stockEntry(this.ctx.requireTenantSchema(), {
      productId: dto.productId,
      warehouseId: dto.warehouseId,
      quantity: dto.quantity,
      unitCost: dto.unitCost,
      salePrice: dto.salePrice ?? null,
      batchCode: dto.batchCode ?? null,
      expiryDate: dto.expiryDate ?? null,
      minQty: dto.minQty ?? null,
      createdBy: user.sub,
    });
  }

  // ── Compras ────────────────────────────────────────────────
  @Get('purchase-orders')
  @ApiOperation({ summary: 'Lista encomendas de compra' })
  listPurchaseOrders() {
    return this.purchasing.list(this.ctx.requireTenantSchema());
  }

  @Post('purchase-orders')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria encomenda de compra (DRAFT)' })
  createPurchaseOrder(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: JwtPayload) {
    return this.purchasing.create(this.ctx.requireTenantSchema(), {
      supplierId: dto.supplierId,
      warehouseId: dto.warehouseId,
      expectedDate: dto.expectedDate ?? null,
      notes: dto.notes ?? null,
      createdBy: user.sub,
      lines: dto.lines,
    });
  }

  @Post('purchase-orders/:id/confirm')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Confirma a encomenda (DRAFT → CONFIRMED)' })
  async confirmPurchaseOrder(@Param('id') id: string) {
    await this.purchasing.confirm(this.ctx.requireTenantSchema(), id);
    return { status: 'CONFIRMED' };
  }

  @Post('purchase-orders/:id/receive')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Receciona a encomenda e dá entrada em stock' })
  receivePurchaseOrder(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    return this.purchasing.receive(this.ctx.requireTenantSchema(), id, user.sub);
  }
}
