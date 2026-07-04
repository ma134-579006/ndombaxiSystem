import { DocumentType } from '../document-types';
import { IvaCode } from '../iva';
import { computeInvoice } from '../tax-calculator';
import { FiscalDocument } from '../types';
import { buildSaftXml } from './saft-builder';
import { escapeXml } from './xml';

function makeDoc(): FiscalDocument {
  const { lines, totals } = computeInvoice([
    { productCode: 'P1', description: 'Café & Açúcar', quantity: 2, unitPrice: 1000, ivaCode: IvaCode.NOR },
    { productCode: 'P2', description: 'Pão', quantity: 1, unitPrice: 500, ivaCode: IvaCode.RED },
  ]);
  return {
    type: DocumentType.FT,
    number: 'FT A/2025/0001',
    invoiceDate: '2025-01-15',
    systemEntryDate: '2025-01-15T10:00:00',
    customerTaxId: '5417000000',
    lines,
    totals,
  };
}

describe('escapeXml', () => {
  it('escapes the five XML special characters', () => {
    expect(escapeXml(`a & b < c > d " e ' f`)).toBe(
      'a &amp; b &lt; c &gt; d &quot; e &apos; f',
    );
  });
});

describe('buildSaftXml', () => {
  const xml = buildSaftXml({
    company: {
      taxRegistrationNumber: '5000000000',
      companyName: 'Empresa Teste, Lda',
      fiscalYear: 2025,
      startDate: '2025-01-01',
      endDate: '2025-01-31',
    },
    documents: [makeDoc()],
    dateCreated: '2025-02-01',
  });

  it('emits a declaration and AuditFile root with the AGT namespace', () => {
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:AO_1.01_01"');
    expect(xml).toContain('</AuditFile>');
  });

  it('emits the mandatory CompanyAddress (fallback Desconhecido)', () => {
    expect(xml).toContain('<CompanyAddress><AddressDetail>Desconhecido</AddressDetail><City>Desconhecido</City><Country>AO</Country></CompanyAddress>');
  });

  it('emits Customer and Product master files derived from the documents', () => {
    expect(xml).toContain('<CustomerID>5417000000</CustomerID>');
    expect(xml).toContain('<CustomerTaxID>5417000000</CustomerTaxID>');
    expect(xml).toContain('<ProductCode>P1</ProductCode>');
    expect(xml).toContain('<ProductDescription>Café &amp; Açúcar</ProductDescription>');
    expect(xml).toContain('<ProductType>P</ProductType>');
  });

  it('normalises SystemEntryDate to yyyy-mm-ddThh:mm:ss (no millis/timezone)', () => {
    const withMillis = buildSaftXml({
      company: { taxRegistrationNumber: '5', companyName: 'X', fiscalYear: 2025, startDate: '2025-01-01', endDate: '2025-01-31' },
      documents: [{ ...makeDoc(), systemEntryDate: '2025-01-15T10:00:00.123Z' }],
      dateCreated: '2025-02-01',
    });
    expect(withMillis).toContain('<SystemEntryDate>2025-01-15T10:00:00</SystemEntryDate>');
  });

  it('uses Consumidor Final (NIF 999999999) when the document has no customer', () => {
    const anon = buildSaftXml({
      company: { taxRegistrationNumber: '5', companyName: 'X', fiscalYear: 2025, startDate: '2025-01-01', endDate: '2025-01-31' },
      documents: [{ ...makeDoc(), customerTaxId: undefined }],
      dateCreated: '2025-02-01',
    });
    expect(anon).toContain('<CustomerID>Consumidor Final</CustomerID>');
    expect(anon).toContain('<CustomerTaxID>999999999</CustomerTaxID>');
  });

  it('uses real customer names/addresses when provided', () => {
    const named = buildSaftXml({
      company: { taxRegistrationNumber: '5', companyName: 'X', fiscalYear: 2025, startDate: '2025-01-01', endDate: '2025-01-31' },
      customers: [{ taxId: '5417000000', name: 'Cliente Real, Lda', addressDetail: 'Rua 1', city: 'Luanda' }],
      documents: [makeDoc()],
      dateCreated: '2025-02-01',
    });
    expect(named).toContain('<CompanyName>Cliente Real, Lda</CompanyName>');
    expect(named).toContain('<AddressDetail>Rua 1</AddressDetail>');
    expect(named).toContain('<City>Luanda</City>');
  });

  it('includes header identity and currency AOA', () => {
    expect(xml).toContain('<TaxRegistrationNumber>5000000000</TaxRegistrationNumber>');
    expect(xml).toContain('<CurrencyCode>AOA</CurrencyCode>');
  });

  it('builds a tax table with one entry per IVA code', () => {
    expect(xml).toContain('<TaxCode>NOR</TaxCode>');
    expect(xml).toContain('<TaxPercentage>14.00</TaxPercentage>');
    expect(xml).toContain('<TaxCode>RED</TaxCode>');
    expect(xml).toContain('<TaxPercentage>5.00</TaxPercentage>');
  });

  it('emits the invoice with escaped text and correct totals', () => {
    expect(xml).toContain('<InvoiceNo>FT A/2025/0001</InvoiceNo>');
    expect(xml).toContain('Café &amp; Açúcar');
    expect(xml).toContain('<GrossTotal>2805.00</GrossTotal>'); // 2280 + 525
    expect(xml).toContain('<NetTotal>2500.00</NetTotal>');
    expect(xml).toContain('<TaxPayable>305.00</TaxPayable>');
  });

  it('reports the number of entries', () => {
    expect(xml).toContain('<NumberOfEntries>1</NumberOfEntries>');
  });

  it('uses default software identity when no config is given', () => {
    expect(xml).toContain('<SoftwareCertificateNumber>0</SoftwareCertificateNumber>');
    expect(xml).toContain('<ProductID>Ndombaxi System/Ndombaxi</ProductID>');
    expect(xml).toContain('<AuditFileVersion>1.01_01</AuditFileVersion>');
  });

  it('honours Super-Admin-configured software fields and the document hash', () => {
    const configured = buildSaftXml({
      company: {
        taxRegistrationNumber: '5000000000',
        companyName: 'Empresa Teste, Lda',
        fiscalYear: 2025,
        startDate: '2025-01-01',
        endDate: '2025-01-31',
      },
      software: {
        softwareCertificateNumber: '345/AGT',
        productId: 'NEXUS ERP/ACME',
        productVersion: '3.1.0',
        sourceId: 'ACME',
        saftVersion: '1.02_01',
      },
      documents: [{ ...makeDoc(), hash: 'ABC123SIGNATURE==' }],
      dateCreated: '2025-02-01',
    });
    expect(configured).toContain('<SoftwareCertificateNumber>345/AGT</SoftwareCertificateNumber>');
    expect(configured).toContain('<ProductID>NEXUS ERP/ACME</ProductID>');
    expect(configured).toContain('<ProductVersion>3.1.0</ProductVersion>');
    expect(configured).toContain('<AuditFileVersion>1.02_01</AuditFileVersion>');
    expect(configured).toContain('<SourceID>ACME</SourceID>');
    expect(configured).toContain('<Hash>ABC123SIGNATURE==</Hash>');
  });
});
