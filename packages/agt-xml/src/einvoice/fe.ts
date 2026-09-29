import { randomUUID } from 'node:crypto';
import { signJws } from './jws';
import { round2 } from '../money';
import type { InvoiceLineComputed, InvoiceTotals } from '../types';

/**
 * Cliente da Facturação Electrónica AGT (documentação oficial "Facturação
 * Electrónica v1", schemaVersion 2.0). Funções PURAS: montam e assinam os
 * pedidos; o envio HTTP vive na API. Endpoints:
 *   HML  https://sifphml.minfin.gov.ao/sigt/fe/v1/<serviço>
 *   PROD https://sifp.minfin.gov.ao/sigt/fe/v1/<serviço>
 * Autenticação HTTP Basic (produtor de software). Assinaturas JWS RS256.
 */

export const FE_SCHEMA_VERSION = '2.0';
export const FE_MAX_DOCUMENTS = 30;
export const FE_BASE_URL = {
  HML: 'https://sifphml.minfin.gov.ao/sigt/fe/v1',
  PROD: 'https://sifp.minfin.gov.ao/sigt/fe/v1',
} as const;
export type FeEnvironment = keyof typeof FE_BASE_URL;

export const FE_DOCUMENT_TYPES = ['FA', 'FT', 'FR', 'FG', 'GF', 'AC', 'AR', 'TV', 'RC', 'RG', 'RE', 'ND', 'NC', 'AF', 'RP', 'RA', 'CS', 'LD'] as const;

/** Tipos internos → códigos AGT da FE. FS (factura-recibo) = FR. Outros (RC/GR/ORC) não são enviados nesta versão. */
export function toFeDocumentType(internal: string): string | null {
  switch (internal) {
    case 'FT': return 'FT';
    case 'FS': return 'FR';
    case 'NC': return 'NC';
    case 'ND': return 'ND';
    default: return null;
  }
}

export interface FeSoftwareInfoDetail {
  productId: string;
  productVersion: string;
  softwareValidationNumber: string;
}

export interface FeSigningContext {
  taxRegistrationNumber: string;
  software: FeSoftwareInfoDetail & { signatureVersion: number };
  /** Chave privada do PRODUTOR (RSA ≥ 2048) — jwsSoftwareSignature. */
  softwarePrivateKeyPem: string;
  /** Chave privada do CONTRIBUINTE (emitida pela AGT) — jwsDocumentSignature / jwsSignature. */
  taxpayerPrivateKeyPem: string;
}

export interface FeSourceLine
  extends Pick<InvoiceLineComputed, 'productCode' | 'description' | 'quantity' | 'unitPrice' | 'ivaCode' | 'ivaRate' | 'netAmount' | 'ivaAmount' | 'grossAmount'> {
  /** Desconto como fracção [0,1]. */
  discountRate?: number;
  exemptionCode?: string;
  unitOfMeasure?: string;
  /** true = prestação de serviços (operationType SS); false/undefined = venda de mercadorias (SE). */
  isService?: boolean;
}

export interface FeSourceDocument {
  type: string;
  /** Número completo na série AGT, ex.: "FT FT6325S2C/1000020". */
  number: string;
  invoiceDate: string;
  systemEntryDate: string;
  customerTaxId?: string | null;
  customerName?: string | null;
  customerCountry?: string;
  lines: FeSourceLine[];
  totals: Pick<InvoiceTotals, 'netTotal' | 'ivaTotal' | 'grossTotal'>;
  /** NC: nº do documento de origem. */
  reference?: string;
  referenceReason?: string;
  /** 'C' = correcção de documento rejeitado (exige rejectedDocumentNo). */
  status?: 'N' | 'C';
  rejectedDocumentNo?: string;
}

export interface FeError {
  code: string;
  message: string;
  documentNo?: string;
}

const num = (v: number) => round2(v);
/** taxContribution: arredondado por EXCESSO ao cêntimo (regra AGT). */
const ceil2 = (v: number) => Math.ceil(Math.round(v * 1e6) / 1e4) / 100;

export function mapLine(line: FeSourceLine, index: number, isCredit: boolean, reference?: string, reason?: string) {
  const gross = line.quantity * line.unitPrice;
  const settlement = num(gross * (line.discountRate ?? 0));
  const isExempt = line.ivaCode === 'ISE' || line.ivaCode === 'OUT';
  const tax: Record<string, unknown> = {
    taxType: 'IVA',
    taxCountryRegion: 'AO',
    taxCode: line.ivaCode,
    taxPercentage: line.ivaRate,
    taxContribution: ceil2(line.ivaAmount),
  };
  if (isExempt) tax.taxExemptionCode = line.exemptionCode || 'M99';
  const out: Record<string, unknown> = {
    lineNumber: index + 1,
    operationType: line.isService ? 'SS' : 'SE',
    productCode: line.productCode,
    productDescription: line.description,
    quantity: line.quantity,
    unitOfMeasure: line.unitOfMeasure || 'UN',
    unitPriceBase: num(line.unitPrice),
    unitPrice: num(line.quantity ? line.netAmount / line.quantity : line.unitPrice),
  };
  if (isCredit && reference) out.referenceInfo = { reference, ...(reason ? { reason } : {}) };
  out[isCredit ? 'debitAmount' : 'creditAmount'] = num(line.netAmount);
  out.taxes = [tax];
  out.settlementAmount = settlement;
  return out;
}

