/**
 * Motor PURO de validação/normalização de métodos de pagamento (§ Fase 8).
 * Suporta a realidade angolana: transferência bancária (IBAN AO), pagamento
 * por referência (Entidade + Referência), Multicaixa Express e numerário.
 * Sem dependências de BD — totalmente testável.
 */

export const PAYMENT_METHOD_TYPES = [
  'BANK_TRANSFER', // transferência (IBAN)
  'REFERENCE', // pagamento por referência (Multicaixa)
  'MULTICAIXA_EXPRESS', // Multicaixa Express (telemóvel)
  'CASH', // numerário / na entrega
] as const;

export type PaymentMethodType = (typeof PAYMENT_METHOD_TYPES)[number];

export function isPaymentMethodType(v: string): v is PaymentMethodType {
  return (PAYMENT_METHOD_TYPES as readonly string[]).includes(v);
}

export interface PaymentMethodFields {
  type: PaymentMethodType;
  label?: string;
  instructions?: string;
  bankName?: string;
  iban?: string;
  accountHolder?: string;
  referenceEntity?: string;
  referenceNumber?: string;
  expressPhone?: string;
}

export interface NormalizedPaymentMethod extends PaymentMethodFields {
  label: string;
}

/** Normaliza um IBAN (remove espaços, maiúsculas). */
export function normalizeIban(iban: string): string {
  return iban.replace(/\s+/g, '').toUpperCase();
}

/**
 * Valida um IBAN angolano: "AO06" + 21 dígitos = 25 caracteres.
 * (Validação estrutural; o dígito de controlo ISO 13616 fica para a Fase 10.)
 */
export function isValidAngolanIban(iban: string): boolean {
  return /^AO\d{23}$/.test(normalizeIban(iban));
}

/** Rótulo por omissão amigável para cada tipo. */
export function defaultLabel(type: PaymentMethodType): string {
  switch (type) {
    case 'BANK_TRANSFER':
      return 'Transferência Bancária';
    case 'REFERENCE':
      return 'Pagamento por Referência';
    case 'MULTICAIXA_EXPRESS':
      return 'Multicaixa Express';
    case 'CASH':
      return 'Numerário';
  }
}

/**
 * Valida e normaliza os campos consoante o tipo. Lança Error com mensagem
 * clara (pt-AO) quando faltam dados obrigatórios.
 */
export function validatePaymentMethod(input: PaymentMethodFields): NormalizedPaymentMethod {
  if (!isPaymentMethodType(input.type)) {
    throw new Error(`Tipo de pagamento inválido: ${String(input.type)}`);
  }

  const out: NormalizedPaymentMethod = {
    ...input,
    label: input.label?.trim() || defaultLabel(input.type),
  };

  switch (input.type) {
    case 'BANK_TRANSFER': {
      if (!input.iban) throw new Error('IBAN é obrigatório para transferência bancária.');
      const iban = normalizeIban(input.iban);
      if (!isValidAngolanIban(iban)) {
        throw new Error('IBAN angolano inválido (formato esperado: AO06 + 21 dígitos).');
      }
      if (!input.accountHolder?.trim()) {
        throw new Error('O titular da conta é obrigatório para transferência bancária.');
      }
      out.iban = iban;
      break;
    }
    case 'REFERENCE': {
      if (!input.referenceEntity?.trim() || !input.referenceNumber?.trim()) {
        throw new Error('Entidade e Referência são obrigatórias no pagamento por referência.');
      }
      break;
    }
    case 'MULTICAIXA_EXPRESS': {
      if (!input.expressPhone?.trim()) {
        throw new Error('O número de telemóvel Express é obrigatório.');
      }
      break;
    }
    case 'CASH':
      break;
  }

  return out;
}
