import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import {
  buildListarSeries,
  buildObterEstado,
  buildRegistarFactura,
  buildSolicitarSerie,
  FE_BASE_URL,
  FE_MAX_DOCUMENTS,
  FE_RESULT,
  generateSigningKeyPair,
  MIN_FE_KEY_BITS,
  rsaKeyBits,
  toFeDocumentType,
  validateFeDocument,
  type FeEnvironment,
  type FeError,
  type FeSigningContext,
  type FeSourceDocument,
} from '@nexus/agt-xml';
import { createHash } from 'node:crypto';
import { decryptSecret, encryptSecret } from '../common/crypto/secret-box';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';

const CFG_KEY = 'AGT_FE';
const MAX_ATTEMPTS = 6;
const TICK_MS = 60_000;

export interface FeSettings {
  environment: FeEnvironment;
  basicUser: string;
  productId: string;
  productVersion: string;
  softwareValidationNumber: string;
  signatureVersion: number;
  softwarePublicKey?: string;
  enabled: boolean;
}
interface FeSecrets {
  basicPassword?: string;
  softwarePrivateKey?: string;
}

const DEFAULTS: FeSettings = {
  environment: 'HML',
  basicUser: '',
  productId: 'Ndombaxi System/Ndombaxi',
  productVersion: '1.0.0',
  softwareValidationNumber: '',
  signatureVersion: 0,
  enabled: false,
};

interface CallResult {
  status: number;
  json: Record<string, any>;
}

/**
 * Facturação Electrónica AGT (Decreto Presidencial 71/25, Decreto Executivo 683/25).
 *
 * O PRODUTOR (plataforma) tem uma chave RSA ≥ 2048 (jwsSoftwareSignature) cuja
 * pública se regista no Portal do Parceiro e credenciais Basic; cada CONTRIBUINTE
 * (empresa) tem a chave privada emitida pela AGT (jwsDocumentSignature/jwsSignature).
 * Fluxo: solicitarSerie → numeração na série AGT → registarFactura (≤30 docs)
 * → obterEstado (assíncrono) → V/I por documento. Nunca bloqueia a venda: a fila
 * é processada em segundo plano e todos os erros ficam registados.
 */
