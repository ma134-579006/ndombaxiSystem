import { Controller, Get, Injectable, NotFoundException, Param, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';
import { Public } from '../auth/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';

/**
 * LPS Kwanza — anúncios do marketplace. Cada empresa gere os seus no painel
 * (LPS Kwanza → Anúncios da loja de associados, tabela `store_banners` do inquilino);
 * aqui juntam-se os ativos das empresas que têm produtos publicados no marketplace.
 * A imagem vai num pedido à parte (com cache) para a lista ficar leve.
 */
const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);
const MAX_PER_COMPANY = 5;
const TTL_MS = 60_000;

export interface KwanzaBanner {
  id: string; companyCode: string; companyName: string; title: string; subtitle: string | null;
  buttonLabel: string | null; link: { kind: 'product' | 'search' | 'url'; value: string } | null; image: string | null;
}

@Injectable()
export class KwanzaBannersService {
  private cache: { at: number; rows: KwanzaBanner[] } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<KwanzaBanner[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.rows;
    const companies = await this.prisma.$queryRaw<{ id: string; code: string; name: string; schema: string }[]>(Prisma.sql`
      SELECT c.id, c.code, c.name, c."schemaName" AS schema FROM nexus_public.companies c
      WHERE c.status = 'ACTIVE' AND EXISTS (SELECT 1 FROM ${T('kwanza_listings')} l WHERE l."companyId" = c.id AND l.active = TRUE)
      ORDER BY c.name`);
    const out: KwanzaBanner[] = [];
    for (const c of companies) {
      const rows = await this.prisma.runInTenant(c.schema, async (tx) => {
        const has = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('store_banners')::text AS r`);
        if (!has[0]?.r) return [];
        return tx.$queryRaw<{ id: string; title: string; subtitle: string | null; link_url: string | null; button_label: string | null; img: boolean }[]>(Prisma.sql`
          SELECT id::text, title, subtitle, link_url, button_label, (image_url IS NOT NULL AND image_url <> '') AS img
          FROM store_banners WHERE is_active ORDER BY sort_order, created_at LIMIT ${MAX_PER_COMPANY}`);
      }).catch(() => []);
      for (const r of rows) {
        out.push({
          id: r.id, companyCode: c.code, companyName: c.name, title: r.title, subtitle: r.subtitle, buttonLabel: r.button_label,
          link: linkOf(r.link_url), image: r.img ? `/kwanza/banners/${encodeURIComponent(c.code)}/${r.id}/image` : null,
        });
      }
    }
    // Uma empresa não ocupa o carrossel inteiro: alterna os anúncios entre empresas.
    const byCo = new Map<string, KwanzaBanner[]>();
    for (const b of out) byCo.set(b.companyCode, [...(byCo.get(b.companyCode) ?? []), b]);
    const mixed: KwanzaBanner[] = [];
    for (let i = 0; i < MAX_PER_COMPANY; i++) for (const list of byCo.values()) if (list[i]) mixed.push(list[i]);
    this.cache = { at: Date.now(), rows: mixed };
    return mixed;
  }

  async image(companyCode: string, id: string): Promise<{ mime: string; data: Buffer } | { url: string }> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException();
    const c = await this.prisma.company.findUnique({ where: { code: companyCode } });
    if (!c || c.status !== 'ACTIVE') throw new NotFoundException();
    const rows = await this.prisma.runInTenant(c.schemaName, (tx) => tx.$queryRaw<{ image_url: string | null }[]>(Prisma.sql`
      SELECT image_url FROM store_banners WHERE id = ${id}::uuid AND is_active`)).catch(() => []);
    const src = rows[0]?.image_url;
    if (!src) throw new NotFoundException();
    const m = /^data:([\w/+.-]+);base64,(.+)$/s.exec(src);
    if (m) return { mime: m[1], data: Buffer.from(m[2], 'base64') };
    if (/^https?:\/\//i.test(src)) return { url: src };
    throw new NotFoundException();
  }
}

/** Ligação do anúncio: código de produto, pesquisa ou endereço https. */
function linkOf(raw: string | null): KwanzaBanner['link'] {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return { kind: 'url', value: v };
  if (/^[\w.-]{1,40}$/.test(v) && /\d/.test(v)) return { kind: 'product', value: v };
  return { kind: 'search', value: v.slice(0, 80) };
}

@ApiTags('kwanza')
@Public()
@Controller('kwanza/banners')
export class KwanzaBannersController {
  constructor(private readonly banners: KwanzaBannersService) {}

  @Get() @ApiOperation({ summary: 'Anúncios ativos das empresas do marketplace' })
  list() { return this.banners.list(); }

  @Get(':companyCode/:id/image') @ApiOperation({ summary: 'Imagem de um anúncio' })
  async image(@Param('companyCode') companyCode: string, @Param('id') id: string, @Res() res: Response) {
    const r = await this.banners.image(companyCode, id);
    if ('url' in r) { res.redirect(302, r.url); return; }
    res.setHeader('Content-Type', /^image\//.test(r.mime) ? r.mime : 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.end(r.data);
  }
}
