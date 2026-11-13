import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
const CODE_THROTTLE = { default: { limit: 12, ttl: 60_000 } };
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { KwanzaService } from './kwanza.service';

class RegisterDto { @IsString() @MaxLength(120) name!: string; @IsString() @MaxLength(20) phone!: string; @IsOptional() @IsString() @MaxLength(160) email?: string; @IsString() @MaxLength(100) password!: string; }
class LoginDto { @IsString() @MaxLength(160) login!: string; @IsString() @MaxLength(100) password!: string; @IsOptional() @IsString() @MaxLength(10) twoFaCode?: string; @IsOptional() @IsBoolean() twoFaResend?: boolean; }
class ProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string; @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(1_500_000) photoUrl?: string | null; @IsOptional() @IsString() @MaxLength(20) taxId?: string;
  @IsOptional() @IsString() @MaxLength(60) province?: string; @IsOptional() @IsString() @MaxLength(60) municipality?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string; @IsOptional() @IsString() @MaxLength(400) bio?: string;
}
class PasswordDto { @IsString() @MaxLength(100) current!: string; @IsString() @MaxLength(100) next!: string; @IsOptional() @IsString() @MaxLength(10) twoFaCode?: string; }
class RecoverDto { @IsString() @MaxLength(160) login!: string; @IsOptional() @IsIn(['EMAIL', 'WHATSAPP']) via?: 'EMAIL' | 'WHATSAPP'; }
class RecoverConfirmDto { @IsString() @MaxLength(160) login!: string; @IsString() @MaxLength(10) code!: string; @IsString() @MaxLength(100) password!: string; @IsOptional() @IsString() @MaxLength(10) twoFaCode?: string; @IsOptional() @IsBoolean() twoFaResend?: boolean; }
class TwoFaSetupDto { @IsIn(['EMAIL', 'WHATSAPP']) method!: 'EMAIL' | 'WHATSAPP'; @IsOptional() @IsString() @MaxLength(160) target?: string; }
class TwoFaCodeDto { @IsString() @MaxLength(10) code!: string; }
class AffiliateDto { @IsString() @MaxLength(60) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; @IsOptional() @IsString() @MaxLength(300) note?: string; }
class MarkupDto { @IsString() @MaxLength(60) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) markupPct?: number | null; }
class AccountDto { @IsString() @MaxLength(40) method!: string; @IsOptional() @IsString() @MaxLength(60) bank?: string; @IsString() @MaxLength(120) holder!: string; @IsString() @MaxLength(60) details!: string; }
class IdsDto { @IsArray() @IsString({ each: true }) ids!: string[]; }
class MsgDto { @IsString() @MaxLength(2000) body!: string; }
class PostDto { @IsString() @MaxLength(60) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number | null; @IsOptional() @IsArray() @IsString({ each: true }) images?: string[]; @IsOptional() @IsString() @MaxLength(500) videoUrl?: string | null; @IsOptional() @IsString() @MaxLength(600) caption?: string | null; @IsBoolean() published!: boolean; }
class WithdrawDto { @IsString() @MaxLength(60) companyCode!: string; @Type(() => Number) @IsNumber() @Min(1) amount!: number; @IsString() @MaxLength(40) accountId!: string; @IsOptional() @IsString() @MaxLength(10) twoFaCode?: string; @IsOptional() @IsBoolean() twoFaResend?: boolean; }

/** LPS Kwanza — site do marketplace e contas dos associados (público + sessão do associado). */
@ApiTags('kwanza')
@Public()
@Controller('kwanza')
export class KwanzaPublicController {
  constructor(private readonly k: KwanzaService) {}

  @Post('auth/register') @ApiOperation({ summary: 'Cria conta de associado' })
  register(@Body() d: RegisterDto) { return this.k.register(d); }
  @Post('auth/login') @ApiOperation({ summary: 'Entrar (telefone ou email + senha)' })
  login(@Body() d: LoginDto) { return this.k.login(d); }
  @Post('auth/recover') @ApiOperation({ summary: 'Pede o código para recuperar a senha (email)' })
  recover(@Body() d: RecoverDto) { return this.k.recoverRequest(d.login, d.via); }
  @Post('auth/recover/confirm') @ApiOperation({ summary: 'Define a nova senha com o código' })
  recoverConfirm(@Body() d: RecoverConfirmDto) { return this.k.recoverConfirm(d.login, d.code, d.password, d.twoFaCode, d.twoFaResend === true); }

  @Get('market') @ApiOperation({ summary: 'Produtos de todas as empresas no marketplace' })
  async market(@Headers('authorization') a?: string) {
    // Com sessão de associado válida → catálogo completo (para se afiliar); sem → só as publicações dos associados.
    const isAssociate = a ? await this.k.verify(a).then(() => true, () => false) : false;
    return this.k.market(isAssociate);
  }
  @Post('market/:companyCode/:productCode/view') @ApiOperation({ summary: 'Conta uma visualização' })
  view(@Param('companyCode') c: string, @Param('productCode') p: string) { return this.k.view(c, p); }

