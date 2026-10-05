import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { round2 } from '@nexus/agt-xml';

/**
 * Chave de idempotência FIXA por ato clínico (UUID derivado de `origem:id`).
 *
 * Dois cliques/pedidos em simultâneo em "Faturar" emitiam duas faturas para a
 * mesma consulta (a verificação `invoice_id` corria antes de qualquer lock). Com
 * a mesma `clientOpId`, o índice único `invoices_client_op_uidx` recusa a segunda
 * — e o ato só pode ser faturado uma vez, aconteça o que acontecer.
 */
export function billingOpId(source: string, id: string): string {
  const h = createHash('sha256').update(`clinic-billing:${source}:${id}`).digest('hex');
  // Formato UUID (versão 5 / variante RFC 4122) para passar no tipo uuid.
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** A 2.ª emissão bateu no índice único da idempotência → o ato já foi faturado. */
export function rethrowIfAlreadyBilled(e: unknown, what: string): never {
  const msg = e instanceof Error ? e.message : String(e);
  if ((msg.includes('23505') || /duplicate key value/i.test(msg)) && (msg.includes('invoices_client_op_uidx') || msg.includes('(client_op_id)'))) {
    throw new BadRequestException(`${what} já faturad${what.endsWith('a') ? 'a' : 'o'}.`);
  }
  throw e;
}

/**
 * Preço com IVA incluído → líquido tal que líquido + IVA (arredondado como o
 * motor fiscal) dá EXATAMENTE o bruto, quando existe (333,34 → 292,40 + 40,94).
 * Nem sempre existe: a 14%, 15 000 fica 14 999,99 ou 15 000,01 com qualquer
 * líquido de 2 casas — aí fica o mais próximo por baixo (nunca se cobra a mais).
 */
export function netForGross(gross: number, ratePct: number): number {
  const base = round2(gross / (1 + ratePct / 100));
  for (const d of [0, 0.01, -0.01, 0.02, -0.02]) {
    const net = round2(base + d);
    if (round2(net + round2((net * ratePct) / 100)) === round2(gross)) return net;
  }
  return base;
}
