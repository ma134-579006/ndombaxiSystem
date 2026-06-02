import {
  BadRequestException,
  Body,
  Controller,
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
import { CreateCustomerDto } from './dto/customer.dto';
import { CancelInvoiceDto, EmitInvoiceDto, ReturnItemsDto } from './dto/emit-invoice.dto';
import { CreateProductDto, UpdateProductDto } from './dto/product.dto';
import { FiscalSigningService } from './fiscal-signing.service';
import { InvoiceService } from './invoice.service';
import { PosRepository } from './pos.repository';
import { SaftService } from './saft.service';

@ApiTags('pos')
@Controller('pos')
export class PosController {
  constructor(
    private readonly repo: PosRepository,
    private readonly invoices: InvoiceService,
    private readonly saft: SaftService,
    private readonly signing: FiscalSigningService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Catálogo de produtos ───────────────────────────────────
  @Get('products')
  @ApiOperation({ summary: 'Lista produtos activos do tenant' })
  listProducts() {
    return this.repo.listProducts(this.ctx.requireTenantSchema());
  }

  @Post('products')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um produto (com imagens p/ a loja online)' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.repo.createProduct(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('products/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Actualiza um produto (imagens, preço, visibilidade online)' })
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.repo.updateProduct(this.ctx.requireTenantSchema(), id, dto);
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
      cashierName: user.email,
      paymentType: dto.paymentType ?? 'CASH',
      tendered: dto.tendered ?? null,
      changeGiven: dto.changeGiven ?? null,
      dueDate: dto.dueDate ?? null,
      lines: dto.lines,
    });
  }

  @Post('invoices/:id/cancel')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Anula uma venda (emite nota de crédito, devolve stock, audita)' })
  cancelInvoice(@Param('id') id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.cancelInvoice(this.ctx.requireTenantSchema(), id, dto.reason, {
      id: user.sub,
      name: user.email,
    });
  }

  @Post('invoices/:id/return')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Devolução parcial (NC só dos artigos devolvidos, repõe stock)' })
  returnItems(@Param('id') id: string, @Body() dto: ReturnItemsDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.returnItems(this.ctx.requireTenantSchema(), id, dto.items, dto.reason, {
      id: user.sub,
      name: user.email,
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
