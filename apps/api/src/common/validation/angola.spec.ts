import { isValidAngolaIban, isValidAngolaNif, normalizeIban } from './angola';

describe('isValidAngolaIban', () => {
  // IBAN construído com check digits corretos (mod-97 = 1, verificado
  // independentemente com BigInt no desenho do validador).
  const VALID = 'AO71004000000000000010115';

  it('aceita um IBAN angolano válido', () => {
    expect(isValidAngolaIban(VALID)).toBe(true);
  });

  it('aceita com espaços e minúsculas (normaliza)', () => {
    expect(isValidAngolaIban('ao71 0040 0000 0000 0000 1011 5')).toBe(true);
  });

  it.each([
    VALID.slice(0, 24) + '6',            // último dígito alterado → checksum falha
    'AO0600400000000000001011',          // 24 chars (curto)
    'PT50000201231234567890154',         // país errado
    'AO71 0040 0000 0000 0000 1011',     // truncado
    '',                                   // vazio
  ])('rejeita IBAN inválido: %s', (iban) => {
    expect(isValidAngolaIban(iban)).toBe(false);
  });
});

describe('isValidAngolaNif', () => {
  it.each(['5000412218', '541211001', '004274979BE042', '004274979be042'])(
    'aceita NIF válido: %s',
    (nif) => expect(isValidAngolaNif(nif)).toBe(true),
  );

  it.each(['12AB', '12345678', 'ABCDEFGHIJ', '004274979BE04', ''])(
    'rejeita NIF inválido: %s',
    (nif) => expect(isValidAngolaNif(nif)).toBe(false),
  );
});

describe('normalizeIban', () => {
  it('remove espaços e põe em maiúsculas', () => {
    expect(normalizeIban(' ao71 0040 ')).toBe('AO710040');
  });
});
