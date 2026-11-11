import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface BannerRow {
  id: string; title: string; subtitle: string | null; imageUrl: string | null; linkUrl: string | null;
  buttonLabel: string | null; sortOrder: number; isActive: boolean;
}
export interface BannerInput {
  title?: string; subtitle?: string | null; imageUrl?: string | null; linkUrl?: string | null;
  buttonLabel?: string | null; sortOrder?: number; isActive?: boolean;
}

type Raw = { id: string; title: string; subtitle: string | null; image_url: string | null; link_url: string | null; button_label: string | null; sort_order: number; is_active: boolean };
const map = (r: Raw): BannerRow => ({
  id: r.id, title: r.title, subtitle: r.subtitle, imageUrl: r.image_url, linkUrl: r.link_url,
  buttonLabel: r.button_label, sortOrder: r.sort_order, isActive: r.is_active,
});
const clip = (v: string | null | undefined, n: number): string | null => { const t = (v ?? '').trim(); return t ? t.slice(0, n) : null; };

/** Anúncios do carrossel da loja de associados (geridos no painel). */
@Injectable()
export class BannersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(schema: string, onlyActive = false): Promise<BannerRow[]> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<Raw[]>(Prisma.sql`
        SELECT id, title, subtitle, image_url, link_url, button_label, sort_order, is_active
        FROM store_banners WHERE (${onlyActive} = FALSE OR is_active) ORDER BY sort_order, created_at LIMIT 50`),
    );
    return rows.map(map);
  }

  async create(schema: string, dto: BannerInput): Promise<BannerRow> {
    const title = clip(dto.title, 120);
    if (!title) throw new NotFoundException('Indique o título do anúncio.');
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<Raw[]>(Prisma.sql`
        INSERT INTO store_banners (title, subtitle, image_url, link_url, button_label, sort_order, is_active)
        VALUES (${title}, ${clip(dto.subtitle, 200)}, ${dto.imageUrl ?? null}, ${clip(dto.linkUrl, 300)}, ${clip(dto.buttonLabel, 40)},
                ${dto.sortOrder ?? 0}, ${dto.isActive ?? true})
        RETURNING id, title, subtitle, image_url, link_url, button_label, sort_order, is_active`),
    );
    return map(rows[0]);
  }

  async update(schema: string, id: string, dto: BannerInput): Promise<BannerRow> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<Raw[]>(Prisma.sql`
        UPDATE store_banners SET
          title = COALESCE(${clip(dto.title, 120)}, title),
          subtitle = CASE WHEN ${dto.subtitle !== undefined} THEN ${clip(dto.subtitle, 200)} ELSE subtitle END,
          image_url = CASE WHEN ${dto.imageUrl !== undefined} THEN ${dto.imageUrl ?? null} ELSE image_url END,
          link_url = CASE WHEN ${dto.linkUrl !== undefined} THEN ${clip(dto.linkUrl, 300)} ELSE link_url END,
          button_label = CASE WHEN ${dto.buttonLabel !== undefined} THEN ${clip(dto.buttonLabel, 40)} ELSE button_label END,
          sort_order = COALESCE(${dto.sortOrder ?? null}::int, sort_order),
          is_active = COALESCE(${dto.isActive ?? null}::boolean, is_active),
          updated_at = now()
        WHERE id = ${id}::uuid
        RETURNING id, title, subtitle, image_url, link_url, button_label, sort_order, is_active`),
    );
    if (!rows[0]) throw new NotFoundException('Anúncio não encontrado.');
    return map(rows[0]);
  }

  async remove(schema: string, id: string): Promise<{ id: string }> {
    const n = await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`DELETE FROM store_banners WHERE id = ${id}::uuid`));
    if (!n) throw new NotFoundException('Anúncio não encontrado.');
    return { id };
  }
}
