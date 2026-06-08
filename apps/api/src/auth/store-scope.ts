import type { JwtPayload } from '@nexus/types';
import { Role } from '../rbac/roles.enum';

/**
 * Loja efectiva para consultas multi-loja (permissões por loja), DENTRO de uma
 * empresa (tenant). Quem decide é o papel do utilizador na empresa:
 *  - O ADMIN DA EMPRESA (COMPANY_ADMIN) — o gestor principal — vê TODAS as lojas
 *    da SUA empresa (ou a loja escolhida no filtro). Nota: o super admin da
 *    plataforma, ao entrar numa empresa, fá-lo como COMPANY_ADMIN dessa empresa
 *    (impersonation), por isso cai aqui — não se confunde com este papel.
 *  - Os restantes (gestor de loja, supervisor, caixa) ficam RESTRITOS à sua
 *    própria loja (user.storeId), ignorando qualquer loja pedida no pedido.
 * Devolve undefined = sem restrição (todas as lojas da empresa).
 */
export function effectiveStoreId(user: JwtPayload | undefined, requested?: string): string | undefined {
  if (!user) return requested || undefined;
  if (user.role === Role.COMPANY_ADMIN) return requested || undefined; // admin da empresa vê tudo
  return user.storeId || undefined; // os outros: só a sua loja
}
