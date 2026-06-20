import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DocumentType } from '@nexus/agt-xml';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { CancelInvoiceDto, EmitInvoiceDto, ReturnItemsDto } from './dto/emit-invoice.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { FiscalSigningService } from './fiscal-signing.service';
import { InvoiceService } from './invoice.service';
import { PosRepository } from './pos.repository';
import { SaftService } from './saft.service';
import { PlanLimitsService } from '../plans/plan-limits.service';

/** Gera um código de barras EAN-13 interno (prefixo 200 = uso interno GS1)
 *  com dígito de controlo válido — usado quando o produto é criado sem código. */
function generateEan13(): string {
  const base = `200${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
}

@ApiTags('pos')
@Controller('pos')
export class PosController {
  constructor(
    private readonly repo: PosRepository,
    private readonly invoices: InvoiceService,
    private readonly saft: SaftService,
    private readonly signing: FiscalSigningService,
    private readonly ctx: TenantContext,
    private readonly planLimits: PlanLimitsService,
  ) {}

  // ── Catálogo de produtos ───────────────────────────────────
  @Get('products')
  @ApiOperation({ summary: 'Lista produtos activos com o stock efectivo da loja do operador' })
  listProducts(@CurrentUser() user: JwtPayload) {
    // O caixa vê o stock da SUA loja (stock por loja); gestor/admin sem loja vê o global.
    return this.repo.listProducts(this.ctx.requireTenantSchema(), user.storeId ?? null);
  }

  @Post('products')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um produto (com imagens p/ a loja online)' })
  async createProduct(@Body() dto: CreateProductDto, @CurrentUser() user: JwtPayload) {
    const schema = this.ctx.requireTenantSchema();
    await this.planLimits.assertCanCreate(schema, 'products'); // limite do plano
    // Código de barras OPCIONAL: vazio → o sistema gera um EAN-13 interno.
    const code = dto.code?.trim() || generateEan13();
    // IVA "Automático" → usa o IVA padrão configurado pelo gestor.
    const ivaCode = dto.ivaCode === 'AUTO' ? await this.repo.defaultIvaCode(schema) : dto.ivaCode;
    // O stock inicial por loja entra na loja de quem cria (se tiver loja atribuída).
    return this.repo.createProduct(schema, {
      ...dto,
      code,
      ivaCode,
      initialStoreId: user.storeId ?? null,
    });
  }

  @Patch('products/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Actualiza um produto (imagens, preço, visibilidade online)' })
  async updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    const schema = this.ctx.requireTenantSchema();
    const ivaCode = dto.ivaCode === 'AUTO' ? await this.repo.defaultIvaCode(schema) : dto.ivaCode;
    return this.repo.updateProduct(schema, id, { ...dto, ivaCode });
  }

  @Delete('products/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina um produto (se sem vendas; senão desativa)' })
  deleteProduct(@Param('id') id: string) {
    return this.repo.deleteProduct(this.ctx.requireTenantSchema(), id);
  }

  // ── Clientes ───────────────────────────────────────────────
  @Get('customers')
  @ApiOperation({ summary: 'Lista clientes do tenant' })
  listCustomers() {
    return this.repo.listCustomers(this.ctx.requireTenantSchema());
  }

  @Post('customers')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Cria um cliente' })
  createCustomer(@Body() dto: CreateCustomerDto) {
    return this.repo.createCustomer(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('customers/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Actualiza um cliente' })
  updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.repo.updateCustomer(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete('customers/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina (ou desativa, se tiver faturas) um cliente' })
  removeCustomer(@Param('id') id: string) {
    return this.repo.removeCustomer(this.ctx.requireTenantSchema(), id);
  }

  // ── Emissão fiscal ─────────────────────────────────────────
  @Post('invoices')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Emite um documento fiscal (FT/FS/...) com hash AGT' })
  emitInvoice(@Body() dto: EmitInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.emit(this.ctx.requireTenantSchema(), {
      docType: dto.docType ?? DocumentType.FT,
      series: dto.series ?? 'A',
      customerId: dto.customerId ?? null,
      cashierId: user.sub,
      cashierName: user.name ?? user.email,
      storeId: user.storeId ?? null,
      paymentType: dto.paymentType ?? 'CASH',
      tendered: dto.tendered ?? null,
      changeGiven: dto.changeGiven ?? null,
      dueDate: dto.dueDate ?? null,
      lines: dto.lines,
    });
  }

  @Get('invoices')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Histórico de vendas (FT/FS) com filtro por datas' })
  listSales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.invoices.listSales(this.ctx.requireTenantSchema(), { from, to });
  }

  @Post('invoices/:id/cancel')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Anula uma venda (só gerente/gestor; NC, devolve stock, audita)' })
  cancelInvoice(@Param('id') id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.cancelInvoice(this.ctx.requireTenantSchema(), id, dto.reason, {
      id: user.sub,
      name: user.name ?? user.email,
    });
  }

  @Post('invoices/:id/return')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Devolução parcial (NC só dos artigos devolvidos, repõe stock)' })
  returnItems(@Param('id') id: string, @Body() dto: ReturnItemsDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.returnItems(this.ctx.requireTenantSchema(), id, dto.items, dto.reason, {
      id: user.sub,
      name: user.name ?? user.email,
    });
  }

  // ── Exportação SAF-T (AGT) ─────────────────────────────────
  @Get('saft')
  @Roles(Role.COMPANY_ADMIN)
  @Header('Content-Type', 'application/xml; charset=utf-8')
  @ApiOperation({ summary: 'Exporta o SAF-T (Angola) mensal em XML' })
  @ApiQuery({ name: 'year', example: 2025 })
  @ApiQuery({ name: 'month', example: 1 })
  saftExport(
    @Query('year') year: string,
    @Query('month') month: string,
    @CurrentUser() user: JwtPayload,
  ) {
    const y = Number(year);
    const m = Number(month);
    if (!Number.isInteger(y) || !Number.isInteger(m)) {
      throw new BadRequestException('year e month são obrigatórios (inteiros)');
    }
    if (!user.tenantId) {
      throw new BadRequestException('Contexto sem tenant');
    }
    return this.saft.exportMonth(user.tenantId, this.ctx.requireTenantSchema(), y, m);
  }

  // ── Chave de assinatura digital RSA-2048 (AGT) ─────────────
  @Post('fiscal/signing-key')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({
    summary: 'Gera/roda a chave de assinatura digital RSA-2048 da empresa',
  })
  provisionSigningKey() {
    return this.signing.provision(this.ctx.requireTenantSchema());
  }

  @Get('fiscal/signing-key')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Chave pública de assinatura activa (para verificação)' })
  activeSigningKey() {
    return this.signing.getActivePublicKey(this.ctx.requireTenantSchema());
  }

  @Get('fiscal/signing-keys')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Histórico de chaves de assinatura (rotação)' })
  listSigningKeys() {
    return this.signing.list(this.ctx.requireTenantSchema());
  }
}