@Injectable()
export class EinvoiceService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EinvoiceService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get encKey(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  // ── Agendador (segundo plano) ────────────────────────────────────────────
  onModuleInit(): void {
    if (process.env.EINVOICE_SCHEDULER === 'off') return;
    const loop = () => {
      this.timer = setTimeout(async () => {
        await this.tick().catch((e) => this.logger.warn(`tick: ${e instanceof Error ? e.message : e}`));
        loop();
      }, TICK_MS);
      this.timer.unref?.();
    };
    loop();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  /** Processa todas as empresas activas: recolhe → envia → consulta. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const { settings } = await this.loadConfig();
      if (!settings.enabled) return;
      const companies = await this.prisma.einvoiceCompany.findMany({ where: { enabled: true } });
      for (const c of companies) {
        try {
          await this.collect(c.companyId);
          await this.submit(c.companyId);
          await this.poll(c.companyId);
        } catch (e) {
          this.logger.warn(`FE ${c.companyId}: ${e instanceof Error ? e.message : e}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ── Configuração global (Super Admin) ────────────────────────────────────
  private async loadConfig(): Promise<{ settings: FeSettings; secrets: FeSecrets }> {
    const row = await this.prisma.integration.findUnique({ where: { key: CFG_KEY } });
    const settings = { ...DEFAULTS, ...((row?.settings as Partial<FeSettings> | null) ?? {}) };
    let secrets: FeSecrets = {};
    if (row?.secretEnc) {
      try {
        secrets = JSON.parse(decryptSecret(row.secretEnc, this.encKey)) as FeSecrets;
      } catch {
        secrets = {};
      }
    }
    return { settings, secrets };
  }

  private async saveConfig(settings: FeSettings, secrets: FeSecrets): Promise<void> {
    const secretEnc = encryptSecret(JSON.stringify(secrets), this.encKey);
    await this.prisma.integration.upsert({
      where: { key: CFG_KEY },
      create: { key: CFG_KEY, label: 'Facturação Electrónica AGT (DP 71/25)', enabled: settings.enabled, settings: settings as object, secretEnc },
      update: { enabled: settings.enabled, settings: settings as object, secretEnc },
    });
  }

  async getConfigSafe() {
    const { settings, secrets } = await this.loadConfig();
    const bits = secrets.softwarePrivateKey ? rsaKeyBits(secrets.softwarePrivateKey) : 0;
    return {
      ...settings,
      softwarePublicKey: undefined,
      hasBasicPassword: !!secrets.basicPassword,
      hasSoftwareKey: !!secrets.softwarePrivateKey,
      softwareKeyBits: bits,
      softwareKeyFingerprint: settings.softwarePublicKey
        ? createHash('sha256').update(settings.softwarePublicKey).digest('hex')
        : null,
      baseUrl: FE_BASE_URL[settings.environment],
      ready: this.isReady(settings, secrets),
    };
  }

  private isReady(s: FeSettings, sec: FeSecrets): boolean {
    return !!(s.basicUser && sec.basicPassword && sec.softwarePrivateKey && s.softwareValidationNumber && s.signatureVersion > 0);
  }

  async updateConfig(dto: Partial<FeSettings> & { basicPassword?: string }) {
    const { settings, secrets } = await this.loadConfig();
    const next: FeSettings = { ...settings };
    if (dto.environment) next.environment = dto.environment;
    if (dto.basicUser !== undefined) next.basicUser = dto.basicUser.trim();
    if (dto.productId !== undefined) next.productId = dto.productId.trim();
    if (dto.productVersion !== undefined) next.productVersion = dto.productVersion.trim();
    if (dto.softwareValidationNumber !== undefined) next.softwareValidationNumber = dto.softwareValidationNumber.trim();
    if (dto.enabled !== undefined) next.enabled = dto.enabled;
    if (dto.basicPassword) secrets.basicPassword = dto.basicPassword;
    if (next.enabled && !this.isReady(next, secrets)) {
      throw new BadRequestException(
        'Para activar a Facturação Electrónica falta: utilizador/palavra-passe Basic, chave do software (RSA ≥ 2048) e nº de validação do software.',
      );
    }
    await this.saveConfig(next, secrets);
    return this.getConfigSafe();
  }

  /** Gera (ou roda) o par RSA do PRODUTOR (≥ 2048 bits) → jwsSoftwareSignature. */
  async provisionSoftwareKey(bits = MIN_FE_KEY_BITS) {
    const modulus = bits >= 4096 ? 4096 : bits >= 3072 ? 3072 : 2048;
    const { settings, secrets } = await this.loadConfig();
    const pair = generateSigningKeyPair(modulus);
    secrets.softwarePrivateKey = pair.privateKeyPem;
    settings.softwarePublicKey = pair.publicKeyPem;
    settings.signatureVersion = (settings.signatureVersion || 0) + 1;
    await this.saveConfig(settings, secrets);
    return this.getConfigSafe();
  }

  async exportSoftwarePublicKey() {
    const { settings } = await this.loadConfig();
    if (!settings.softwarePublicKey) throw new NotFoundException('Ainda não existe chave do software. Gere-a primeiro.');
    return { fileName: 'public.pem', pem: settings.softwarePublicKey, signatureVersion: settings.signatureVersion };
  }

  // ── Empresa ──────────────────────────────────────────────────────────────
  private async companyOrThrow(companyId: string) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!c) throw new NotFoundException('Empresa não encontrada.');
    return c;
  }

  async companyStatus(companyId: string) {
    await this.companyOrThrow(companyId);
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    const counts = await this.prisma.einvoiceDocument.groupBy({ by: ['status'], where: { companyId }, _count: true });
    const byStatus: Record<string, number> = {};
    for (const c of counts) byStatus[c.status] = c._count;
    return {
      enabled: row?.enabled ?? false,
      enabledFrom: row?.enabledFrom ?? null,
      establishmentNumber: row?.establishmentNumber ?? '1',
      hasTaxpayerKey: !!row?.taxpayerKeyEnc,
      taxpayerKeyBits: row?.taxpayerKeyBits ?? 0,
      series: (row?.series as Record<string, string> | null) ?? {},
      documents: byStatus,
    };
  }

  async saveCompany(
    companyId: string,
    dto: { enabled?: boolean; establishmentNumber?: string; taxpayerPrivateKey?: string },
  ) {
    await this.companyOrThrow(companyId);
    const data: Prisma.EinvoiceCompanyUpdateInput = {};
    if (dto.establishmentNumber !== undefined) data.establishmentNumber = dto.establishmentNumber.trim() || '1';
    if (dto.taxpayerPrivateKey) {
      const pem = dto.taxpayerPrivateKey.trim();
      const bits = rsaKeyBits(pem);
      if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(pem) || bits === 0) {
        throw new BadRequestException('Chave privada inválida: envie o PEM RSA emitido pela AGT no portal do contribuinte.');
      }
      if (bits < MIN_FE_KEY_BITS) throw new BadRequestException(`A chave tem ${bits} bits; a AGT exige RSA ≥ ${MIN_FE_KEY_BITS}.`);
      data.taxpayerKeyEnc = encryptSecret(pem, this.encKey);
      data.taxpayerKeyBits = bits;
    }
    const existing = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    if (dto.enabled !== undefined) {
      if (dto.enabled) {
        const hasKey = !!(data.taxpayerKeyEnc ?? existing?.taxpayerKeyEnc);
        const hasSeries = Object.keys((existing?.series as object | null) ?? {}).length > 0;
        if (!hasKey) throw new BadRequestException('Falta a chave privada do contribuinte (AGT).');
        if (!hasSeries) throw new BadRequestException('Peça primeiro pelo menos uma série à AGT (solicitarSerie).');
        data.enabled = true;
        if (!existing?.enabledFrom) data.enabledFrom = new Date();
      } else {
        data.enabled = false;
      }
    }
    await this.prisma.einvoiceCompany.upsert({
      where: { companyId },
      create: { ...(data as Prisma.EinvoiceCompanyUncheckedCreateInput), companyId },
      update: data,
    });
    return this.companyStatus(companyId);
  }

  /** Código de série AGT configurado para (tipo, ano) — usado pela numeração. */
  async seriesFor(schema: string, docType: string, year: number): Promise<string | null> {
    const feType = toFeDocumentType(docType);
    if (!feType) return null;
    const company = await this.prisma.company.findUnique({ where: { schemaName: schema }, select: { id: true } });
    if (!company) return null;
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId: company.id } });
    if (!row?.enabled) return null;
    const map = (row.series as Record<string, string> | null) ?? {};
    return map[`${feType}-${year}`] ?? null;
  }

  /** true se `series` é um código de série AGT activo desta empresa (para o QR da AGT nos recibos). */
  async isFeSeries(schema: string, series: string | null | undefined): Promise<boolean> {
    if (!series) return false;
    const company = await this.prisma.company.findUnique({ where: { schemaName: schema }, select: { id: true } });
    if (!company) return false;
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId: company.id } });
    if (!row?.enabled) return false;
    return Object.values((row.series as Record<string, string> | null) ?? {}).includes(series);
  }

  // ── HTTP ────────────────────────────────────────────────────────────────
  private async signingContext(companyId: string): Promise<{ ctx: FeSigningContext; settings: FeSettings; secrets: FeSecrets; company: { nif: string; schemaName: string } }> {
    const { settings, secrets } = await this.loadConfig();
    if (!this.isReady(settings, secrets)) throw new BadRequestException('Facturação Electrónica não configurada pelo Super Admin.');
    const company = await this.companyOrThrow(companyId);
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    if (!row?.taxpayerKeyEnc) throw new BadRequestException('A empresa não tem a chave privada do contribuinte (AGT).');
    return {
      settings,
      secrets,
      company: { nif: company.nif, schemaName: company.schemaName },
      ctx: {
        taxRegistrationNumber: company.nif,
        software: {
          productId: settings.productId,
          productVersion: settings.productVersion,
          softwareValidationNumber: settings.softwareValidationNumber,
          signatureVersion: settings.signatureVersion,
        },
        softwarePrivateKeyPem: secrets.softwarePrivateKey!,
        taxpayerPrivateKeyPem: decryptSecret(row.taxpayerKeyEnc, this.encKey),
      },
    };
  }

  private async call(settings: FeSettings, secrets: FeSecrets, service: string, body: object): Promise<CallResult> {
    const url = `${FE_BASE_URL[settings.environment]}/${service}`;
    const auth = Buffer.from(`${settings.basicUser}:${secrets.basicPassword}`).toString('base64');
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Basic ${auth}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let json: Record<string, any>;
    try {
      json = JSON.parse(text) as Record<string, any>;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: res.status, json };
  }

  private errList(json: Record<string, any>): FeError[] {
    const list = (json.errorList as Array<{ idError?: string; descriptionError?: string; documentNo?: string }> | undefined) ?? [];
    return list.map((e) => ({ code: e.idError ?? 'E99', message: e.descriptionError ?? 'Erro', documentNo: e.documentNo }));
  }

  // ── Séries ──────────────────────────────────────────────────────────────
  async requestSeries(companyId: string, documentType: string, year: number) {
    const feType = toFeDocumentType(documentType) ?? documentType;
    const { ctx, settings, secrets } = await this.signingContext(companyId);
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    const req = buildSolicitarSerie(ctx, { seriesYear: year, documentType: feType, establishmentNumber: row?.establishmentNumber ?? '1' });
    const r = await this.call(settings, secrets, 'solicitarSerie', req);
    const result = r.json.seriesFEResult as { seriesCode?: string; authorizedQuantity?: number } | undefined;
    if (r.status !== 200 || !result?.seriesCode) {
      throw new BadRequestException(`AGT recusou o pedido de série: ${this.errList(r.json).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${r.status}`}`);
    }
    const map = { ...((row?.series as Record<string, string> | null) ?? {}), [`${feType}-${year}`]: result.seriesCode };
    await this.prisma.einvoiceCompany.upsert({
      where: { companyId },
      create: { companyId, series: map },
      update: { series: map },
    });
    return { seriesCode: result.seriesCode, authorizedQuantity: result.authorizedQuantity ?? null, series: map };
  }

  async listRemoteSeries(companyId: string) {
    const { ctx, settings, secrets } = await this.signingContext(companyId);
    const row = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    const r = await this.call(settings, secrets, 'listarSeries', buildListarSeries(ctx, { establishmentNumber: row?.establishmentNumber ?? '1' }));
    if (r.status !== 200) throw new BadRequestException(`AGT: ${this.errList(r.json).map((e) => `${e.code} ${e.message}`).join('; ') || `HTTP ${r.status}`}`);
    return r.json.seriesListResult ?? r.json;
  }

  // ── Fila: recolher → enviar → consultar ──────────────────────────────────
  private parseNo(no: string): { type: string; series: string } | null {
    const m = /^([A-Z]+) ([^/ ]+)\/(\d+)$/.exec(no);
    return m ? { type: m[1], series: m[2] } : null;
  }

  /** Põe na fila os documentos emitidos (na série AGT) que ainda não foram enviados. */
  async collect(companyId: string): Promise<number> {
    const cfg = await this.prisma.einvoiceCompany.findUnique({ where: { companyId } });
    if (!cfg?.enabled || !cfg.enabledFrom) return 0;
    const company = await this.companyOrThrow(companyId);
    const codes = new Set(Object.values((cfg.series as Record<string, string> | null) ?? {}));
    if (!codes.size) return 0;
    const rows = await this.prisma.runInTenant(company.schemaName, (tx) =>
      tx.$queryRaw<{ id: string; number: string }[]>(
        Prisma.sql`SELECT id::text AS id, number FROM invoices
                   WHERE doc_type IN ('FT','FS','NC','ND') AND system_entry_date >= ${cfg.enabledFrom}
                   ORDER BY system_entry_date ASC LIMIT 500`,
      ),
    );
    const fe = rows.filter((r) => {
      const p = this.parseNo(r.number);
      return p && codes.has(p.series);
    });
    if (!fe.length) return 0;
    const known = await this.prisma.einvoiceDocument.findMany({
      where: { companyId, documentNo: { in: fe.map((r) => r.number) } },
      select: { documentNo: true },
    });
    const have = new Set(known.map((k) => k.documentNo));
    const fresh = fe.filter((r) => !have.has(r.number));
    if (fresh.length) {
      await this.prisma.einvoiceDocument.createMany({
        data: fresh.map((r) => ({ companyId, invoiceId: r.id, documentNo: r.number })),
        skipDuplicates: true,
      });
    }
    return fresh.length;
  }

  private async loadSources(schema: string, ids: string[]): Promise<Map<string, FeSourceDocument>> {
    const out = new Map<string, FeSourceDocument>();
    if (!ids.length) return out;
    await this.prisma.runInTenant(schema, async (tx) => {
      const heads = await tx.$queryRaw<
        {
          id: string; number: string; doc_type: string; invoice_date: Date; system_entry_date: Date;
          customer_tax_id: string | null; customer_name: string | null;
          net_total: string; iva_total: string; gross_total: string; source_number: string | null;
        }[]
      >(
        Prisma.sql`SELECT i.id::text AS id, i.number, i.doc_type, i.invoice_date, i.system_entry_date, i.customer_tax_id,
                          c.name AS customer_name, i.net_total, i.iva_total, i.gross_total, s.number AS source_number
                   FROM invoices i
                   LEFT JOIN customers c ON c.id = i.customer_id
                   LEFT JOIN invoices s ON s.id = i.source_invoice_id
                   WHERE i.id::text IN (${Prisma.join(ids)})`,
      );
      const items = await tx.$queryRaw<
        {
          invoice_id: string; product_code: string; description: string; quantity: string; unit_price: string;
          iva_code: string; iva_rate: string; discount_rate: string; net_amount: string; iva_amount: string;
          gross_amount: string; exemption_code: string | null;
        }[]
      >(
        Prisma.sql`SELECT invoice_id::text AS invoice_id, product_code, description, quantity, unit_price, iva_code, iva_rate,
                          discount_rate, net_amount, iva_amount, gross_amount, exemption_code
                   FROM invoice_items WHERE invoice_id::text IN (${Prisma.join(ids)}) ORDER BY invoice_id, line_number`,
      );
      for (const h of heads) {
        out.set(h.id, {
          type: h.doc_type,
          number: h.number,
          invoiceDate: h.invoice_date.toISOString().slice(0, 10),
          systemEntryDate: h.system_entry_date.toISOString().slice(0, 19),
          customerTaxId: h.customer_tax_id,
          customerName: h.customer_name,
          totals: { netTotal: Number(h.net_total), ivaTotal: Number(h.iva_total), grossTotal: Number(h.gross_total) },
          reference: h.source_number ?? undefined,
          lines: items
            .filter((it) => it.invoice_id === h.id)
            .map((it) => ({
              productCode: it.product_code,
              description: it.description,
              quantity: Number(it.quantity),
              unitPrice: Number(it.unit_price),
              ivaCode: it.iva_code as never,
              ivaRate: Number(it.iva_rate),
              discountRate: Number(it.discount_rate),
              netAmount: Number(it.net_amount),
              ivaAmount: Number(it.iva_amount),
              grossAmount: Number(it.gross_amount),
              exemptionCode: it.exemption_code ?? undefined,
            })),
        });
      }
    });
    return out;
  }

  /** Envia até 30 documentos em fila (registarFactura). */
  async submit(companyId: string): Promise<{ sent: number; invalid: number; deferred: number; requestId?: string }> {
    const retryBefore = new Date(Date.now() - 5 * 60_000);
    const queue = await this.prisma.einvoiceDocument.findMany({
      where: {
        companyId,
        OR: [{ status: 'QUEUED' }, { status: 'ERROR', attempts: { lt: MAX_ATTEMPTS }, lastAttemptAt: { lt: retryBefore } }],
      },
      orderBy: { createdAt: 'asc' },
      take: FE_MAX_DOCUMENTS,
    });
    if (!queue.length) return { sent: 0, invalid: 0, deferred: 0 };

    const { ctx, settings, secrets, company } = await this.signingContext(companyId);
    const sources = await this.loadSources(company.schemaName, queue.map((q) => q.invoiceId));

    const valid: { q: (typeof queue)[number]; doc: FeSourceDocument }[] = [];
    let invalid = 0;
    for (const q of queue) {
      const doc = sources.get(q.invoiceId);
      const errors: FeError[] = doc ? validateFeDocument(doc) : [{ code: 'E14', message: 'Documento não encontrado na base de dados.', documentNo: q.documentNo }];
      if (errors.length) {
        invalid += 1;
        await this.prisma.einvoiceDocument.update({ where: { id: q.id }, data: { status: 'INVALID', errors: errors as object } });
      } else valid.push({ q, doc: doc! });
    }
    if (!valid.length) return { sent: 0, invalid, deferred: 0 };

    const req = buildRegistarFactura(ctx, valid.map((v) => v.doc)) as Record<string, any>;
    let r: CallResult;
    try {
      r = await this.call(settings, secrets, 'registarFactura', req);
    } catch (e) {
      await this.bumpAttempts(valid.map((v) => v.q.id), e instanceof Error ? e.message : 'rede');
      return { sent: 0, invalid, deferred: valid.length };
    }

    if (r.status === 200 && r.json.requestID) {
      const requestId = String(r.json.requestID);
      await this.prisma.$transaction([
        this.prisma.einvoiceDocument.updateMany({
          where: { id: { in: valid.map((v) => v.q.id) } },
          data: { status: 'SENT', requestId, errors: Prisma.DbNull, lastAttemptAt: new Date() },
        }),
        this.prisma.einvoiceSubmission.create({
          data: { companyId, submissionUuid: String(req.submissionUUID), requestId, documentNos: valid.map((v) => v.q.documentNo) },
        }),
      ]);
      return { sent: valid.length, invalid, deferred: 0, requestId };
    }

    if (r.status === 400) {
      const errs = this.errList(r.json);
      const perDoc = new Map<string, FeError[]>();
      const global: FeError[] = [];
      for (const e of errs) (e.documentNo ? perDoc.set(e.documentNo, [...(perDoc.get(e.documentNo) ?? []), e]) : global.push(e));
      for (const v of valid) {
        const own = [...(perDoc.get(v.q.documentNo) ?? []), ...global];
        await this.prisma.einvoiceDocument.update({
          where: { id: v.q.id },
          data: { status: own.length ? 'INVALID' : 'ERROR', errors: (own.length ? own : [{ code: 'E99', message: 'Rejeitado sem detalhe' }]) as object, attempts: { increment: 1 }, lastAttemptAt: new Date() },
        });
      }
      return { sent: 0, invalid: invalid + valid.length, deferred: 0 };
    }

    // 401/403/422/429/5xx: tenta de novo mais tarde.
    await this.bumpAttempts(valid.map((v) => v.q.id), `HTTP ${r.status}`);
    return { sent: 0, invalid, deferred: valid.length };
  }

  private async bumpAttempts(ids: string[], message: string): Promise<void> {
    await this.prisma.einvoiceDocument.updateMany({
      where: { id: { in: ids } },
      data: { status: 'ERROR', attempts: { increment: 1 }, lastAttemptAt: new Date(), errors: [{ code: 'NET', message }] as object },
    });
  }

  /** Consulta o resultado das submissões enviadas (obterEstado). */
  async poll(companyId: string): Promise<{ checked: number; valid: number; invalid: number }> {
    const subs = await this.prisma.einvoiceSubmission.findMany({
      where: { companyId, status: 'SENT', requestId: { not: null } },
      orderBy: { createdAt: 'asc' },
      take: 10,
    });
    if (!subs.length) return { checked: 0, valid: 0, invalid: 0 };
    const { ctx, settings, secrets } = await this.signingContext(companyId);
    let valid = 0;
    let invalid = 0;
    for (const s of subs) {
      let r: CallResult;
      try {
        r = await this.call(settings, secrets, 'obterEstado', buildObterEstado(ctx, s.requestId!));
      } catch {
        continue;
      }
      if (r.status !== 200) continue;
      const res = (r.json.statusResult ?? r.json.statusFEResult ?? r.json) as Record<string, any>;
      const code = Number(res.resultCode);
      if (code === FE_RESULT.PREMATURE || code === FE_RESULT.PROCESSING) continue;
      if (code === FE_RESULT.CANCELLED) {
        await this.prisma.$transaction([
          this.prisma.einvoiceSubmission.update({ where: { id: s.id }, data: { status: 'CANCELLED', resultCode: code, response: res as object } }),
          this.prisma.einvoiceDocument.updateMany({ where: { companyId, requestId: s.requestId, status: 'SENT' }, data: { status: 'QUEUED', requestId: null } }),
        ]);
        continue;
      }
      const list = (res.documentStatusList as Array<{ documentNo?: string; documentStatus?: string; errorList?: unknown[] }> | undefined) ?? [];
      const seen = new Set<string>();
      for (const d of list) {
        if (!d.documentNo) continue;
        seen.add(d.documentNo);
        const ok = d.documentStatus === 'V' || d.documentStatus === 'P';
        await this.prisma.einvoiceDocument.updateMany({
          where: { companyId, documentNo: d.documentNo },
          data: { status: ok ? 'VALID' : 'INVALID', errors: ok ? Prisma.DbNull : ((d.errorList ?? []) as object) },
        });
        if (ok) valid += 1;
        else invalid += 1;
      }
      // resultCode 0 sem lista detalhada: todos válidos.
      if (code === FE_RESULT.ALL_VALID && !list.length) {
        const n = await this.prisma.einvoiceDocument.updateMany({ where: { companyId, requestId: s.requestId, status: 'SENT' }, data: { status: 'VALID' } });
        valid += n.count;
      }
      await this.prisma.einvoiceSubmission.update({ where: { id: s.id }, data: { status: 'DONE', resultCode: code, response: res as object } });
    }
    return { checked: subs.length, valid, invalid };
  }

  /** Recolhe + envia + consulta agora (acção manual). */
  async syncNow(companyId: string) {
    const collected = await this.collect(companyId);
    const submitted = await this.submit(companyId);
    const polled = await this.poll(companyId);
    return { collected, submitted, polled };
  }

  async listDocuments(companyId: string, status?: string) {
    return this.prisma.einvoiceDocument.findMany({
      where: { companyId, ...(status ? { status } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Repõe na fila os documentos inválidos/erro (após corrigir a causa). */
  async requeue(companyId: string, documentNo: string) {
    const r = await this.prisma.einvoiceDocument.updateMany({
      where: { companyId, documentNo, status: { in: ['INVALID', 'ERROR'] } },
      data: { status: 'QUEUED', attempts: 0, errors: Prisma.DbNull },
    });
    return { requeued: r.count };
  }
}
