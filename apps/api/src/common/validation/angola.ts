import { registerDecorator, ValidationOptions } from 'class-validator';

/**
 * Validações de identificadores angolanos (NIF e IBAN).
 * Usadas nos DTOs (decorators) e nos serviços (funções puras).
 */

/** Normaliza um IBAN: remove espaços e põe em maiúsculas. */
export function normalizeIban(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/**
 * IBAN angolano: "AO" + 2 dígitos de controlo + 21 dígitos (25 caracteres),
 * validado com o checksum ISO 7064 mod-97 (o mesmo de qualquer IBAN).
 */
export function isValidAngolaIban(value: string): boolean {
  const iban = normalizeIban(value);
  if (!/^AO\d{23}$/.test(iban)) return false;
  // mod-97: move os 4 primeiros caracteres para o fim e converte letras (A=10…Z=35)
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const digits = ch >= '0' && ch <= '9' ? ch : String(ch.charCodeAt(0) - 55);
    for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  }
  return remainder === 1;
}

/**
 * NIF angolano:
 *  • Pessoa colectiva: 9–10 dígitos (ex.: 5000412218)
 *  • Pessoa singular: 9 dígitos + 2 letras + 3 dígitos (ex.: 004274979BE042)
 */
export function isValidAngolaNif(value: string): boolean {
  const nif = value.trim().toUpperCase();
  return /^\d{9,10}$/.test(nif) || /^\d{9}[A-Z]{2}\d{3}$/.test(nif);
}

/** Decorator class-validator: IBAN angolano válido (formato + checksum). */
export function IsAngolaIban(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAngolaIban',
      target: object.constructor,
      propertyName,
      options: {
        message: 'IBAN inválido — use o formato angolano: AO06 seguido de 21 dígitos (25 caracteres).',
        ...options,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidAngolaIban(value),
      },
    });
  };
}

/** Decorator class-validator: NIF angolano válido (empresa ou pessoa singular). */
export function IsAngolaNif(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isAngolaNif',
      target: object.constructor,
      propertyName,
      options: {
        message: 'NIF inválido — 9–10 dígitos (empresa) ou 9 dígitos + 2 letras + 3 dígitos (pessoa).',
        ...options,
      },
      validator: {
        validate: (value: unknown) => typeof value === 'string' && isValidAngolaNif(value),
      },
    });
  };
}
