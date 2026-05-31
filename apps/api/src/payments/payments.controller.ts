import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import {
  CreatePaymentMethodDto,
  ReviewProofDto,
  UpdatePaymentMethodDto,
} from './dto/payment.dto';
import { PaymentsService } from './payments.service';

/**
 * Back-office de pagamentos da loja (§8). Métodos de pagamento e revisão
 * de comprovativos disponíveis para o gestor da loja (STORE_MANAGER+).
 */
@ApiTags('payments')
@Controller('payments')
@Roles(Role.STORE_MANAGER)
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Métodos de pagamento ────────────────────────────────────
  @Get('methods')
  @ApiOperation({ summary: 'Lista métodos de pagamento configurados' })
  @ApiQuery({ name: 'activeOnly', required: false })
  listMethods(@Query('activeOnly') activeOnly?: string) {
    return this.payments.listMethods(this.ctx.requireTenantSchema(), activeOnly === 'true');
  }

  @Get('methods/:id')
  @ApiOperation({ summary: 'Detalhe de um método de pagamento' })
  getMethod(@Param('id') id: string) {
    return this.payments.getMethod(this.ctx.requireTenantSchema(), id);
  }

  @Post('methods')
  @ApiOperation({ summary: 'Cria um método de pagamento (IBAN/referência/Express/numerário)' })
  createMethod(@Body() dto: CreatePaymentMethodDto) {
    return this.payments.createMethod(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('methods/:id')
  @ApiOperation({ summary: 'Actualiza um método de pagamento' })
  updateMethod(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.payments.updateMethod(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete('methods/:id')
  @ApiOperation({ summary: 'Remove um método de pagamento' })
  deleteMethod(@Param('id') id: string) {
    return this.payments.deleteMethod(this.ctx.requireTenantSchema(), id);
  }

  // ── Comprovativos (revisão pelo gestor) ─────────────────────
  @Get('proofs')
  @ApiOperation({ summary: 'Lista comprovativos enviados pelos clientes' })
  @ApiQuery({ name: 'status', required: false, description: 'PENDING/APPROVED/REJECTED' })
  listProofs(@Query('status') status?: string) {
    return this.payments.listProofs(this.ctx.requireTenantSchema(), status);
  }

  @Get('proofs/:id')
  @ApiOperation({ summary: 'Detalhe de um comprovativo (inclui conteúdo do ficheiro)' })
  getProof(@Param('id') id: string) {
    return this.payments.getProof(this.ctx.requireTenantSchema(), id);
  }

  @Post('proofs/:id/review')
  @ApiOperation({ summary: 'Aprova ou rejeita um comprovativo de pagamento' })
  reviewProof(
    @Param('id') id: string,
    @Body() dto: ReviewProofDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.payments.reviewProof(this.ctx.requireTenantSchema(), id, dto, user?.sub);
  }
}
