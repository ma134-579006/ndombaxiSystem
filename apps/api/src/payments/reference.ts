/**
 * Motor PURO de referências Multicaixa (EMIS) — Angola.
 *
 * Numa referência Multicaixa real, o comerciante tem um CONTRATO com a EMIS que
 * lhe atribui uma ENTIDADE (5 dígitos). Por cada pagamento gera-se uma
 * REFERÊNCIA (normalmente 9 dígitos) associada a um VALOR e a uma VALIDADE; o
 * cliente paga num ATM/Multicaixa/app indicando Entidade + Referência + Valor.
 *
 * Este módulo estrutura os dados do contrato e GERA referências de forma
 * determinística e válida (com dígito de controlo), sem dependências de BD.
 * A confirmação do pagamento real chega depois por callback/consulta à EMIS
 * (integração HTTP fica para produção — aqui deixamos a referência pronta).
 */

export type ReferenceEnvironment = 'TEST' | 'PRODUCTION';

/** Dados do contrato de referência (Entidade EMIS), guardados encriptados. */
export interface ReferenceContract {
  /** Entidade atribuída pela EMIS: 5 dígitos. */
  entity: string;
  /** Ambiente do contrato. */
  environment?: ReferenceEnvironment;
  /** Validade por omissão de cada referência, em dias. */
  defaultValidityDays?: number;
  /** Sub-entidade/escalão (opcional, alguns contratos usam). */
  subEntity?: string;
}

export interface GeneratedReference {
  entity: string;
  reference: string; // 9 dígitos (8 + dígito de controlo)
  amount: number; // valor a pagar (AOA)
  expiresAt: string; // ISO
  environment: ReferenceEnvironment;
}

/** Valida uma entidade EMIS (5 dígitos). */
export function isValidEntity(entity: string): boolean {
  return /^\d{5}$/.test(String(entity).trim());
}

/**
 * Dígito de controlo (mod 10, ponderação 9..1 estilo Multicaixa) sobre
 * entidade(5) + corpo(8) → 1 dígito. Determinístico e verificável.
 */
function checkDigit(entity: string, body8: string): number {
  const digits = (entity + body8).split('').map((d) => Number(d));
  // pesos cíclicos 9,7,3,1 (esquema comum em referências PT/AO)
  const weights = [9, 7, 3, 1];
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    sum += digits[i] * weights[i % weights.length];
  }
  const mod = sum % 10;
  return (10 - mod) % 10;
}

/**
 * Gera uma referência a partir do contrato. `seq` é um número sequencial/único
 * do pagamento (ex.: id incremental da subscrição/encomenda) — garante
 * referências distintas e reproduzíveis. O valor é arredondado ao Kwanza.
 */
export function generateReference(
  contract: ReferenceContract,
  input: { seq: number; amount: number; validityDays?: number },
): GeneratedReference {
  const entity = String(contract.entity).trim();
  if (!isValidEntity(entity)) {
    throw new Error('Entidade inválida: a EMIS atribui uma entidade de 5 dígitos.');
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error('Valor da referência deve ser positivo.');
  }

  // Corpo de 8 dígitos a partir do sequencial (com prefixo opcional da sub-entidade).
  const base = Math.abs(Math.trunc(input.seq));
  const body8 = String(base % 100_000_000).padStart(8, '0');
  const dc = checkDigit(entity, body8);
  const reference = `${body8}${dc}`;

  const days = input.validityDays ?? contract.defaultValidityDays ?? 3;
  const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

  return {
    entity,
    reference,
    amount: Math.round(input.amount),
    expiresAt,
    environment: contract.environment ?? 'TEST',
  };
}

/** Formata a referência para apresentação: "REF 123 456 789". */
export function formatReference(ref: string): string {
  const r = ref.replace(/\D/g, '');
  return r.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}