/** Documento no formato do serviço registarFactura (+ campos que entram na jwsDocumentSignature). */
export function mapDocumentBody(doc: FeSourceDocument, taxRegistrationNumber: string) {
  const feType = toFeDocumentType(doc.type);
  if (!feType) throw new Error(`Tipo de documento "${doc.type}" não é enviado à Facturação Electrónica.`);
  const isCredit = feType === 'NC';
  const customerTaxID = (doc.customerTaxId || '').trim() || '999999999';
  const customerCountry = doc.customerCountry || 'AO';
  const companyName = (doc.customerName || '').trim() || 'Consumidor Final';
  const documentTotals = {
    taxPayable: num(doc.totals.ivaTotal),
    netTotal: num(doc.totals.netTotal),
    grossTotal: num(doc.totals.grossTotal),
  };
  const body: Record<string, unknown> = {
    documentNo: doc.number,
    documentStatus: doc.status ?? 'N',
  };
  if (doc.status === 'C' && doc.rejectedDocumentNo) body.rejectedDocumentNo = doc.rejectedDocumentNo;
  return {
    feType,
    signedFields: {
      documentNo: doc.number,
      taxRegistrationNumber,
      documentType: feType,
      documentDate: doc.invoiceDate,
      customerTaxID,
      customerCountry,
      companyName,
      documentTotals,
    },
    body: {
      ...body,
      documentDate: doc.invoiceDate,
      documentType: feType,
      systemEntryDate: doc.systemEntryDate.slice(0, 19),
      customerTaxID,
      customerCountry,
      companyName,
      lines: doc.lines.map((l, i) => mapLine(l, i, isCredit, doc.reference, doc.referenceReason)),
      documentTotals,
    } as Record<string, unknown>,
  };
}

/** Pré-validação local — espelha E02/E13/E18/E22–E24 da AGT para não enviar o que será rejeitado. */
export function validateFeDocument(doc: FeSourceDocument): FeError[] {
  const errs: FeError[] = [];
  const add = (code: string, message: string) => errs.push({ code, message, documentNo: doc.number });
  if (!toFeDocumentType(doc.type)) add('E03', `Tipo de documento não suportado: ${doc.type}`);
  if (doc.number.length < 8 || doc.number.length > 60) add('E02', 'documentNo deve ter entre 8 e 60 caracteres.');
  if (!/^[^ ]+ [^/ ]+\/[0-9]+$/.test(doc.number)) add('E02', 'documentNo fora do padrão "<TIPO> <SÉRIE>/<NÚMERO>".');
  if (!doc.lines.length) add('E26', 'Documento sem linhas.');
  const cent = 0.011;
  const net = round2(doc.lines.reduce((s, l) => s + l.netAmount, 0));
  const tax = round2(doc.lines.reduce((s, l) => s + l.ivaAmount, 0));
  const taxContrib = round2(doc.lines.reduce((s, l) => s + ceil2(l.ivaAmount), 0));
  if (Math.abs(net - doc.totals.netTotal) > cent) add('E23', `netTotal (${doc.totals.netTotal}) ≠ soma das linhas (${net}).`);
  if (Math.abs(taxContrib - doc.totals.ivaTotal) > cent && Math.abs(tax - doc.totals.ivaTotal) > cent) {
    add('E22', `taxPayable (${doc.totals.ivaTotal}) ≠ soma das contribuições das linhas (${taxContrib}).`);
  }
  if (Math.abs(round2(doc.totals.netTotal + doc.totals.ivaTotal) - doc.totals.grossTotal) > cent) {
    add('E24', `grossTotal (${doc.totals.grossTotal}) ≠ netTotal + taxPayable.`);
  }
  doc.lines.forEach((l, i) => {
    if (l.quantity < 0 || l.unitPrice < 0) add('E02', `Linha ${i + 1}: quantidade/preço negativos.`);
    if ((l.ivaCode === 'ISE' || l.ivaCode === 'OUT') && !l.exemptionCode) add('E18', `Linha ${i + 1}: isenção sem taxExemptionCode.`);
  });
  if (toFeDocumentType(doc.type) === 'NC' && !doc.reference) add('E13', 'Nota de crédito sem documento de origem (referenceInfo).');
  if (doc.status === 'C' && !doc.rejectedDocumentNo) add('E13', 'Correcção sem rejectedDocumentNo.');
  return errs;
}

