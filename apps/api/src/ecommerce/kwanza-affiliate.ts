/**
 * LPS Kwanza — ferramentas de afiliação do associado (como no Kikolo Online):
 * afiliar a vários produtos de uma vez e remover a afiliação a um produto.
 */
import { Body, Controller, Delete, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Prisma } from '@prisma/client';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { KwanzaService } from './kwanza.service';

const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);

class BulkItem { @IsString() @MaxLength(80) companyCode!: string; @IsString() @MaxLength(80) productCode!: string; }
class BulkDto { @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => BulkItem) items!: BulkItem[]; }

@ApiTags('kwanza')
@Public()
@Controller('kwanza/me/affiliations')
export class KwanzaAffiliateController {
  constructor(private readonly k: KwanzaService, private readonly prisma: PrismaService) {}

  @Post('bulk') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Afilia a vários produtos de uma vez' })
  async bulk(@Body() d: BulkDto, @Headers('authorization') a?: string) {
    const me = await this.k.verify(a);
    const out: { companyCode: string; productCode: string; status?: string; error?: string }[] = [];
    // Um a um, pela mesma regra do botão (afiliação aberta = aprovada; restrita = pedido à empresa).
    for (const it of d.items) {
      try { out.push({ companyCode: it.companyCode, productCode: it.productCode, status: (await this.k.affiliate(me, it.companyCode, it.productCode)).status }); }
      catch (e) { out.push({ companyCode: it.companyCode, productCode: it.productCode, error: (e as Error).message }); }
    }
    return out;
  }

  /** O associado deixa de vender o produto (a publicação sai do marketplace). As comissões já ganhas mantêm-se. */
  @Delete(':company/:product') @ApiOperation({ summary: 'Remove a afiliação a um produto' })
  async remove(@Param('company') company: string, @Param('product') product: string, @Headers('authorization') a?: string) {
    const me = await this.k.verify(a);
    const c = await this.prisma.company.findUnique({ where: { code: company } });
    if (!c) throw new NotFoundException('Empresa indisponível.');
    const n = await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM ${T('kwanza_affiliations')} WHERE "associateId" = ${me.id}::uuid AND "companyId" = ${c.id}::uuid AND "productCode" = ${product}`);
    if (!n) throw new NotFoundException('Não está afiliado a este produto.');
    return { ok: true as const };
  }
}
