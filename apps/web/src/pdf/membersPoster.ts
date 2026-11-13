import { api } from '../api/client';
import { STORE_URL } from '../config';
import { buildStorePosterPdf, posterFileName } from './storePosterPdf';

/** Link da loja de associados da empresa (segunda loja, só para associados aprovados). */
export const membersStoreLink = (companyCode: string) => `${STORE_URL.replace(/\/$/, '')}/${encodeURIComponent(companyCode)}/associados`;

/**
 * Cartaz A4 da loja de associados — mesmo gerador e mesma organização do cartaz
 * da loja online (logo, nome, QR, link, benefícios, como partilhar, contactos e
 * rodapé), com os dados e as cores definidos em Loja online.
 */
export async function downloadMembersPoster(companyCode: string): Promise<void> {
  const [site, identity] = await Promise.all([api.site.get().catch(() => null), api.branding().catch(() => null)]);
  const storeName = site?.brand_name?.trim() || identity?.brandName || identity?.companyName || 'A nossa loja';
  const pdf = await buildStorePosterPdf({
    kind: 'associados',
    identity,
    storeName,
    tagline: site?.tagline?.trim() || undefined,
    logoUrl: site?.logo_url || undefined,
    storeLink: membersStoreLink(companyCode),
    primaryColor: site?.primary_color || undefined,
    contactPhone: site?.contact_phone?.trim() || undefined,
    contactEmail: site?.contact_email?.trim() || undefined,
    address: site?.address?.trim() || undefined,
  });
  pdf.save(posterFileName(storeName, 'associados'));
}
