import { IvaCode, SAFT_TAX_TYPE } from '../iva';
import { money } from '../money';
import { FiscalDocument } from '../types';
import { el, node, XML_DECLARATION } from './xml';

/**
 * SAF-T (Angola) builder per AGT (§7.2). Produces the monthly XML file that is
 * submitted to the tax authority. The structure mirrors SAF-T-PT adapted for
 * Angola: Header → MasterFiles (TaxTable) → SourceDocuments (SalesInvoices).
 *
 * This is intentionally a focused subset covering sales invoices; product and
 * customer master tables are emitted from the documents themselves.
 */

export interface SaftCompany {
  /** Tax registration number (NIF). */
  taxRegistrationNumber: string;
  companyName: string;
  /** Fiscal year, e.g. 2025. */
  fiscalYear: number;
  /** Period start date, ISO yyyy-mm-dd. */
  startDate: string;
  /** Period end date, ISO yyyy-mm-dd. */
  endDate: string;
  /** Currency code; AOA for Angola. */
  currencyCode?: string;
}

/**
 * Identificação do software/certificação — tudo o que a AGT fornece quando o
 * sistema é subscrito/certificado. Configurável pelo Super Admin no painel; é
 * injectado aqui pelo serviço, sem valores fixos no código.
 */
export interface SaftSoftware {
  /** Nº de validação atribuído pela AGT (SoftwareCertificateNumber). */
  softwareCertificateNumber?: string;
  productId?: string;
  productVersion?: string;
  taxAccountingBasis?: string;
  taxEntity?: string;
  /** Identificador da origem dos documentos (SourceID). */
  sourceId?: string;
  /** Versão do esquema SAF-T (AuditFileVersion). */
  saftVersion?: string;
}

const SAFT_SOFTWARE_DEFAULTS: Required<SaftSoftware> = {
  softwareCertificateNumber: '0',
  productId: 'Ndombaxi System/Ndombaxi',
  productVersion: '3.0.0',
  taxAccountingBasis: 'F',
  taxEntity: 'Global',
  sourceId: 'Ndombaxi',
  saftVersion: '1.01_01',
};

export interface SaftInput {
  company: SaftCompany;
  documents: FiscalDocument[];
  /** Identificação do software (config AGT). Usa defaults quando omitido. */
  software?: SaftSoftware;
  /** When the file was generated; ISO 8601. Defaults to now. */
  dateCreated?: string;
}

function buildHeader(c: SaftCompany, sw: Required<SaftSoftware>, dateCreated: string): string {
  return node('Header', [
    el('AuditFileVersion', sw.saftVersion),
    el('CompanyID', c.taxRegistrationNumber),
    el('TaxRegistrationNumber', c.taxRegistrationNumber),
    el('TaxAccountingBasis', sw.taxAccountingBasis),
    el('CompanyName', c.companyName),
    el('FiscalYear', c.fiscalYear),
    el('StartDate', c.startDate),
    el('EndDate', c.endDate),
    el('CurrencyCode', c.currencyCode ?? 'AOA'),
    el('DateCreated', dateCreated),
    el('TaxEntity', sw.taxEntity),
    el('ProductCompanyTaxID', c.taxRegistrationNumber),
    el('SoftwareCertificateNumber', sw.softwareCertificateNumber),
    el('ProductID', sw.productId),
    el('ProductVersion', sw.productVersion),
  ]);
}

/** TaxTable entry per distinct IVA code present in the documents. */
function buildTaxTable(documents: FiscalDocument[]): string {
  const seen = new Map<IvaCode, number>();
  for (const doc of documents) {
    for (const line of doc.lines) {
      seen.set(line.ivaCode, line.ivaRate);
    }
  }
  const entries = [...seen.entries()].map(([code, rate]) =>
    node('TaxTableEntry', [
      el('TaxType', SAFT_TAX_TYPE),
      el('TaxCountryRegion', 'AO'),
      el('TaxCode', code),
      el('Description', `IVA ${code} ${rate}%`),
      el('TaxPercentage', rate.toFixed(2)),
    ]),
  );
  return node('TaxTable', entries);
}