  @Get('me') async me(@Headers('authorization') a?: string) { return this.k.me(await this.k.verify(a)); }
  @Put('me') async profile(@Body() d: ProfileDto, @Headers('authorization') a?: string) { return this.k.updateProfile(await this.k.verify(a), d); }
  @Post('me/password') async password(@Body() d: PasswordDto, @Headers('authorization') a?: string) { return this.k.changePassword(await this.k.verify(a), d.current, d.next, d.twoFaCode); }
  @Get('me/two-factor') async tfStatus(@Headers('authorization') a?: string) { return this.k.twoFaStatus(await this.k.verify(a)); }
  @Throttle(CODE_THROTTLE) @Post('me/two-factor/setup') async tfSetup(@Body() d: TwoFaSetupDto, @Headers('authorization') a?: string) { return this.k.twoFaSetup(await this.k.verify(a), d.method, d.target); }
  @Throttle(CODE_THROTTLE) @Post('me/two-factor/confirm') async tfConfirm(@Body() d: TwoFaCodeDto, @Headers('authorization') a?: string) { return this.k.twoFaConfirm(await this.k.verify(a), d.code); }
  @Throttle(CODE_THROTTLE) @Post('me/two-factor/disable/request') async tfDisableReq(@Headers('authorization') a?: string) { return this.k.twoFaDisableRequest(await this.k.verify(a)); }
  @Throttle(CODE_THROTTLE) @Post('me/two-factor/disable') async tfDisable(@Body() d: TwoFaCodeDto, @Headers('authorization') a?: string) { return this.k.twoFaDisable(await this.k.verify(a), d.code); }
  @Throttle(CODE_THROTTLE) @Post('me/two-factor/code') async tfCode(@Headers('authorization') a?: string) { return this.k.twoFaCode(await this.k.verify(a)); }
  @Get('me/dashboard') async dashboard(@Headers('authorization') a?: string) { return this.k.dashboard(await this.k.verify(a)); }
  @Get('me/affiliations') async affiliations(@Headers('authorization') a?: string) { return this.k.myAffiliations(await this.k.verify(a)); }
  @Post('me/affiliations') async affiliate(@Body() d: AffiliateDto, @Headers('authorization') a?: string) { return this.k.affiliate(await this.k.verify(a), d.companyCode, d.productCode, d.note); }
  @Put('me/posts') async post(@Body() d: PostDto, @Headers('authorization') a?: string) { return this.k.savePost(await this.k.verify(a), d.companyCode, d.productCode, d); }
  @Post('me/markup') async markup(@Body() d: MarkupDto, @Headers('authorization') a?: string) { return this.k.setMarkup(await this.k.verify(a), d.companyCode, d.productCode, d.markupPct ?? null); }
  @Get('me/accounts') async accounts(@Headers('authorization') a?: string) { return this.k.accounts(await this.k.verify(a)); }
  @Post('me/accounts') async addAccount(@Body() d: AccountDto, @Headers('authorization') a?: string) { return this.k.addAccount(await this.k.verify(a), d); }
  @Delete('me/accounts/:id') async removeAccount(@Param('id') id: string, @Headers('authorization') a?: string) { return this.k.removeAccount(await this.k.verify(a), id); }
  @Get('me/notifications') async notes(@Headers('authorization') a?: string) { return this.k.notifications(await this.k.verify(a)); }
  @Post('me/notifications/read') async notesRead(@Body() d: IdsDto, @Headers('authorization') a?: string) { return this.k.markNotifications(await this.k.verify(a), d.ids, true); }
  @Post('me/notifications/unread') async notesUnread(@Body() d: IdsDto, @Headers('authorization') a?: string) { return this.k.markNotifications(await this.k.verify(a), d.ids, false); }
  @Post('me/notifications/read-all') async notesReadAll(@Headers('authorization') a?: string) { return this.k.markNotifications(await this.k.verify(a), 'all'); }
  @Post('me/notifications/delete') async notesDelete(@Body() d: IdsDto, @Headers('authorization') a?: string) { return this.k.deleteNotifications(await this.k.verify(a), d.ids); }
  @Delete('me/notifications') async notesDeleteAll(@Headers('authorization') a?: string) { return this.k.deleteNotifications(await this.k.verify(a), 'all'); }
  @Get('me/chats') async chats(@Headers('authorization') a?: string) { return this.k.associateChats(await this.k.verify(a)); }
  @Get('me/chats/:companyCode') async chat(@Param('companyCode') c: string, @Headers('authorization') a?: string) { return this.k.associateThread(await this.k.verify(a), c); }
  @Post('me/chats/:companyCode') async send(@Param('companyCode') c: string, @Body() d: MsgDto, @Headers('authorization') a?: string) { return this.k.associateSend(await this.k.verify(a), c, d.body); }
  @Post('me/withdrawals') async withdraw(@Body() d: WithdrawDto, @Headers('authorization') a?: string) { return this.k.withdraw(await this.k.verify(a), d.companyCode, d.amount, d.accountId, d.twoFaCode, d.twoFaResend === true); }
}

