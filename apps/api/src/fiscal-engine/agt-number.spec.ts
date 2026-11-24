import { agtDocumentNumber } from './fiscal-engine.policy';

describe('Número AGT do documento Vendus', () => {
  it('lê o número atribuído pela AGT', () => {
    expect(agtDocumentNumber({ document_number: 'FR4026S94851N/4', qrcode_image: 'data:' })).toBe('FR4026S94851N/4');
    expect(agtDocumentNumber({ documentNumber: 'NC4026S59689N/3' })).toBe('NC4026S59689N/3');
  });
  it('sem número AGT (ainda não atribuído) → null', () => {
    expect(agtDocumentNumber(null)).toBeNull();
    expect(agtDocumentNumber({})).toBeNull();
    expect(agtDocumentNumber({ document_number: '' })).toBeNull();
    expect(agtDocumentNumber({ document_number: 0 })).toBeNull();
    expect(agtDocumentNumber('FR4026S94851N/4')).toBeNull();
  });
});
