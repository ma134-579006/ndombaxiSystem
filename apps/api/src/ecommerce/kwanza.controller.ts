import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { PrismaService } from '../prisma/prisma.service';
import { KwanzaService } from './kwanza.service';

class RegisterDto { @IsString() @MaxLength(120) name!: string; @IsString() @MaxLength(20) phone!: string; @IsOptional() @IsString() @MaxLength(160) email?: string; @IsString() @MaxLength(100) password!: string; }
class LoginDto { @IsString() @MaxLength(160) login!: string; @IsString() @MaxLength(100) password!: string; }
class ProfileDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string; @IsOptional() @IsString() @MaxLength(160) email?: string;
  @IsOptional() @IsString() @MaxLength(1_500_000) photoUrl?: string | null; @IsOptional() @IsString() @MaxLength(20) taxId?: string;
  @IsOptional() @IsString() @MaxLength(60) province?: string; @IsOptional() @IsString() @MaxLength(60) municipality?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string; @IsOptional() @IsString() @MaxLength(400) bio?: string;
}
class PasswordDto { @IsString() @MaxLength(100) current!: string; @IsString() @MaxLength(100) next!: string; }
class RecoverDto { @IsString() @MaxLength(160) login!: string; }
class RecoverConfirmDto { @IsString() @MaxLength(160) login!: string; @IsString() @MaxLength(10) code!: string; @IsString() @MaxLength(100) password!: string; }
class AffiliateDto { @IsString() @MaxLength(60) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; @IsOptional() @IsString() @MaxLength(300) note?: string; }
class MarkupDto { @IsString() @MaxLength(60) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) markupPct?: number | null; }
class AccountDto { @IsString() @MaxLength(40) method!: string; @IsOptional() @IsString() @MaxLength(60) bank?: string; @IsString() @MaxLength(120) holder!: string; @IsString() @MaxLength(60) details!: string; }
class WithdrawDto { @IsString() @MaxLength(60) companyCode!: string; @Type(() => Number) @IsNumber() @Min(1) amount!: number; @IsString() @MaxLength(40) accountId!: string; }

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
  recover(@Body() d: RecoverDto) { return this.k.recoverRequest(d.login); }
  @Post('auth/recover/confirm') @ApiOperation({ summary: 'Define a nova senha com o código' })
  recoverConfirm(@Body() d: RecoverConfirmDto) { return this.k.recoverConfirm(d.login, d.code, d.password); }

  @Get('market') @ApiOperation({ summary: 'Produtos de todas as empresas no marketplace' })
  market() { return this.k.market(); }
  @Post('market/:companyCode/:productCode/view') @ApiOperation({ summary: 'Conta uma visualização' })
  view(@Param('companyCode') c: string, @Param('productCode') p: string) { return this.k.view(c, p); }

  @Get('me') async me(@Headers('authorization') a?: string) { return this.k.me(await this.k.verify(a)); }
  @Put('me') async profile(@Body() d: ProfileDto, @Headers('authorization') a?: string) { return this.k.updateProfile(await this.k.verify(a), d); }
  @Post('me/password') async password(@Body() d: PasswordDto, @Headers('authorization') a?: string) { return this.k.changePassword(await this.k.verify(a), d.current, d.next); }
  @Get('me/dashboard') async dashboard(@Headers('authorization') a?: string) { return this.k.dashboard(await this.k.verify(a)); }
  @Get('me/affiliations') async affiliations(@Headers('authorization') a?: string) { return this.k.myAffiliations(await this.k.verify(a)); }
  @Post('me/affiliations') async affiliate(@Body() d: AffiliateDto, @Headers('authorization') a?: string) { return this.k.affiliate(await this.k.verify(a), d.companyCode, d.productCode, d.note); }
  @Post('me/markup') async markup(@Body() d: MarkupDto, @Headers('authorization') a?: string) { return this.k.setMarkup(await this.k.verify(a), d.companyCode, d.productCode, d.markupPct ?? null); }
  @Get('me/accounts') async accounts(@Headers('authorization') a?: string) { return this.k.accounts(await this.k.verify(a)); }
  @Post('me/accounts') async addAccount(@Body() d: AccountDto, @Headers('authorization') a?: string) { return this.k.addAccount(await this.k.verify(a), d); }
  @Delete('me/accounts/:id') async removeAccount(@Param('id') id: string, @Headers('authorization') a?: string) { return this.k.removeAccount(await this.k.verify(a), id); }
  @Post('me/withdrawals') async withdraw(@Body() d: WithdrawDto, @Headers('authorization') a?: string) { return this.k.withdraw(await this.k.verify(a), d.companyCode, d.amount, d.accountId); }
}

class ListingDto {
  @IsBoolean() published!: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) percent?: number | null;
  @IsOptional() @IsIn(['OPEN', 'RESTRICTED']) mode?: 'OPEN' | 'RESTRICTED';
  @IsOptional() @IsBoolean() allowMarkup?: boolean;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(100) maxMarkupPct?: number | null;
  @IsOptional() @IsArray() @IsString({ each: true }) materials?: string[];
}
class DecideDto { @IsOptional() @IsIn(['APPROVED', 'REJECTED']) status?: 'APPROVED' | 'REJECTED'; @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(90) commissionPct?: number | null; }
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
  @Get('withdrawals') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Pedidos de saque dos associados' })
  async withdrawals() { return this.k.companyWithdrawals((await this.tenant()).companyId); }
  @Post('withdrawals/:id/pay') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Marca o saque como pago (com comprovativo)' })
  async pay(@Param('id') id: string, @Body() d: PayDto) { return this.k.decideWithdrawal((await this.tenant()).companyId, id, true, d.note, d.proofUrl); }
  @Post('withdrawals/:id/reject') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Recusa o saque' })
  async reject(@Param('id') id: string, @Body() d: PayDto) { return this.k.decideWithdrawal((await this.tenant()).companyId, id, false, d.note); }
}
