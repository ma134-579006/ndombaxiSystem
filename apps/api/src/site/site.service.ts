import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CreatePageDto, UpdatePageDto, UpdateSiteSettingsDto } from './dto/site.dto';

/**
 * Site / White-label (§8 — Page Builder).
 * Gere o branding da montra (linha única por tenant) e as páginas
 * construídas no editor de blocos. Tudo isolado no schema do tenant.
 */

export interface SiteSettingsRow {
  id: string;
  brand_name: string | null;
  tagline: string | null;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string;
  secondary_color: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  receipt_message: string | null;
  default_iva_code: string;
  social: unknown;
  custom_css: string | null;
  is_published: boolean;
  updated_at: Date;
}

export interface SitePageRow {
  id: string;
  slug: string;
  title: string;
  blocks: unknown;
  is_published: boolean;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

@Injectable()
export class SiteService {
  constructor(private readonly prisma: PrismaService) {}

  // ── Branding / definições (singleton lógico por tenant) ─────
  async getSettings(schema: string): Promise<SiteSettingsRow> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<SiteSettingsRow[]>(
        Prisma.sql`SELECT * FROM site_settings LIMIT 1`,
      );
      if (rows[0]) return rows[0];
      // cria a linha por omissão na primeira leitura
      const created = await tx.$queryRaw<SiteSettingsRow[]>(
        Prisma.sql`INSERT INTO site_settings DEFAULT VALUES RETURNING *`,
      );
      return created[0];
    });
  }

  async updateSettings(schema: string, dto: UpdateSiteSettingsDto): Promise<SiteSettingsRow> {
    // garante que a linha existe
    const current = await this.getSettings(schema);

    const sets: Prisma.Sql[] = [];
    if (dto.brandName !== undefined) sets.push(Prisma.sql`brand_name = ${dto.brandName}`);
    if (dto.tagline !== undefined) sets.push(Prisma.sql`tagline = ${dto.tagline}`);
    if (dto.logoUrl !== undefined) sets.push(Prisma.sql`logo_url = ${dto.logoUrl}`);
    if (dto.faviconUrl !== undefined) sets.push(Prisma.sql`favicon_url = ${dto.faviconUrl}`);
    if (dto.primaryColor !== undefined) sets.push(Prisma.sql`primary_color = ${dto.primaryColor}`);
    if (dto.secondaryColor !== undefined)
      sets.push(Prisma.sql`secondary_color = ${dto.secondaryColor}`);
    if (dto.contactEmail !== undefined) sets.push(Prisma.sql`contact_email = ${dto.contactEmail}`);
    if (dto.contactPhone !== undefined) sets.push(Prisma.sql`contact_phone = ${dto.contactPhone}`);
    if (dto.address !== undefined) sets.push(Prisma.sql`address = ${dto.address}`);
    if (dto.receiptMessage !== undefined) sets.push(Prisma.sql`receipt_message = ${dto.receiptMessage}`);
    if (dto.defaultIvaCode !== undefined) sets.push(Prisma.sql`default_iva_code = ${dto.defaultIvaCode}`);
    if (dto.social !== undefined)
      sets.push(Prisma.sql`social = ${JSON.stringify(dto.social)}::jsonb`);
    if (dto.customCss !== undefined) sets.push(Prisma.sql`custom_css = ${dto.customCss}`);
    if (dto.isPublished !== undefined) sets.push(Prisma.sql`is_published = ${dto.isPublished}`);

    if (sets.length === 0) return current;
    sets.push(Prisma.sql`updated_at = now()`);

    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<SiteSettingsRow[]>(
        Prisma.sql`UPDATE site_settings SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${current.id}::uuid RETURNING *`,
      );
      return rows[0];
    });
  }

  // ── Páginas (editor de blocos) ──────────────────────────────
  listPages(schema: string): Promise<SitePageRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SitePageRow[]>(
        Prisma.sql`SELECT * FROM site_pages ORDER BY sort_order, title`,
      ),
    );
  }

  /** Apenas páginas publicadas — usado pela montra pública. */
  listPublishedPages(schema: string): Promise<SitePageRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SitePageRow[]>(
        Prisma.sql`SELECT * FROM site_pages WHERE is_published = TRUE ORDER BY sort_order, title`,
      ),
    );
  }

  async getPage(schema: string, id: string): Promise<SitePageRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SitePageRow[]>(
        Prisma.sql`SELECT * FROM site_pages WHERE id = ${id}::uuid LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Página não encontrada: ${id}`);
    return rows[0];
  }

  async getPublishedPageBySlug(schema: string, slug: string): Promise<SitePageRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SitePageRow[]>(
        Prisma.sql`SELECT * FROM site_pages
                   WHERE slug = ${slug} AND is_published = TRUE LIMIT 1`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Página não encontrada: ${slug}`);
    return rows[0];
  }

  async createPage(schema: string, dto: CreatePageDto): Promise<SitePageRow> {
    const blocks = JSON.stringify(dto.blocks ?? []);
    try {
      return await this.prisma.runInTenant(schema, async (tx) => {
        const rows = await tx.$queryRaw<SitePageRow[]>(
          Prisma.sql`INSERT INTO site_pages (slug, title, blocks, is_published, sort_order)
                     VALUES (${dto.slug}, ${dto.title}, ${blocks}::jsonb,
                             ${dto.isPublished ?? false}, ${dto.sortOrder ?? 0})
                     RETURNING *`,
        );
        return rows[0];
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2010') {
        // violação de unicidade do slug devolvida como erro de query raw
        throw new ConflictException(`Já existe uma página com o slug "${dto.slug}".`);
      }
      // unicidade pode chegar como erro genérico — normaliza
      if (String((e as Error)?.message ?? '').includes('site_pages_slug_unique')) {
        throw new ConflictException(`Já existe uma página com o slug "${dto.slug}".`);
      }
      throw e;
    }
  }

  async updatePage(schema: string, id: string, dto: UpdatePageDto): Promise<SitePageRow> {
    const sets: Prisma.Sql[] = [];
    if (dto.title !== undefined) sets.push(Prisma.sql`title = ${dto.title}`);
    if (dto.blocks !== undefined)
      sets.push(Prisma.sql`blocks = ${JSON.stringify(dto.blocks)}::jsonb`);
    if (dto.isPublished !== undefined) sets.push(Prisma.sql`is_published = ${dto.isPublished}`);
    if (dto.sortOrder !== undefined) sets.push(Prisma.sql`sort_order = ${dto.sortOrder}`);

    if (sets.length === 0) return this.getPage(schema, id);
    sets.push(Prisma.sql`updated_at = now()`);

    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SitePageRow[]>(
        Prisma.sql`UPDATE site_pages SET ${Prisma.join(sets, ', ')}
                   WHERE id = ${id}::uuid RETURNING *`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Página não encontrada: ${id}`);
    return rows[0];
  }

  async deletePage(schema: string, id: string): Promise<{ id: string }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(
        Prisma.sql`DELETE FROM site_pages WHERE id = ${id}::uuid RETURNING id`,
      ),
    );
    if (!rows[0]) throw new NotFoundException(`Página não encontrada: ${id}`);
    return rows[0];
  }
}
