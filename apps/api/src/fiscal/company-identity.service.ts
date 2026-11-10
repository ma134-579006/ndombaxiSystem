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
  /** Slogan e dados da empresa para o cabeçalho e rodapé da fatura (Definições da Conta). */
  slogan?: string | null;
  tradeName?: string | null; shareCapital?: string | null; registry?: string | null;
  postalCode?: string | null; city?: string | null; region?: string | null; website?: string | null;
  cae?: string | null; iban?: string | null;
  /** Dizeres livres configuráveis pela empresa para o rodapé do recibo. */
  receiptMessage: string | null;
  /** Tipo de negócio (adapta o painel): RETAIL | RESTAURANT | SERVICES | HOSPITALITY. */
  businessType: string;
  /** Módulo Loja Online ligado (portal público). Esconde os menus da loja quando falso. */
  onlineStoreEnabled: boolean;
  /** Assinatura permanente do sistema (autoria). */
  copyright: string;
}

interface SiteIdentityRow {
  brand_name: string | null;
  logo_url: string | null;
  address: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  receipt_message: string | null;
  online_store_enabled: boolean | null;
  tagline?: string | null;
  company_profile?: Record<string, string> | null;
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
        Prisma.sql`SELECT * FROM site_settings LIMIT 1`,
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
      slogan: s?.tagline ?? null,
      ...pickProfile(s?.company_profile),
      receiptMessage: s?.receipt_message ?? null,
      businessType: company?.sector ?? 'RETAIL',
      onlineStoreEnabled: s?.online_store_enabled ?? true,
      copyright: copyrightLine(),
    };
  }
}

/** Campos de Definições da Conta guardados em site_settings.company_profile (texto). */
function pickProfile(p: Record<string, string> | null | undefined) {
  const v = (k: string) => (p && typeof p[k] === 'string' && p[k].trim() ? p[k].trim() : null);
  return {
    tradeName: v('tradeName'), shareCapital: v('shareCapital'), registry: v('registry'),
    postalCode: v('postalCode'), city: v('city'), region: v('region'), website: v('website'),
    cae: v('cae'), iban: v('iban'),
  };
}
