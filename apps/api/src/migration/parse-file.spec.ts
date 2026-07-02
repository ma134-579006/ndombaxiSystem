import { parseUploadedFile } from './parse-file';

describe('parseUploadedFile — SAF-T XML', () => {
  const saft = `<?xml version="1.0"?><AuditFile><MasterFiles>
    <Product><ProductType>P</ProductType><ProductCode>A1</ProductCode><ProductDescription>Água 1,5L</ProductDescription><ProductNumberCode>560000001</ProductNumberCode></Product>
    <Product><ProductType>P</ProductType><ProductCode>A2</ProductCode><ProductDescription>Pão de forma</ProductDescription><ProductNumberCode>560000002</ProductNumberCode></Product>
    <Customer><CustomerID>C1</CustomerID><CustomerTaxID>5000412218</CustomerTaxID><CompanyName>Loja do Zé</CompanyName><Telephone>923000000</Telephone></Customer>
    <Customer><CustomerID>C2</CustomerID><CustomerTaxID>999999990</CustomerTaxID><CompanyName>Consumidor Final</CompanyName></Customer>
  </MasterFiles></AuditFile>`;

  it('extrai produtos do SAF-T', () => {
    const { rows } = parseUploadedFile(Buffer.from(saft), 'saft.xml', 'products');
    expect(rows).toHaveLength(2);
    expect(rows[0]['Nome']).toBe('Água 1,5L');
    expect(rows[0]['Código']).toBe('A1');
  });

  it('extrai clientes e ignora "Consumidor Final"', () => {
    const { rows } = parseUploadedFile(Buffer.from(saft), 'saft.xml', 'customers');
    expect(rows).toHaveLength(1);
    expect(rows[0]['Nome']).toBe('Loja do Zé');
    expect(rows[0]['NIF']).toBe('5000412218');
  });

  it('rejeita XML que não é SAF-T', () => {
    expect(() => parseUploadedFile(Buffer.from('<html><body>x</body></html>'), 'pagina.xml', 'products'))
      .toThrow(/SAF-?T/i);
  });
});

describe('parseUploadedFile — SQL dump', () => {
  const dump = `
    CREATE TABLE produtos (id int, nome text);
    INSERT INTO produtos (codigo, nome, preco) VALUES ('P1', 'Arroz 1kg', 1200), ('P2', 'Feijão, saco', 2500);
    INSERT INTO \`produtos\` (codigo, nome, preco) VALUES ('P3', 'Óleo 900ml', NULL);
    INSERT INTO clientes (nome, nif) VALUES ('Ana', '004274979BE042');
  `;

  it('extrai a tabela de produtos e respeita vírgulas dentro de aspas', () => {
    const { headers, rows } = parseUploadedFile(Buffer.from(dump), 'export.sql', 'products');
    expect(headers).toEqual(['codigo', 'nome', 'preco']);
    expect(rows).toHaveLength(3); // junta os dois INSERT da mesma tabela
    expect(rows[1]['nome']).toBe('Feijão, saco'); // vírgula dentro de aspas preservada
    expect(rows[2]['preco']).toBe(''); // NULL → vazio
  });

  it('escolhe a tabela de clientes quando kind=customers', () => {
    const { rows } = parseUploadedFile(Buffer.from(dump), 'export.sql', 'customers');
    expect(rows).toHaveLength(1);
    expect(rows[0]['nome']).toBe('Ana');
  });

  it('rejeita .sql sem INSERT', () => {
    expect(() => parseUploadedFile(Buffer.from('SELECT 1;'), 'x.sql', 'products')).toThrow(/INSERT/i);
  });
});