function buildLine(line: FiscalDocument['lines'][number], index: number, isCreditNote: boolean, reference?: string): string {
  return node('Line', [
    el('LineNumber', index + 1),
    // Nota de crédito refere o documento de origem (AGT).
    isCreditNote && reference ? node('References', [el('Reference', reference)]) : '',
    el('ProductCode', line.productCode),
    el('ProductDescription', line.description),
    el('Quantity', line.quantity),
    el('UnitOfMeasure', 'UN'),
    el('UnitPrice', money(line.unitPrice)),
    // NC = DebitAmount (estorno); fatura/recibo = CreditAmount.
    isCreditNote ? el('DebitAmount', money(line.netAmount)) : el('CreditAmount', money(line.netAmount)),
    node('Tax', [
      el('TaxType', SAFT_TAX_TYPE),
      el('TaxCountryRegion', 'AO'),
      el('TaxCode', line.ivaCode),
      el('TaxPercentage', line.ivaRate.toFixed(2)),
    ]),
    el('TaxExemptionReason', line.exemptionReason),
    el('TaxExemptionCode', line.exemptionCode),
  ]);
}

function isNc(type: FiscalDocument['type']): boolean {
  return String(type) === 'NC';
}

function buildInvoice(doc: FiscalDocument, sw: Required<SaftSoftware>): string {
  const creditNote = isNc(doc.type);
  return node('Invoice', [
    el('InvoiceNo', doc.number),
    node('DocumentStatus', [
      // Estado real: 'A' anulado / 'N' normal (default).
      el('InvoiceStatus', doc.status === 'A' ? 'A' : 'N'),
      el('InvoiceStatusDate', doc.systemEntryDate),
      el('SourceID', sw.sourceId),
      el('SourceBilling', 'P'),
    ]),
    el('Hash', doc.hash ?? ''),
    el('HashControl', '1'),
    el('InvoiceDate', doc.invoiceDate),
    el('InvoiceType', doc.type),
    node('SpecialRegimes', [
      el('SelfBillingIndicator', '0'),
      el('CashVATSchemeIndicator', '0'),
      el('ThirdPartiesBillingIndicator', '0'),
    ]),
    el('SystemEntryDate', doc.systemEntryDate),
    el('CustomerID', doc.customerTaxId ?? 'Consumidor Final'),
    ...doc.lines.map((l, i) => buildLine(l, i, creditNote, doc.reference)),
    node('DocumentTotals', [
      el('TaxPayable', money(doc.totals.ivaTotal)),
      el('NetTotal', money(doc.totals.netTotal)),
      el('GrossTotal', money(doc.totals.grossTotal)),
    ]),
  ]);
}

function buildSalesInvoices(documents: FiscalDocument[], sw: Required<SaftSoftware>): string {
  // Faturas/recibos somam em crédito; notas de crédito (NC) somam em débito.
  let totalCredit = 0, totalDebit = 0;
  for (const d of documents) {
    const v = d.totals.netTotal + d.totals.ivaTotal;
    if (isNc(d.type)) totalDebit += v; else totalCredit += v;
  }
  return node('SalesInvoices', [
    el('NumberOfEntries', documents.length),
    el('TotalDebit', money(totalDebit)),
    el('TotalCredit', money(totalCredit)),
    ...documents.map((d) => buildInvoice(d, sw)),
  ]);
}

export function buildSaftXml(input: SaftInput): string {
  const dateCreated = input.dateCreated ?? new Date().toISOString().slice(0, 10);
  const sw: Required<SaftSoftware> = { ...SAFT_SOFTWARE_DEFAULTS, ...input.software };
  const body = node('AuditFile', [
    buildHeader(input.company, sw, dateCreated),
    node('MasterFiles', [buildTaxTable(input.documents)]),
    node('SourceDocuments', [buildSalesInvoices(input.documents, sw)]),
  ]);
  return `${XML_DECLARATION}${body}`;
}
