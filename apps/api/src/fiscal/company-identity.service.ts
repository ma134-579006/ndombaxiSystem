import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { copyrightLine } from '../common/branding';

/** Identidade da empresa para impressão/emissão de documentos. */
export interface DocumentIdentity {
  companyName: string; // nome legal (Company, global)
  nif: string; // NIF da empresa
  brandName: string | null; // marca comercial (site_settings)
  logoUrl: string | null; // logótipo da empresa (definido no painel)
  address: string | null;
  phone: string | null;
  email: string | null;
  /** Assinatura permanente do sistema (autoria). */
  copyright: string;
}

interface SiteIdentityRow {
  brand_name: string | null;
  logo_url: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
}

/**
 * Reúne a identidade da empresa para os documentos (recibos/facturas):
 *   • dados LEGAIS (nome, NIF) do registo global da empresa (Company);
 *   • LOGÓTIPO + marca + contactos definidos pela própria empresa no painel
 *     (site_settings, isolado no schema do tenant).
 * Assim, cada empresa coloca a sua logo e os seus dados, e estes aparecem
 * automaticamente nos seus documentos — sem tocar no código.
 */
@Injectable()
export class CompanyIdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async getDocumentIdentity(
    tenantId: string | undefined,
    schema: string,
  ): Promise<DocumentIdentity> {
    const company = tenantId
      ? await this.prisma.company.findUnique({ where: { id: tenantId } })
      : null;

    const siteRows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<SiteIdentityRow[]>(
        Prisma.sql`SELECT brand_name, logo_url, address, contact_phone, contact_email
                   FROM site_settings LIMIT 1`,
      ),
    );
    const s = siteRows[0];

    return {
      companyName: company?.name ?? s?.brand_name ?? '',
      nif: company?.nif ?? '',
      brandName: s?.brand_name ?? company?.name ?? null,
      logoUrl: s?.logo_url ?? null,
      address: s?.address ?? null,
      phone: s?.contact_phone ?? company?.responsiblePhone ?? null,
      email: s?.contact_email ?? company?.responsibleEmail ?? null,
      copyright: copyrightLine(),
    };
  }
}
