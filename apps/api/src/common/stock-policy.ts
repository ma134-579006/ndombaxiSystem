import { Prisma } from '@prisma/client';

/**
 * "Permitir vender produtos sem stock" (Configurações → Definições → Stock),
 * como no Vendus: quando ligado, a venda de um produto com stock nulo ou
 * negativo é aceite em TODO o lado (Caixa, painel, loja online e LPS Kwanza) e
 * o stock pode ficar negativo. Desligado por omissão — é o gestor que decide.
 *
 * Lê dentro da transação do tenant (search_path já no schema da empresa). Só
 * consulta a coluna se ela existir: num tenant ainda por migrar, um SELECT a
 * uma coluna em falta abortaria a transação inteira da venda.
 */
export async function sellWithoutStock(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ v: boolean | null }[]>(Prisma.sql`
    SELECT CASE WHEN EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'site_settings' AND column_name = 'allow_sell_without_stock'
    ) THEN TRUE ELSE FALSE END AS v`);
  if (!rows[0]?.v) return false;
  const r = await tx.$queryRaw<{ v: boolean | null }[]>(Prisma.sql`SELECT allow_sell_without_stock AS v FROM site_settings LIMIT 1`);
  return r[0]?.v === true;
}

/** Quem tem caches que dependem da opção (ex.: catálogo da loja online) regista-se aqui. */
const listeners = new Set<(schema: string) => void>();
export function onStockPolicyChange(fn: (schema: string) => void): void { listeners.add(fn); }
/** Chamado quando o gestor liga/desliga a opção: as lojas refletem-na logo. */
export function stockPolicyChanged(schema: string): void { for (const fn of listeners) { try { fn(schema); } catch { /* um ouvinte não trava os outros */ } } }