class ListingDto {
  @IsBoolean() published!: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) percent?: number | null;
  @IsOptional() @IsIn(['OPEN', 'RESTRICTED']) mode?: 'OPEN' | 'RESTRICTED';
  @IsOptional() @IsBoolean() allowMarkup?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) maxMarkupPct?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) materials?: string[];
}
class BulkListingDto {
  @IsOptional() @IsArray() @ArrayMaxSize(5000) @IsString({ each: true }) codes?: string[];
  @IsOptional() @IsBoolean() all?: boolean;
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) percent?: number | null;
  @IsOptional() @IsIn(['OPEN', 'RESTRICTED']) mode?: 'OPEN' | 'RESTRICTED';
  @IsOptional() @IsBoolean() allowMarkup?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) maxMarkupPct?: number | null;
}
class DecideDto { @IsOptional() @IsIn(['APPROVED', 'REJECTED']) status?: 'APPROVED' | 'REJECTED'; @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) commissionPct?: number | null; }
class MsgAdminDto { @IsString() @MaxLength(2000) body!: string; }
class PostponeDto { @IsString() @MaxLength(300) note!: string; @IsString() @MaxLength(40) until!: string; }
class PayDto { @IsOptional() @IsString() @MaxLength(300) note?: string; @IsOptional() @IsString() @MaxLength(3_000_000) proofUrl?: string; }

/** LPS Kwanza no painel LPS Vendas de cada empresa: produtos publicados, pedidos, associados e saques. */
@ApiTags('kwanza')
@Controller('ecommerce/kwanza')
export class KwanzaAdminController {
  constructor(private readonly k: KwanzaService, private readonly ctx: TenantContext, private readonly prisma: PrismaService) {}
  private async tenant() {
    const schema = this.ctx.requireTenantSchema();
    const c = await this.prisma.company.findUnique({ where: { schemaName: schema } });
    return { companyId: c!.id, schema };
  }

  @Get('products') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Produtos e definições do LPS Kwanza' })
  products(@Query('q') q?: string) { return this.k.companyProducts(this.ctx.requireTenantSchema(), q); }
  @Post('products/bulk') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Configura vários produtos de uma vez (marcados ou todos)' })
  async saveBulk(@Body() d: BulkListingDto) { return this.k.saveCompanyProductsBulk(await this.tenant(), d); }
  @Patch('products/:code') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Publica/altera um produto no LPS Kwanza' })
  async save(@Param('code') code: string, @Body() d: ListingDto) { return this.k.saveCompanyProduct(await this.tenant(), code, d); }
  @Post('sync') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Atualiza preços e stock no marketplace' })
  async sync() { const t = await this.tenant(); await this.k.syncCompany(t.companyId); return { ok: true }; }
  @Get('requests') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Pedidos de afiliação dos associados' })
  async requests() { return this.k.companyRequests((await this.tenant()).companyId); }
  @Patch('requests/:id') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Aprova/recusa ou negoceia a % de um associado' })
  async decide(@Param('id') id: string, @Body() d: DecideDto) { return this.k.decideRequest((await this.tenant()).companyId, id, d); }
  @Get('associates') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Associados que vendem os produtos da empresa' })
  async associates() { const t = await this.tenant(); return this.k.companyAssociates(t.companyId, t.schema); }
  @Get('sales') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Vendas feitas por associados' })
  async sales() { return this.k.companySales((await this.tenant()).companyId); }
  @Get('chats') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Conversas com associados' })
  async chats() { return this.k.companyChats((await this.tenant()).companyId); }
  @Get('chats/:associateId') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Conversa com um associado' })
  async chat(@Param('associateId') id: string) { return this.k.companyThread((await this.tenant()).companyId, id); }
  @Post('chats/:associateId') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Responde a um associado' })
  async send(@Param('associateId') id: string, @Body() d: MsgAdminDto) { return this.k.companySend((await this.tenant()).companyId, id, 'Empresa', d.body); }
  @Get('withdrawals') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Pedidos de saque dos associados' })
  async withdrawals() { return this.k.companyWithdrawals((await this.tenant()).companyId); }
  @Post('withdrawals/:id/pay') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Marca o saque como pago (com comprovativo)' })
  async pay(@Param('id') id: string, @Body() d: PayDto) { return this.k.decideWithdrawal((await this.tenant()).companyId, id, true, d.note, d.proofUrl); }
  @Post('withdrawals/:id/reject') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Recusar já não é permitido (use adiar)' })
  async reject(@Param('id') id: string, @Body() d: PayDto) { return this.k.decideWithdrawal((await this.tenant()).companyId, id, false, d.note); }
  @Post('withdrawals/:id/postpone') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Adia o saque (uma vez, com motivo e nova data)' })
  async postpone(@Param('id') id: string, @Body() d: PostponeDto) { return this.k.postponeWithdrawal((await this.tenant()).companyId, id, d.note, d.until); }
}
