import { Controller, Get, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { AgtConfigService } from './agt-config.service';
import { AgtCommunicationService } from './agt-communication.service';
import { CompanyIdentityService } from './company-identity.service';

/**
 * Informação fiscal para impressão nos recibos do tenant (legenda AGT + campos
 * livres marcados para o recibo) e identidade da empresa (logo + dados) para os
 * documentos. Disponível a qualquer utilizador autenticado da loja (ex.: caixa).
 */
@ApiTags('fiscal')
@Controller('fiscal')
export class FiscalController {
  constructor(
    private readonly config: AgtConfigService,
    private readonly identity: CompanyIdentityService,
    private readonly comm: AgtCommunicationService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('receipt-info')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Dados fiscais AGT a imprimir no recibo' })
  receiptInfo() {
    return this.config.getReceiptInfo();
  }

  @Get('document-identity')
  @Roles(Role.ATTENDANT)
  @ApiOperation({ summary: 'Identidade da empresa (logo + dados) para os documentos' })
  documentIdentity(@CurrentUser() user: JwtPayload) {
    return this.identity.getDocumentIdentity(user.tenantId, this.ctx.requireTenantSchema());
  }

  // ── Comunicação eletrónica à AGT (DP 71/25) — cada empresa comunica os SEUS
  // documentos usando o contrato (endpoint/credencial) do Super Admin. ──────
  @Get('agt/status')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Estado da comunicação AGT (pendentes/comunicados)' })
  agtStatus() {
    return this.comm.status(this.ctx.requireTenantSchema());
  }

  @Post('agt/communicate')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Comunica à AGT os documentos pendentes desta empresa' })
  agtCommunicate(@CurrentUser() user: JwtPayload) {
    return this.comm.communicate(this.ctx.requireTenantSchema(), { id: user.sub, name: user.name });
  }
}
