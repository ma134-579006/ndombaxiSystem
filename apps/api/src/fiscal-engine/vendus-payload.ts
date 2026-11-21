/**
 * Monta o corpo de POST /documents/ (Cegid Vendus API v1.1) a partir de uma venda do
 * LPS. Só usa campos da especificação oficial; o que não tiver correspondência
 * CONFIRMADA na conta Vendus (imposto, isenção, forma de pagamento) é ERRO — nunca
 * se assume que um código português equivale a um angolano.
 */

export interface SaleLine {
  productCode: string;
  description: string;
  quantity: number;
  unitPrice: number; // sem IVA, antes do desconto
  ivaCode: string;
  ivaRate: number;
  discountRate: number; // 0..1
  grossAmount: number;
  exemptionCode?: string | null;
}

export interface SaleSnapshot {
  invoiceId: string;
  internalNumber: string;
  docType: string; // FT | FS (LPS)
  paymentType: string; // CASH | CARD | TRANSFER | CREDIT | MIXED …
  payments?: { method: string; amount: number }[] | null;
  grossTotal: number;
  customer?: { id?: string | null; taxId?: string | null; name?: string | null; address?: string | null; email?: string | null; phone?: string | null } | null;
  lines: SaleLine[];
}

export interface CreditNoteSnapshot {
  sourceVendusNumber: string;
  reason: string;
  /** Linhas a creditar: linha do documento Vendus original (1..n) e quantidade. */
  lines: { row: number; vendusItemId?: number | string | null; reference: string; quantity: number }[];
}

export interface CompanyMaps {
  registerId: string;
  taxMap: Record<string, string>; // código LPS → tax_id da conta Vendus (confirmado em GET /taxes/)
  exemptions: string[]; // códigos de isenção existentes na conta (GET /taxes/exemptions/)
  paymentMap: Record<string, string>; // CASH/CARD/TRANSFER… → id da forma de pagamento Vendus
}

export interface PayloadResult {
  body?: Record<string, unknown>;
  errors: string[];
}

const NIF_RE = /^[A-Z0-9]{5,20}$/;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Tipo Vendus: venda a crédito → FT (Factura); paga no acto → FR (Factura-Recibo). FS não existe na FE AGT. */
export function vendusTypeFor(sale: Pick<SaleSnapshot, 'paymentType'>): 'FT' | 'FR' {
  return sale.paymentType === 'CREDIT' ? 'FT' : 'FR';
}

export function buildSaleDocument(sale: SaleSnapshot, maps: CompanyMaps, op: { txId: string; externalReference: string; mode: 'normal' | 'tests' }): PayloadResult {
  const errors: string[] = [];
  if (!maps.registerId) errors.push('Caixa Vendus por configurar');
  if (!sale.lines.length) errors.push('Venda sem linhas');
  const items = sale.lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) errors.push(`Linha ${i + 1}: quantidade ${l.quantity} — a API Vendus v1.1 só aceita quantidades inteiras (qty integer)`);
    const taxId = maps.taxMap[l.ivaCode];
    if (!taxId) errors.push(`Linha ${i + 1}: imposto ${l.ivaCode} sem correspondência confirmada na conta Vendus`);
    const item: Record<string, unknown> = {
      reference: l.productCode,
      title: l.description.slice(0, 200),
      qty: l.quantity,
      // gross_price = preço unitário COM imposto (o Vendus calcula a base a partir dele).
      gross_price: r2(l.unitPrice * (1 + l.ivaRate / 100)).toFixed(2),
      tax_id: taxId,
    };
    if (l.discountRate > 0) item.discount_percentage = (Math.round(l.discountRate * 10000) / 100).toString();
    if (l.ivaRate === 0) {
      const ex = (l.exemptionCode ?? '').trim();
      if (!ex) errors.push(`Linha ${i + 1}: isenção sem código de motivo`);
      else if (!maps.exemptions.includes(ex)) errors.push(`Linha ${i + 1}: motivo de isenção ${ex} não existe na conta Vendus`);
      else item.tax_exemption = ex;
    }
    return item;
  });
  const body: Record<string, unknown> = {
    register_id: Number(maps.registerId) || maps.registerId,
    type: vendusTypeFor(sale),
    mode: op.mode,
    external_reference: op.externalReference,
    tx_id: op.txId,
    errors_full: 'yes',
    items,
  };
  const c = sale.customer;
  const nif = String(c?.taxId ?? '').toUpperCase().trim();
  // "you should NEVER send fiscal_id as 999999990" — consumidor final vai sem cliente.
  if (c && nif && nif !== '999999990' && NIF_RE.test(nif)) {
    body.client = {
      fiscal_id: nif,
      name: (c.name ?? '').slice(0, 120) || undefined,
      address: c.address || undefined,
      email: c.email || undefined,
      phone: c.phone || undefined,
      country: 'AO',
      external_reference: c.id || undefined,
      send_email: 'no',
    };
  } else if (c && nif && nif !== '999999990') {
    errors.push(`NIF do cliente inválido: ${nif}`);
  }
  if (vendusTypeFor(sale) === 'FR') {
    const pays = sale.payments?.length ? sale.payments : [{ method: sale.paymentType, amount: sale.grossTotal }];
    const mapped = pays.map((p) => ({ id: maps.paymentMap[p.method], amount: r2(p.amount).toFixed(2) }));
    // Sem correspondência configurada para TODAS as formas: não se envia (o Vendus usa a da caixa).
    if (mapped.every((p) => p.id)) body.payments = mapped;
  }
  return errors.length ? { errors } : { body, errors };
}

export function buildCreditNote(nc: CreditNoteSnapshot, maps: CompanyMaps, op: { txId: string; externalReference: string; mode: 'normal' | 'tests' }): PayloadResult {
  const errors: string[] = [];
  if (!maps.registerId) errors.push('Caixa Vendus por configurar');
  if (!nc.sourceVendusNumber) errors.push('Documento de origem sem número Vendus');
  if (!nc.reason.trim()) errors.push('Nota de crédito sem motivo');
  if (!nc.lines.length) errors.push('Nota de crédito sem linhas');
  const items = nc.lines.map((l, i) => {
    if (!Number.isInteger(l.quantity) || l.quantity <= 0) errors.push(`Linha ${i + 1}: quantidade ${l.quantity} não inteira`);
    const it: Record<string, unknown> = { reference: l.reference, qty: l.quantity, reference_document: { document_number: nc.sourceVendusNumber, document_row: l.row } };
    if (l.vendusItemId != null && l.vendusItemId !== '') it.id = Number(l.vendusItemId) || l.vendusItemId;
    return it;
  });
  if (errors.length) return { errors };
  return {
    errors,
    body: {
      register_id: Number(maps.registerId) || maps.registerId,
      type: 'NC',
      mode: op.mode,
      notes: nc.reason.slice(0, 250),
      external_reference: op.externalReference,
      tx_id: op.txId,
      errors_full: 'yes',
      items,
    },
  };
}

/** Divergência entre o total do LPS e o do documento fiscal devolvido (arredondamentos). */
export function totalsDivergence(lpsGross: number, vendusGross: unknown): string | null {
  const v = Number(vendusGross);
  if (!Number.isFinite(v)) return null;
  const d = Math.abs(r2(v) - r2(lpsGross));
  return d > 0.009 ? `Total Vendus ${v.toFixed(2)} ≠ total LPS ${lpsGross.toFixed(2)} (diferença ${d.toFixed(2)})` : null;
}
