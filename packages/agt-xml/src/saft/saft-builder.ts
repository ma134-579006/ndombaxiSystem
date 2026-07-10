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
  /** Morada da sede (CompanyAddress/AddressDetail — obrigatório no XSD). */
  addressDetail?: string;
  /** Cidade da sede (CompanyAddress/City — obrigatório no XSD). */
  city?: string;
}

/** Cliente para o MasterFiles (o XSD exige um Customer por CustomerID referenciado). */
export interface SaftCustomer {
  /** NIF do cliente; omisso = consumidor final. */
  taxId?: string;
  name: string;
  addressDetail?: string;
  city?: string;
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
  /** Clientes conhecidos (nome/morada); os restantes derivam dos documentos. */
  customers?: SaftCustomer[];
  /** Identificação do software (config AGT). Usa defaults quando omitido. */
  software?: SaftSoftware;
  /** When the file was generated; ISO 8601. Defaults to now. */
  dateCreated?: string;
}

/** Normaliza um instante para o formato exigido pelo XSD: yyyy-mm-ddThh:mm:ss
 *  (sem milissegundos nem sufixo de fuso — o validador da AGT rejeita extras). */
function xsdDateTime(iso: string): string {
  return iso.length > 19 ? iso.slice(0, 19) : iso;
}

const FINAL_CONSUMER_ID = 'Consumidor Final';
const UNKNOWN = 'Desconhecido';

function buildHeader(c: SaftCompany, sw: Required<SaftSoftware>, dateCreated: string): string {
  return node('Header', [
    el('AuditFileVersion', sw.saftVersion),
    el('CompanyID', c.taxRegistrationNumber),
    el('TaxRegistrationNumber', c.taxRegistrationNumber),
    el('TaxAccountingBasis', sw.taxAccountingBasis),
    el('CompanyName', c.companyName),
    // CompanyAddress é OBRIGATÓRIO no XSD — sem ele o validador da AGT rejeita.
    node('CompanyAddress', [
      el('AddressDetail', c.addressDetail || UNKNOWN),
      el('City', c.city || UNKNOWN),
      el('Country', 'AO'),
    ]),
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

/**
 * Customer master file: o XSD exige um <Customer> por cada CustomerID
 * referenciado nas faturas. Combina os clientes fornecidos (nome/morada reais)
 * com os derivados dos documentos (só NIF) e o Consumidor Final.
 */
function buildCustomers(documents: FiscalDocument[], provided: SaftCustomer[]): string[] {
  const byId = new Map<string, SaftCustomer>();
  for (const c of provided) {
    byId.set(c.taxId?.trim() || FINAL_CONSUMER_ID, c);
  }
  for (const d of documents) {
    const id = d.customerTaxId?.trim() || FINAL_CONSUMER_ID;
    if (!byId.has(id)) byId.set(id, { taxId: d.customerTaxId ?? undefined, name: id === FINAL_CONSUMER_ID ? FINAL_CONSUMER_ID : UNKNOWN });
  }
  return [...byId.entries()].map(([id, c]) =>
    node('Customer', [
      el('CustomerID', id),
      el('AccountID', UNKNOWN),
      // Consumidor final: NIF genérico 999999999 (convenção SAF-T).
      el('CustomerTaxID', c.taxId?.trim() || '999999999'),
      el('CompanyName', c.name || id),
      node('BillingAddress', [
        el('AddressDetail', c.addressDetail || UNKNOWN),
        el('City', c.city || UNKNOWN),
        el('Country', 'AO'),
      ]),
      el('SelfBillingIndicator', 0),
    ]),
  );
}

/** Product master file: um <Product> por código distinto referenciado nas linhas. */
function buildProducts(documents: FiscalDocument[]): string[] {
  const byCode = new Map<string, string>();
  for (const d of documents) {
    for (const l of d.lines) {
      if (!byCode.has(l.productCode)) byCode.set(l.productCode, l.description);
    }
  }
  return [...byCode.entries()].map(([code, description]) =>
    node('Product', [
      el('ProductType', 'P'),
      el('ProductCode', code),
      el('ProductDescription', description || code),
      el('ProductNumberCode', code),
    ]),
  );
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
      el('InvoiceStatusDate', xsdDateTime(doc.systemEntryDate)),
      el('SourceID', sw.sourceId),
      el('SourceBilling', 'P'),
    ]),
    // Modelo AGT: o Hash do SAF-T é a ASSINATURA RSA (base64) da signable string;
    // sem assinatura (docs antigos), degrada para o SHA-256 encadeado. O
    // HashControl indica a versão da chave privada que assinou.
    el('Hash', doc.signature ?? doc.hash ?? ''),
    el('HashControl', String(doc.signatureKeyVersion ?? 1)),
    el('InvoiceDate', doc.invoiceDate),
    el('InvoiceType', doc.type),
    node('SpecialRegimes', [
      el('SelfBillingIndicator', '0'),
      el('CashVATSchemeIndicator', '0'),
      el('ThirdPartiesBillingIndicator', '0'),
    ]),
    el('SystemEntryDate', xsdDateTime(doc.systemEntryDate)),
    el('CustomerID', doc.customerTaxId?.trim() || FINAL_CONSUMER_ID),
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

/** Namespace oficial do SAF-T (AO) — sem ele o validador da AGT rejeita o ficheiro. */
const SAFT_AO_NAMESPACE = 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01';

export function buildSaftXml(input: SaftInput): string {
  const dateCreated = input.dateCreated ?? new Date().toISOString().slice(0, 10);
  const sw: Required<SaftSoftware> = { ...SAFT_SOFTWARE_DEFAULTS, ...input.software };
  const children = [
    buildHeader(input.company, sw, dateCreated),
    // Ordem do XSD: Customer → Product → TaxTable.
    node('MasterFiles', [
      ...buildCustomers(input.documents, input.customers ?? []),
      ...buildProducts(input.documents),
      buildTaxTable(input.documents),
    ]),
    node('SourceDocuments', [buildSalesInvoices(input.documents, sw)]),
  ].filter((c) => c !== '').join('');
  return `${XML_DECLARATION}<AuditFile xmlns="${SAFT_AO_NAMESPACE}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${children}</AuditFile>`;
}
