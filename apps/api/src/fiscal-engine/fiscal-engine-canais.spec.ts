import { printableOutput } from './fiscal-engine.service';
import { VendusClient, type FetchLike } from './vendus.client';
import { webPaymentType } from '../ecommerce/orders.service';

describe('loja online / associados → forma de pagamento do motor Vendus', () => {
  it.each([
    ['CASH', 'CASH'],
    ['BANK_TRANSFER', 'TRANSFER'],
    ['MULTICAIXA_EXPRESS', 'EXPRESS'],
    ['REFERENCE', 'REFERENCE'],
    ['card', 'CARD'],
    [null, 'TRANSFER'],
    ['QUALQUER', 'TRANSFER'],
  ])('%s → %s', (inp, out) => expect(webPaymentType(inp)).toBe(out));
});

describe('talão imprimível devolvido pelo Vendus', () => {
  it('HTML directo em output_data', () => {
    expect(printableOutput({ output: 'html', output_data: '<html><body>FR 1</body></html>' }, 'html')).toContain('FR 1');
  });
  it('HTML em base64', () => {
    const b64 = Buffer.from('<html><body>FR 2</body></html>').toString('base64');
    expect(printableOutput({ output: 'html', output_data: b64 }, 'html')).toContain('FR 2');
  });
  it('ESC/POS em base64 mantém-se base64', () => {
    const b64 = Buffer.from('\x1b@FR 3\n\x1dVB\x00', 'binary').toString('base64');
    expect(Buffer.from(printableOutput({ output: 'escpos', output_data: b64 }, 'escpos')!, 'base64')[0]).toBe(0x1b);
  });
  it('ESC/POS em bruto → convertido para base64', () => {
    const out = printableOutput({ output: 'escpos', output_data: '\x1b@FR 4' }, 'escpos')!;
    expect(Buffer.from(out, 'base64').toString('binary')).toBe('\x1b@FR 4');
  });
  it('sem conteúdo → null (nunca um talão inventado)', () => {
    expect(printableOutput({ output: 'html' }, 'html')).toBeNull();
    expect(printableOutput({}, 'escpos')).toBeNull();
  });
});

describe('pedido do talão ao Vendus', () => {
  it('GET documents/{id}/ com output, output_version e register_id (chave só no cabeçalho)', async () => {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url, init) => {
      calls.push(url);
      expect((init as any)?.headers?.Authorization).toBe('Bearer k-1234567890');
      const body = JSON.stringify({ id: 7, output: 'html', output_data: '<p>x</p>' });
      return { status: 200, headers: { get: () => null }, text: async () => body, arrayBuffer: async () => new ArrayBuffer(0) };
    };
    const api = new VendusClient({ baseUrl: 'https://www.vendus.co.ao/ws', version: '1.1', apiKey: 'k-1234567890', fetchImpl });
    const r = await api.documentOutput('7', { output: 'html', version: 'DUPLICATE', registerId: '9' });
    expect(r.ok).toBe(true);
    const u = new URL(calls[0]);
    expect(u.pathname).toBe('/ws/v1.1/documents/7/');
    expect(u.searchParams.get('output')).toBe('html');
    expect(u.searchParams.get('output_version')).toBe('SECOND');
    expect(u.searchParams.get('register_id')).toBe('9');
    expect(calls[0]).not.toContain('k-1234567890');
  });
});
