import * as XLSX from 'xlsx';
import { isValidGtin, readBarcode, readCode, readStock } from './cell-values';
import { mapHeaders, PRODUCT_ALIASES, PRODUCT_FIELD_ORDER, PRODUCT_NEGATIVE, ProductField } from './column-aliases';
import { detectProductColumns } from './product-columns';
import { parseUploadedFile } from './parse-file';

describe('readBarcode', () => {
  it('número do Excel vira texto inteiro, sem notação científica nem ".0"', () => {
    expect(readBarcode(5601234567890).value).toBe('5601234567890');
    expect(readBarcode('5601234567890.0').value).toBe('5601234567890');
  });
  it('preserva zeros à esquerda quando vêm como texto', () => {
    expect(readBarcode('0012345678905').value).toBe('0012345678905');
  });
  it('tira apóstrofo, espaços e hífenes', () => {
    expect(readBarcode("'5601 2345-67890").value).toBe('5601234567890');
  });
  it('notação científica → vazio + aviso (o Excel já cortou dígitos)', () => {
    const r = readBarcode('5,60123E+12');
    expect(r.value).toBe('');
    expect(r.warning).toMatch(/notação científica/);
  });
  it('vazio → vazio sem aviso', () => {
    expect(readBarcode('')).toEqual({ value: '' });
    expect(readBarcode(null)).toEqual({ value: '' });
  });
});

describe('isValidGtin', () => {
  it('valida EAN-13 e rejeita dígito de controlo errado', () => {
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('4006381333932')).toBe(false);
    expect(isValidGtin('12345')).toBe(false);
  });
});

describe('readStock', () => {
  it('célula vazia é DESCONHECIDO (null), nunca 0', () => {
    expect(readStock('').value).toBeNull();
    expect(readStock('   ').value).toBeNull();
    expect(readStock(undefined).value).toBeNull();
  });
  it('lê formatos PT/EN e sufixos', () => {
    expect(readStock('12 un').value).toBe(12);
    expect(readStock('1.234,5').value).toBe(1234.5);
    expect(readStock(48).value).toBe(48);
    expect(readStock('0').value).toBe(0);
  });
  it('negativo → 0 com aviso', () => {
    const r = readStock('-3');
    expect(r.value).toBe(0);
    expect(r.warning).toMatch(/negativo/);
  });
});

describe('readCode', () => {
  it('número sem ".0"', () => { expect(readCode(1001)).toBe('1001'); });
  it('texto aparado', () => { expect(readCode('  AB  12 ')).toBe('AB 12'); });
});

describe('reconhecimento de colunas (produtos)', () => {
  const map = (headers: string[]) => mapHeaders<ProductField>(headers, PRODUCT_ALIASES, { negative: PRODUCT_NEGATIVE, order: PRODUCT_FIELD_ORDER }).mapping;

  it('exportação tipo Primavera/PHC', () => {
    const m = map(['Cód. Barras', 'Referência', 'Designação', 'Stock Atual', 'Stock Mínimo', 'Preço de Custo', 'PVP', 'Família']);
    expect(m.barcode).toBe('Cód. Barras');
    expect(m.code).toBe('Referência');
    expect(m.name).toBe('Designação');
    expect(m.stock).toBe('Stock Atual'); // e NÃO «Stock Mínimo»
    expect(m.costPrice).toBe('Preço de Custo');
    expect(m.salePrice).toBe('PVP');
    expect(m.category).toBe('Família');
  });

  it('«Código de Barras» não é roubado pela coluna «Código»', () => {
    const m = map(['Código', 'Código de Barras', 'Nome']);
    expect(m.barcode).toBe('Código de Barras');
    expect(m.code).toBe('Código');
  });

  it('variantes comuns de stock', () => {
    expect(map(['Nome', 'Existência']).stock).toBe('Existência');
    expect(map(['Nome', 'Saldo atual']).stock).toBe('Saldo atual');
    expect(map(['Nome', 'Qtd.']).stock).toBe('Qtd.');
    expect(map(['Nome', 'Quantidade em stock']).stock).toBe('Quantidade em stock');
  });

  it('palavras inteiras: «Descodificação» não é «cod»', () => {
    expect(map(['Nome', 'Descodificação']).code).toBeUndefined();
  });

  it('«Stock mínimo» sozinho não é stock', () => {
    expect(map(['Nome', 'Stock mínimo']).stock).toBeUndefined();
  });
});

describe('detectProductColumns', () => {
  const eans = ['5449000000996', '4006381333931', '5601234567897', '8410076472281'];

  it('coluna sem cabeçalho útil, mas com EANs, é o código de barras', () => {
    const rows = eans.map((e, i) => ({ 'Item': `P${i}`, 'Descrição': `Prod ${i}`, 'Qtd': 5, 'Coluna C': e }));
    const c = detectProductColumns(['Item', 'Descrição', 'Qtd', 'Coluna C'], rows);
    expect(c.mapping.barcode).toBe('Coluna C');
    expect(c.notes.join(' ')).toMatch(/CÓDIGO DE BARRAS/);
  });

  it('«Código» que já é o EAN também serve de código de barras', () => {
    const rows = eans.map((e, i) => ({ 'Código': e, 'Descrição': `Prod ${i}`, 'Stock': 3 }));
    const c = detectProductColumns(['Código', 'Descrição', 'Stock'], rows);
    expect(c.mapping.barcode).toBeUndefined();
    expect(c.barcodeFromCode).toBe(true);
  });

  it('escolha manual do utilizador tem a última palavra (e «vazio» desliga o campo)', () => {
    const rows = [{ A: 'x', B: '1', C: '2' }];
    const c = detectProductColumns(['A', 'B', 'C'], rows, { name: 'A', stock: 'C', salePrice: '' });
    expect(c.mapping.name).toBe('A');
    expect(c.mapping.stock).toBe('C');
    expect(c.mapping.salePrice).toBeUndefined();
  });
});

describe('Excel: zeros à esquerda', () => {
  it('célula numérica formatada «0000000000000» mantém os zeros', () => {
    const ws: XLSX.WorkSheet = {
      A1: { t: 's', v: 'Nome' }, B1: { t: 's', v: 'Código de barras' }, C1: { t: 's', v: 'Stock' },
      A2: { t: 's', v: 'Arroz' }, B2: { t: 'n', v: 12345678905, z: '0000000000000' }, C2: { t: 'n', v: 7 },
      '!ref': 'A1:C2',
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'P');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    const { rows } = parseUploadedFile(buf, 'produtos.xlsx', 'products');
    expect(readBarcode(rows[0]['Código de barras']).value).toBe('0012345678905');
    expect(rows[0]['Stock']).toBe(7); // quantidades não são mexidas
  });
});
