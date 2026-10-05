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
import { localSeries } from '../common/device-series';
import { TenantContext } from '../tenancy/tenant-context';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { SaveCartDraftDto } from './dto/cart-draft.dto';
import { CancelInvoiceDto, EmitInvoiceDto, ReturnItemsDto } from './dto/emit-invoice.dto';
import { CreateProductDto, DeleteProductsDto, UpdateProductDto } from './dto/product.dto';
import { FiscalSigningService } from './fiscal-signing.service';
import { InvoiceService } from './invoice.service';
import { PosRepository } from './pos.repository';
import { SaftService } from './saft.service';
import { PlanLimitsService } from '../plans/plan-limits.service';
import { DevicesService } from '../devices/devices.service';

/** Gera um código de barras EAN-13 interno (prefixo 200 = uso interno GS1)
 *  com dígito de controlo válido — usado quando o produto é criado sem código. */
function generateEan13(): string {
  const base = `200${String(Date.now()).slice(-7)}${String(Math.floor(Math.random() * 100)).padStart(2, '0')}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  return base + String((10 - (sum % 10)) % 10);
}

/**
 * A segunda gravação da MESMA venda bateu no índice único `client_op_id`.
 * Reconhecido pelo código 23505 do Postgres (violação de restrição única) e pelo
 * nome do índice — para não confundir com outra restrição qualquer da tabela.
 */
function isDuplicateOpViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return (msg.includes('23505') || /duplicate key value/i.test(msg))
    && msg.includes('invoices_client_op_uidx');
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
    private readonly devices: DevicesService,
  ) {}

  // ── Catálogo de produtos ───────────────────────────────────
  @Get('products')
  @ApiOperation({ summary: 'Lista produtos activos com o stock efectivo da loja do operador' })
  @ApiQuery({ name: 'q', required: false, description: 'Pesquisa: código/barras exatos, nome ou marca' })
  @ApiQuery({ name: 'limit', required: false, description: 'Página (máx. 5000). Sem limit devolve tudo (apps antigas).' })
  @ApiQuery({ name: 'offset', required: false })
  listProducts(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    // O caixa vê o stock da SUA loja (stock por loja); gestor/admin sem loja vê o global.
    return this.repo.listProducts(this.ctx.requireTenantSchema(), user.storeId ?? null, false, pageOpts(q, limit, offset));
  }

  @Get('products/changes')
  @ApiOperation({ summary: 'Alterações do catálogo desde um momento (memória interna das apps, aos poucos)' })
  @ApiQuery({ name: 'since', required: false }) @ApiQuery({ name: 'after', required: false }) @ApiQuery({ name: 'limit', required: false })
  async productChanges(
    @CurrentUser() user: JwtPayload,
    @Query('since') since?: string, @Query('after') after?: string, @Query('limit') limit?: string,
  ) {
    const lim = Math.min(Math.max(1, Number(limit) || 2000), 5000);
    const items = await this.repo.listProducts(this.ctx.requireTenantSchema(), user.storeId ?? null, true, {
      changesSince: since ?? '', afterId: after || undefined, limit: lim,
    });
    // Cursor com a precisão TOTAL do Postgres (microssegundos, em texto): em ms,
    // linhas gravadas no mesmo instante faziam o cursor voltar sempre ao início.
    const last = items[items.length - 1] as (typeof items)[number] & { updated_cursor?: string };
    const next = items.length === lim && last ? { since: last.updated_cursor ?? '', after: last.id } : null;
    return { items, next };
  }

  @Get('products/all')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Catálogo completo para o gestor: inclui produtos inativos' })
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'offset', required: false })
  listAllProducts(
    @CurrentUser() user: JwtPayload,
    @Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string,
  ) {
    return this.repo.listProducts(this.ctx.requireTenantSchema(), user.storeId ?? null, true, pageOpts(q, limit, offset));
  }

  @Get('products/ingredients')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Lista ingredientes/matéria-prima (para a ficha técnica dos pratos)' })
  listIngredients() {
    return this.repo.listIngredients(this.ctx.requireTenantSchema());
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

  @Post('products/bulk-delete')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina vários produtos de uma vez (os com vendas são só desativados)' })
  deleteProducts(@Body() dto: DeleteProductsDto) {
    return this.repo.deleteProducts(this.ctx.requireTenantSchema(), dto.ids);
  }

  @Delete('products/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina um produto (se sem vendas; senão desativa)' })
  deleteProduct(@Param('id') id: string) {
    return this.repo.deleteProduct(this.ctx.requireTenantSchema(), id);
  }

  // ── Clientes ───────────────────────────────────────────────
  @Get('customers/changes')
  @ApiOperation({ summary: 'Alterações de clientes desde um momento (memória interna das apps)' })
  async customerChanges(@Query('since') since?: string, @Query('after') after?: string, @Query('limit') limit?: string) {
    const lim = Math.min(Math.max(1, Number(limit) || 2000), 5000);
    const items = await this.repo.listCustomerChanges(this.ctx.requireTenantSchema(), since ?? '', after || undefined, lim);
    const last = items[items.length - 1];
    return { items, next: items.length === lim && last ? { since: last.updated_cursor, after: last.id } : null };
  }

  @Get('customers')
  @ApiOperation({ summary: 'Lista clientes do tenant' })
  @ApiQuery({ name: 'q', required: false }) @ApiQuery({ name: 'limit', required: false }) @ApiQuery({ name: 'offset', required: false })
  listCustomers(@Query('q') q?: string, @Query('limit') limit?: string, @Query('offset') offset?: string) {
    return this.repo.listCustomers(this.ctx.requireTenantSchema(), pageOpts(q, limit, offset));
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

  // ── Rascunho do carrinho (cross-device, por operador) ──────
  @Get('cart-draft')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Lê o rascunho do carrinho do operador (segue-o em qualquer dispositivo)' })
  getCartDraft(@CurrentUser() user: JwtPayload) {
    return this.repo.getCartDraft(this.ctx.requireTenantSchema(), user.sub);
  }

  @Post('cart-draft')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Guarda o rascunho do carrinho do operador' })
  saveCartDraft(@Body() dto: SaveCartDraftDto, @CurrentUser() user: JwtPayload) {
    return this.repo.saveCartDraft(this.ctx.requireTenantSchema(), user.sub, dto);
  }

  @Delete('cart-draft')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Limpa o rascunho do carrinho do operador' })
  clearCartDraft(@CurrentUser() user: JwtPayload) {
    return this.repo.clearCartDraft(this.ctx.requireTenantSchema(), user.sub);
  }

  // ── Emissão fiscal ─────────────────────────────────────────
  @Post('invoices')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Emite um documento fiscal (FT/FS/...) com hash AGT' })
  async emitInvoice(@Body() dto: EmitInvoiceDto, @CurrentUser() user: JwtPayload) {
    const schema = this.ctx.requireTenantSchema();
    // SÉRIE DO POSTO — e não a que o cliente pedir.
    //
    // Cada documento leva o hash do anterior da mesma série: se dois postos
    // emitirem na mesma série sem rede, ficam duas cadeias divergentes com a
    // mesma numeração, e isso não se corrige depois (os documentos já foram
    // entregues a clientes). Por isso a série vem do REGISTO do posto e o
    // pedido não a pode escolher.
    //
    // Posto não registado → 'A', como sempre. É deliberado: as aplicações já
    // instaladas ainda não se registam, e recusar a venda deixaria lojas
    // paradas por causa de uma funcionalidade nova.
    const deviceSeries = await this.devices.seriesFor(schema, dto.deviceKey);
    try {
      return await this.invoices.emit(schema, {
        // Pelo caixa só se VENDE (FT/FS). Notas de crédito nascem da anulação/devolução;
        // um "NC" pedido aqui baixava stock e contava como venda no turno.
        docType: dto.docType === DocumentType.FS ? DocumentType.FS : DocumentType.FT,
        // Servidor local de um posto: série própria do posto (DEVICE_SERIES).
        series: deviceSeries ?? localSeries() ?? dto.series ?? 'A',
        customerId: dto.customerId ?? null,
        cashierId: user.sub,
        cashierName: user.name ?? user.email,
        storeId: user.storeId ?? null,
        paymentType: dto.paymentType ?? 'CASH',
        tendered: dto.tendered ?? null,
        changeGiven: dto.changeGiven ?? null,
        dueDate: dto.dueDate ?? null,
        operationDate: dto.operationDate ?? null,
        clientOpId: dto.clientOpId ?? null,
        offline: dto.offline === true,
        lines: dto.lines,
      });
    } catch (e) {
      // A venda JÁ tinha sido emitida com esta chave: a resposta anterior
      // perdeu-se no caminho e o posto reenviou. Não é erro — é a idempotência
      // a funcionar. Devolvemos o documento ORIGINAL para o posto ficar com o
      // número fiscal verdadeiro e imprimir o recibo certo, em vez de criar uma
      // segunda fatura (com stock e dinheiro em dobro).
      if (dto.clientOpId && isDuplicateOpViolation(e)) {
        const existing = await this.invoices.findByClientOpId(schema, dto.clientOpId);
        if (existing) return existing;
      }
      throw e;
    }
  }

  @Get('invoices')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Histórico de vendas (FT/FS) com filtro por datas' })
  listSales(@Query('from') from?: string, @Query('to') to?: string) {
    return this.invoices.listSales(this.ctx.requireTenantSchema(), { from, to });
  }

  @Get('invoices/:id')
  @Roles(Role.CASHIER)
  @ApiOperation({ summary: 'Detalhe de um documento para REIMPRESSÃO (2ª via)' })
  getSale(@Param('id') id: string) {
    return this.invoices.getSaleDetail(this.ctx.requireTenantSchema(), id);
  }

  @Post('invoices/:id/cancel')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Anula uma venda (só gerente/gestor; NC, devolve stock, audita)' })
  cancelInvoice(@Param('id') id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() user: JwtPayload) {
    return this.invoices.cancelInvoice(this.ctx.requireTenantSchema(), id, dto.reason, {
      id: user.sub,
      name: user.name ?? user.email,
      storeId: user.storeId ?? null,
      role: user.role,
    });
  }

  @Post('invoices/:id/return')
  @Roles(Role.SHIFT_SUPERVISOR)
  @ApiOperation({ summary: 'Devolução parcial (NC só dos artigos devolvidos, repõe stock)' })
  async returnItems(@Param('id') id: string, @Body() dto: ReturnItemsDto, @CurrentUser() user: JwtPayload) {
    const schema = this.ctx.requireTenantSchema();
    try {
      return await this.invoices.returnItems(
        schema, id, dto.items, dto.reason,
        { id: user.sub, name: user.name ?? user.email, storeId: user.storeId ?? null, role: user.role },
        dto.clientOpId ?? null,
      );
    } catch (e) {
      // Esta devolução JÁ foi feita e só a resposta se perdeu. Devolvemos a nota
      // de crédito ORIGINAL em vez de criar uma segunda (que reporia stock e
      // estornaria dinheiro pela segunda vez).
      if (dto.clientOpId && isDuplicateOpViolation(e)) {
        const nc = await this.invoices.findByClientOpId(schema, dto.clientOpId);
        if (nc) return { creditNoteNumber: nc.number, refundTotal: nc.grossTotal };
      }
      throw e;
    }
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

/** Opções de página/pesquisa do catálogo (só com `limit` — sem ele, lista completa). */
function pageOpts(q?: string, limit?: string, offset?: string) {
  if (limit === undefined && !q) return undefined;
  return { q: q ?? '', limit: Number(limit) || 200, offset: Number(offset) || 0 };
}