function envelope(ctx: FeSigningContext, extra: Record<string, unknown> = {}, withUuid = true) {
  const detail: FeSoftwareInfoDetail = {
    productId: ctx.software.productId,
    productVersion: ctx.software.productVersion,
    softwareValidationNumber: ctx.software.softwareValidationNumber,
  };
  return {
    schemaVersion: FE_SCHEMA_VERSION,
    ...(withUuid ? { submissionUUID: randomUUID() } : {}),
    taxRegistrationNumber: ctx.taxRegistrationNumber,
    submissionTimeStamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
    softwareInfo: {
      softwareInfoDetail: { ...detail, signatureVersion: ctx.software.signatureVersion },
      // O payload assinado é o objecto softwareInfoDetail (productId, productVersion, softwareValidationNumber).
      jwsSoftwareSignature: signJws(detail, ctx.softwarePrivateKeyPem),
    },
    ...extra,
  };
}

/** registarFactura — até 30 documentos por submissão. */
export function buildRegistarFactura(ctx: FeSigningContext, docs: FeSourceDocument[]) {
  if (!docs.length) throw new Error('Sem documentos para enviar.');
  if (docs.length > FE_MAX_DOCUMENTS) throw new Error(`Máximo de ${FE_MAX_DOCUMENTS} documentos por submissão.`);
  const documents = docs.map((d) => {
    const m = mapDocumentBody(d, ctx.taxRegistrationNumber);
    return { ...m.body, jwsDocumentSignature: signJws(m.signedFields, ctx.taxpayerPrivateKeyPem) };
  });
  return envelope(ctx, { numberOfEntries: documents.length, documents });
}

/** solicitarSerie — pede à AGT uma série (o código é atribuído pela AGT). */
export function buildSolicitarSerie(
  ctx: FeSigningContext,
  p: { seriesYear: number; documentType: string; establishmentNumber: string; seriesContingencyIndicator?: 'N' | 'C' },
) {
  const indicator = p.seriesContingencyIndicator ?? 'N';
  return envelope(ctx, {
    seriesYear: p.seriesYear,
    documentType: p.documentType,
    establishmentNumber: p.establishmentNumber,
    seriesContingencyIndicator: indicator,
    jwsSignature: signJws(
      {
        taxRegistrationNumber: ctx.taxRegistrationNumber,
        establishmentNumber: p.establishmentNumber,
        seriesYear: p.seriesYear,
        documentType: p.documentType,
        seriesContingencyIndicator: indicator,
      },
      ctx.taxpayerPrivateKeyPem,
    ),
  });
}

/** listarSeries — filtros opcionais. */
export function buildListarSeries(
  ctx: FeSigningContext,
  p: { establishmentNumber: string; seriesCode?: string; seriesYear?: number; documentType?: string; seriesStatus?: 'A' | 'U' | 'F' },
) {
  const { establishmentNumber, ...filters } = p;
  return envelope(
    ctx,
    {
      establishmentNumber,
      ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
      jwsSignature: signJws({ taxRegistrationNumber: ctx.taxRegistrationNumber }, ctx.taxpayerPrivateKeyPem),
    },
    false,
  );
}

/** obterEstado — estado de uma submissão (requestID devolvido por registarFactura). */
export function buildObterEstado(ctx: FeSigningContext, requestID: string) {
  return envelope(ctx, {
    requestID,
    jwsSignature: signJws({ taxRegistrationNumber: ctx.taxRegistrationNumber, requestID }, ctx.taxpayerPrivateKeyPem),
  });
}

/** consultarFactura — estado/detalhe de um documento. */
export function buildConsultarFactura(ctx: FeSigningContext, documentNo: string) {
  return envelope(ctx, {
    documentNo,
    jwsSignature: signJws({ taxRegistrationNumber: ctx.taxRegistrationNumber, documentNo }, ctx.taxpayerPrivateKeyPem),
  });
}

/** URL do QR Code (Model 2, versão 4, correcção M, UTF-8, PNG 350×350; espaços → %20). */
export function buildFeQrUrl(issuerNif: string, documentNo: string): string {
  return `https://quiosqueagt.minfin.gov.ao/facturacao-eletronica/consultar-fe?emissor=${encodeURIComponent(issuerNif)}&document=${documentNo.replace(/ /g, '%20')}`;
}

/** obterEstado.resultCode. */
export const FE_RESULT = { ALL_VALID: 0, MIXED: 1, NONE_VALID: 2, PREMATURE: 7, PROCESSING: 8, CANCELLED: 9 } as const;

/** documentNo na série AGT: "<TIPO> <SÉRIE>/<SEQUÊNCIA>" (sem zeros à esquerda, sem ano). */
export function formatFeDocumentNo(type: string, seriesCode: string, sequence: number): string {
  if (!/^[A-Za-z0-9]{3,60}$/.test(seriesCode)) throw new Error(`Código de série AGT inválido: "${seriesCode}"`);
  if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Sequência inválida: ${sequence}`);
  return `${type} ${seriesCode}/${sequence}`;
}
