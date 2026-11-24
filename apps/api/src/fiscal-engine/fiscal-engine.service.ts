import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type FiscalEngineCompany, type FiscalEngineSettings } from '@prisma/client';
import { validateSaftXsd } from '@nexus/agt-xml';
import { createHash, randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { decryptSecret, encryptSecret, maskSecret } from '../common/crypto/secret-box';
import type { Env } from '../config/env.validation';
import { PrismaService } from '../prisma/prisma.service';
import {
  agtStateFromDetails,
  companyReadiness,
  dueAlerts,
  effectiveEngine,
  isYes,
  lpsValidationComplete,
  nextAttemptDelayMs,
  normNif,
  providerValidity,
  readVendusAccount,
  registerSubscriptionActive,
  sameNif,
  isAngola,
  type DocState,
  type EngineCode,
  readVendusPlan,
  vendusSubscriptionPeriod,
  agtDocumentNumber,
} from './fiscal-engine.policy';
import { buildCreditNote, buildSaleDocument, totalsDivergence, type CompanyMaps, type CreditNoteSnapshot, type SaleSnapshot } from './vendus-payload';
import { VENDUS_VERSIONS, VendusClient, type VendusResult } from './vendus.client';

export interface Actor {
  id?: string | null;
  name?: string | null;
}

interface CompanyRef {
  id: string;
  name: string;
  nif: string;
  schemaName: string | null;
}

interface DocRow {
  id: string;
  invoice_id: string | null;
  source_doc_id: string | null;
  kind: string;
  tx_id: string;
  external_reference: string;
  mode: string;
  state: DocState;
  attempts: number;
  request: any;
  vendus_id: string | null;
  number: string | null;
  details: any;
  pdf_sha256: string | null;
  last_error: string | null;
}

const TICK_MS = 60_000;
const HEALTH_EVERY_MS = 30 * 60_000;
const EVIDENCE_TYPES = ['application/pdf', 'image/png', 'image/jpeg'];
const EVIDENCE_MAX = 5 * 1024 * 1024;
/** Estados em que o documento ainda pode (e deve) ser processado pela fila. */
const RETRYABLE: DocState[] = ['A_PREPARAR', 'ERRO_DE_COMUNICACAO', 'ESTADO_DESCONHECIDO'];

/**
 * MOTOR FISCAL — selecção do motor por empresa e integração com o Cegid Vendus
 * (motor fiscal externo). Ver docs/fiscal-engine/ para o enquadramento legal
 * (DP 71/25, art. 22.º: terceiros podem assegurar a facturação em nome e por conta
 * do contribuinte, que continua responsável).
 *
 * Garantias:
 *   • a API KEY é cifrada (AES-256-GCM) e nunca sai do servidor;
 *   • uma venda → um tx_id persistente; depois de timeout NUNCA se repete o POST sem
 *     antes procurar o documento por external_reference (reconciliação);
 *   • estado AGT_ACEITE nunca é deduzido de HTTP 200/201, PDF, hash ou QR Code;
 *   • sem motor autorizado a emissão é recusada — sem passagem automática para o LPS.
 */
@Injectable()
export class FiscalEngineService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger(FiscalEngineService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastHealth = 0;
  private readonly inFlight = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Env, true>,
    private readonly audit: AuditService,
  ) {}

  private get encKey(): string {
    return this.config.get('CONFIG_ENCRYPTION_KEY', { infer: true });
  }

  // ── Agendador ────────────────────────────────────────────────────────────
  onModuleInit(): void {
    if (process.env.FISCAL_ENGINE_SCHEDULER === 'off') return;
    const loop = () => {
      this.timer = setTimeout(async () => {
        await this.tick().catch((e) => this.log.warn(`tick: ${msg(e)}`));
        loop();
      }, TICK_MS);
      this.timer.unref?.();
    };
    loop();
  }

  onModuleDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const s = await this.settings();
      await this.checkValidityAlerts(s);
      const links = await this.prisma.fiscalEngineCompany.findMany({ where: { apiKeyEnc: { not: null } } });
      const health = Date.now() - this.lastHealth > HEALTH_EVERY_MS;
      if (health) this.lastHealth = Date.now();
      for (const l of links) {
        const co = await this.companyById(l.companyId).catch(() => null);
        if (!co?.schemaName) continue;
        try {
          if (health && l.engine === 'VENDUS') await this.monitor(l, co);
          await this.processQueue(co.schemaName, co, 20);
          if (l.engine === 'VENDUS') await this.refreshAgtNumbers(co.schemaName, co, 10);
        } catch (e) {
          this.log.warn(`motor fiscal ${co.name}: ${msg(e)}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  // ── Configuração global ──────────────────────────────────────────────────
  async settings(): Promise<FiscalEngineSettings> {
    return this.prisma.fiscalEngineSettings.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default' } });
  }

  /** URL base efectivo: VENDUS_BASE_URL só fora de produção (simulador local nos testes). */
  private baseUrl(s: FiscalEngineSettings): string {
    const override = process.env.VENDUS_BASE_URL;
    if (override && process.env.NODE_ENV !== 'production') return override;
    return s.vendusBaseUrl;
  }

  async overview() {
    const s = await this.settings();
    const validity = providerValidity(s);
    const lps = lpsValidationComplete(s);
    const links = await this.prisma.fiscalEngineCompany.findMany();
    const byCompany = new Map(links.map((l) => [l.companyId, l]));
    const companies = await this.prisma.company.findMany({ select: { id: true, name: true, nif: true, schemaName: true }, orderBy: { name: 'asc' } });
    return {
      settings: this.safeSettings(s),
      validity,
      lpsValidation: lps,
      alerts: this.activeAlerts(s),
      companies: companies.map((c) => {
        const l = byCompany.get(c.id) ?? null;
        const nif = nifFor(l, c.nif);
        const r = companyReadiness(l, s, nif);
        const eff = effectiveEngine(l, s, nif);
        return { id: c.id, name: c.name, nif, engine: l?.engine ?? 'LPS', effective: eff, indicator: r.indicator, canActivate: r.canActivate };
      }),
    };
  }

  private safeSettings(s: FiscalEngineSettings) {
    return {
      vendusEnabled: s.vendusEnabled,
      vendusBaseUrl: s.vendusBaseUrl,
      vendusApiVersion: s.vendusApiVersion,
      providerProducer: s.providerProducer,
      providerSoftware: s.providerSoftware,
      providerValidationNo: s.providerValidationNo,
      providerFeCertNo: s.providerFeCertNo,
      providerVersion: s.providerVersion,
      providerValidFrom: ymd(s.providerValidFrom),
      providerValidUntil: ymd(s.providerValidUntil),
      providerEvidenceUrl: s.providerEvidenceUrl,
      providerEvidenceId: s.providerEvidenceId,
      providerVerifiedAt: s.providerVerifiedAt?.toISOString() ?? null,
      providerVerifiedBy: s.providerVerifiedBy,
      alertDays: s.alertDays,
      lpsValidationNo: s.lpsValidationNo,
      lpsValidationVersion: s.lpsValidationVersion,
      lpsEvidenceId: s.lpsEvidenceId,
      lpsTestsApprovedAt: s.lpsTestsApprovedAt?.toISOString() ?? null,
      lpsConfirmedAt: s.lpsConfirmedAt?.toISOString() ?? null,
      lpsConfirmedBy: s.lpsConfirmedBy,
    };
  }

  private activeAlerts(s: FiscalEngineSettings): { level: 'info' | 'warn' | 'bad'; text: string }[] {
    const v = providerValidity(s);
    const out: { level: 'info' | 'warn' | 'bad'; text: string }[] = [];
    if (v.status === 'EXPIRADO') out.push({ level: 'bad', text: `Validação AGT do fornecedor expirada há ${-(v.daysLeft ?? 0)} dia(s) — emissões pelo Vendus bloqueadas` });
    else if (v.daysLeft !== null) {
      const t = [...s.alertDays].sort((a, b) => a - b).find((d) => v.daysLeft! <= d);
      if (t !== undefined) out.push({ level: v.daysLeft <= 7 ? 'bad' : 'warn', text: v.daysLeft === 0 ? 'A validação AGT do fornecedor vence hoje' : `A validação AGT do fornecedor vence dentro de ${v.daysLeft} dia(s)` });
    }
    return out;
  }

  async updateSettings(dto: Record<string, any>, actor: Actor) {
    const s = await this.settings();
    const data: Prisma.FiscalEngineSettingsUpdateInput = {};
    if (dto.vendusApiVersion !== undefined) {
      if (!(VENDUS_VERSIONS as readonly string[]).includes(dto.vendusApiVersion)) throw new BadRequestException('Versão da API Vendus não publicada');
      data.vendusApiVersion = dto.vendusApiVersion;
    }
    if (dto.vendusBaseUrl !== undefined) {
      const u = String(dto.vendusBaseUrl).trim().replace(/\/+$/, '');
      if (!/^https:\/\/([a-z0-9-]+\.)*vendus\.co\.ao\/ws$/i.test(u)) throw new BadRequestException('URL da API: https://www.vendus.co.ao/ws');
      data.vendusBaseUrl = u;
    }
    for (const k of ['providerProducer', 'providerSoftware', 'providerValidationNo', 'providerFeCertNo', 'providerVersion', 'providerVerifiedBy'] as const) {
      if (dto[k] !== undefined) (data as any)[k] = String(dto[k]).trim().slice(0, 200);
    }
    if (dto.providerEvidenceUrl !== undefined) {
      const u = String(dto.providerEvidenceUrl).trim();
      if (u && !/^https:\/\/[^\s]+$/.test(u)) throw new BadRequestException('Evidência: endereço https');
      data.providerEvidenceUrl = u;
    }
    if (dto.providerEvidenceId !== undefined) data.providerEvidenceId = await this.evidenceRef(dto.providerEvidenceId, 'PROVIDER_VALIDITY');
    if (dto.providerValidFrom !== undefined) data.providerValidFrom = parseDate(dto.providerValidFrom);
    if (dto.providerValidUntil !== undefined) data.providerValidUntil = parseDate(dto.providerValidUntil);
    if (dto.alertDays !== undefined) {
      const arr = (Array.isArray(dto.alertDays) ? dto.alertDays : []).map(Number);
      if (!arr.length || arr.some((d: number) => !Number.isInteger(d) || d < 0 || d > 365)) throw new BadRequestException('Alertas: dias inteiros entre 0 e 365');
      data.alertDays = [...new Set<number>(arr)].sort((a, b) => b - a);
    }
    // RENOVAÇÃO / ALTERAÇÃO da validação: a nova data ou o novo número só contam com
    // nova evidência (documento carregado ou URL diferente) e nova verificação.
    const untilChanged = data.providerValidUntil !== undefined && ymd(data.providerValidUntil as Date | null) !== ymd(s.providerValidUntil);
    const noChanged = data.providerValidationNo !== undefined && data.providerValidationNo !== s.providerValidationNo;
    if (untilChanged || noChanged) {
      const newEvidence = (data.providerEvidenceId !== undefined && data.providerEvidenceId !== s.providerEvidenceId)
        || (data.providerEvidenceUrl !== undefined && data.providerEvidenceUrl !== s.providerEvidenceUrl);
      if (!newEvidence) throw new BadRequestException('Nova validade ou novo número exigem nova evidência documental');
      if (!String(dto.providerVerifiedBy ?? '').trim()) throw new BadRequestException('Indique o responsável pela verificação');
      data.providerVerifiedAt = new Date();
    } else if (dto.verifyNow === true) {
      if (!String(dto.providerVerifiedBy ?? s.providerVerifiedBy).trim()) throw new BadRequestException('Indique o responsável pela verificação');
      data.providerVerifiedAt = new Date();
    }
    const next = { ...s, ...(data as any) } as FiscalEngineSettings;
    if (dto.vendusEnabled !== undefined) {
      if (dto.vendusEnabled === true && providerValidity(next).status !== 'CONFIRMADO') {
        throw new ConflictException('O motor externo só liga com a validação AGT do fornecedor confirmada e dentro da validade');
      }
      data.vendusEnabled = dto.vendusEnabled === true;
    }
    const saved = await this.prisma.fiscalEngineSettings.update({ where: { id: 'default' }, data });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_SETTINGS_UPDATED', entity: 'fiscal_engine_settings', entityId: 'default', before: this.safeSettings(s), after: this.safeSettings(saved) });
    return this.overview();
  }

  /** Validação própria do LPS (Modo B). Só número/versão/evidência oficiais; a confirmação é explícita. */
  async updateLpsValidation(dto: Record<string, any>, actor: Actor) {
    const s = await this.settings();
    const data: Prisma.FiscalEngineSettingsUpdateInput = {};
    if (dto.lpsValidationNo !== undefined) data.lpsValidationNo = String(dto.lpsValidationNo).trim().slice(0, 60);
    if (dto.lpsValidationVersion !== undefined) data.lpsValidationVersion = String(dto.lpsValidationVersion).trim().slice(0, 40);
    if (dto.lpsEvidenceId !== undefined) data.lpsEvidenceId = await this.evidenceRef(dto.lpsEvidenceId, 'LPS_VALIDATION');
    if (dto.testsApproved === true) data.lpsTestsApprovedAt = new Date();
    // Anular um registo de testes feito por engano (também apaga a confirmação).
    if (dto.testsApproved === false) data.lpsTestsApprovedAt = null;
    // Qualquer alteração aos dados apaga a confirmação anterior.
    if (data.lpsValidationNo !== undefined || data.lpsValidationVersion !== undefined || data.lpsEvidenceId !== undefined || dto.testsApproved === false) {
      data.lpsConfirmedAt = null;
      data.lpsConfirmedBy = '';
    }
    if (dto.confirm === true) {
      const next = { ...s, ...(data as any), lpsConfirmedAt: new Date(), lpsConfirmedBy: actor.name ?? actor.id ?? 'super-admin' } as FiscalEngineSettings;
      const v = lpsValidationComplete(next);
      if (!v.ok) throw new ConflictException(`Falta: ${v.missing.join(', ')}`);
      data.lpsConfirmedAt = next.lpsConfirmedAt;
      data.lpsConfirmedBy = next.lpsConfirmedBy;
    }
    const saved = await this.prisma.fiscalEngineSettings.update({ where: { id: 'default' }, data });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_LPS_VALIDATION_UPDATED', entity: 'fiscal_engine_settings', entityId: 'default', before: this.safeSettings(s), after: this.safeSettings(saved) });
    return this.overview();
  }

  async uploadEvidence(kind: string, file: { filename: string; contentType: string; base64: string }, actor: Actor) {
    if (!['PROVIDER_VALIDITY', 'LPS_VALIDATION'].includes(kind)) throw new BadRequestException('Tipo de evidência inválido');
    if (!EVIDENCE_TYPES.includes(file.contentType)) throw new BadRequestException('Evidência: PDF, PNG ou JPEG');
    const data = Buffer.from(file.base64 ?? '', 'base64');
    if (!data.length || data.length > EVIDENCE_MAX) throw new BadRequestException('Evidência: até 5 MB');
    const sig = data.subarray(0, 4).toString('hex');
    const okSig = (file.contentType === 'application/pdf' && data.subarray(0, 5).toString('latin1') === '%PDF-')
      || (file.contentType === 'image/png' && sig === '89504e47') || (file.contentType === 'image/jpeg' && sig.startsWith('ffd8ff'));
    if (!okSig) throw new BadRequestException('O conteúdo não corresponde ao tipo do ficheiro');
    const sha256 = createHash('sha256').update(data).digest('hex');
    const row = await this.prisma.fiscalEngineEvidence.create({
      data: { kind, filename: String(file.filename || 'evidencia').slice(0, 120), contentType: file.contentType, sha256, size: data.length, data, uploadedBy: actor.name ?? actor.id ?? '' },
      select: { id: true, sha256: true, size: true, filename: true, createdAt: true },
    });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_EVIDENCE_UPLOADED', entity: 'fiscal_engine_evidence', entityId: row.id, after: { kind, sha256, size: data.length, filename: row.filename } });
    return row;
  }

  async evidence(id: string) {
    const e = await this.prisma.fiscalEngineEvidence.findUnique({ where: { id } });
    if (!e) throw new NotFoundException('Evidência não encontrada');
    return e;
  }

  private async evidenceRef(id: unknown, kind: string): Promise<string | null> {
    if (id === null || id === '') return null;
    const e = await this.prisma.fiscalEngineEvidence.findUnique({ where: { id: String(id) }, select: { id: true, kind: true } });
    if (!e || e.kind !== kind) throw new BadRequestException('Evidência inexistente');
    return e.id;
  }

  private async checkValidityAlerts(s: FiscalEngineSettings): Promise<void> {
    const due = dueAlerts(s);
    if (!due.length) return;
    const sent = { ...((s.alertsSent as Record<string, string>) ?? {}) };
    for (const a of due) {
      sent[a.key] = new Date().toISOString();
      await this.audit.record({ actorType: 'SYSTEM', action: 'FISCAL_ENGINE_VALIDITY_ALERT', entity: 'fiscal_engine_settings', entityId: 'default', after: { daysLeft: a.days, validUntil: ymd(s.providerValidUntil), validationNo: s.providerValidationNo } });
      this.log.warn(`Validação AGT do fornecedor (${s.providerValidationNo}) vence em ${a.days} dia(s)`);
    }
    await this.prisma.fiscalEngineSettings.update({ where: { id: 'default' }, data: { alertsSent: sent } });
  }

  // ── Empresa: ligação Vendus ──────────────────────────────────────────────
  private async companyById(id: string): Promise<CompanyRef> {
    const c = await this.prisma.company.findUnique({ where: { id }, select: { id: true, name: true, nif: true, schemaName: true } });
    if (!c) throw new NotFoundException('Empresa não encontrada');
    return c;
  }

  /** Selo da barra de topo: só diz que a facturação desta empresa é emitida pelo
   *  Cegid Vendus quando o motor efectivo é mesmo o Vendus (nunca deduzido de
   *  outra coisa). Sem chave nem configuração interna. */
  async badgeForSchema(schema: string): Promise<{ vendus: boolean; provider?: string; software?: string; validationNo?: string; feCertNo?: string; validUntil?: string | null }> {
    const co = await this.companyBySchema(schema);
    const [l, s] = await Promise.all([this.link(co.id), this.settings()]);
    const nif = nifFor(l, co.nif);
    if (effectiveEngine(l, s, nif).engine !== 'VENDUS') return { vendus: false };
    return { vendus: true, provider: 'Cegid Vendus', software: s.providerSoftware || 'Vendus', validationNo: s.providerValidationNo, feCertNo: s.providerFeCertNo, validUntil: ymd(s.providerValidUntil) };
  }

  /** Cache (1 h por empresa) da subscrição lida ao Vendus. */
  private readonly vendusSubCache = new Map<string, { at: number; v: { plan: string; expires: string; subdomain: string } }>();

  /**
   * SUBSCRIÇÃO DO VENDUS (empresas cujo motor efectivo é o Cegid Vendus): a
   * renovação que conta é a do Vendus, por isso a gestão e o caixa mostram o
   * plano, a data de fim e a percentagem do Vendus, e o botão leva à página de
   * renovação do Vendus. Fora do Vendus devolve null (fica a subscrição LPS).
   */
  async vendusSubscription(companyId: string) {
    const [co, l, s] = await Promise.all([this.companyById(companyId), this.link(companyId), this.settings()]);
    if (!l || effectiveEngine(l, s, nifFor(l, co.nif)).engine !== 'VENDUS') return null;
    let info = this.vendusSubCache.get(companyId);
    if (!info || Date.now() - info.at > 3600_000) {
      const v = { plan: '', expires: l.registerExpires || '', subdomain: '' };
      try {
        const api = await this.client(l, 10_000);
        const [acc, reg] = await Promise.all([api.account(), l.registerId ? api.register(l.registerId) : Promise.resolve(null)]);
        const p = acc.ok ? readVendusPlan(acc.data) : null;
        if (p) { v.plan = p.plan; v.subdomain = p.subdomain; }
        const regExp = reg?.ok ? String(((reg.data ?? {}) as Record<string, any>).expires ?? '') : '';
        // Fim da subscrição: o da conta quando o Vendus o devolve; senão o da caixa API.
        v.expires = p?.expires || regExp || v.expires;
        if (regExp && regExp !== l.registerExpires) {
          await this.prisma.fiscalEngineCompany.update({ where: { id: l.id }, data: { registerExpires: regExp } }).catch(() => undefined);
        }
      } catch { /* sem ligação ao Vendus: usa a última data guardada */ }
      info = { at: Date.now(), v };
      this.vendusSubCache.set(companyId, info);
    }
    const period = vendusSubscriptionPeriod(info.v.expires);
    const renewUrl = info.v.subdomain ? `https://${info.v.subdomain}.vendus.co.ao/app/subscription/plan/` : 'https://www.vendus.co.ao/login/';
    return {
      provider: 'VENDUS' as const, plan: info.v.plan || null, renewUrl, known: !!period,
      ...(period ?? { active: false, pct: 0, leftPct: 100, totalDays: 0, usedDays: 0, daysLeft: 0, expiresAt: null }),
    };
  }

  async companyBySchema(schema: string): Promise<CompanyRef> {
    const c = await this.prisma.company.findUnique({ where: { schemaName: schema }, select: { id: true, name: true, nif: true, schemaName: true } });
    if (!c) throw new NotFoundException('Empresa não encontrada');
    return c;
  }

  private link(companyId: string) {
    return this.prisma.fiscalEngineCompany.findUnique({ where: { companyId } });
  }

  private async ensureLink(companyId: string): Promise<FiscalEngineCompany> {
    return this.prisma.fiscalEngineCompany.upsert({ where: { companyId }, update: {}, create: { companyId } });
  }

  async companyDetail(companyId: string) {
    const [co, l, s] = await Promise.all([this.companyById(companyId), this.link(companyId), this.settings()]);
    const nif = nifFor(l, co.nif);
    const r = companyReadiness(l, s, nif);
    return {
      company: { id: co.id, name: co.name, nif, companyNif: co.nif },
      engine: l?.engine ?? 'LPS',
      effective: effectiveEngine(l, s, nif),
      indicator: r.indicator,
      checks: r.checks,
      canActivate: r.canActivate,
      validity: providerValidity(s),
      link: l ? this.safeLink(l) : null,
    };
  }

  private safeLink(l: FiscalEngineCompany) {
    return {
      engine: l.engine,
      taxpayerNif: l.taxpayerNif,
      suspendedReason: l.suspendedReason,
      apiKeyMask: l.apiKeyMask,
      apiKeySetAt: l.apiKeySetAt?.toISOString() ?? null,
      accountId: l.accountId,
      accountCompany: l.accountCompany,
      accountFiscalId: l.accountFiscalId,
      accountCountry: l.accountCountry,
      accountAddress: l.accountAddress,
      storeId: l.storeId,
      registerId: l.registerId,
      registerTitle: l.registerTitle,
      registerType: l.registerType,
      registerSubscription: l.registerSubscription,
      registerExpires: l.registerExpires,
      paymentMap: l.paymentMap,
      taxMap: l.taxMap,
      feConfirmedAt: l.feConfirmedAt?.toISOString() ?? null,
      feConfirmedBy: l.feConfirmedBy,
      lastTestAt: l.lastTestAt?.toISOString() ?? null,
      lastTestOk: l.lastTestOk,
      lastTestCode: l.lastTestCode,
      lastTestMessage: l.lastTestMessage,
      testsPassedAt: l.testsPassedAt?.toISOString() ?? null,
      activatedAt: l.activatedAt?.toISOString() ?? null,
      activatedBy: l.activatedBy,
      health: l.health,
    };
  }

  /** Guarda a API KEY (cifrada). Mudar de chave obriga a novo teste e novos testes de emissão. */
  async saveApiKey(companyId: string, apiKey: string, actor: Actor) {
    await this.companyById(companyId);
    const key = String(apiKey ?? '').trim();
    if (key.length < 16 || key.length > 200 || /\s/.test(key)) throw new BadRequestException('API KEY inválida');
    const before = await this.link(companyId);
    if (before?.engine === 'VENDUS' && before.activatedAt) throw new ConflictException('Suspenda o motor antes de trocar a API KEY');
    await this.prisma.fiscalEngineCompany.upsert({
      where: { companyId },
      update: { apiKeyEnc: encryptSecret(key, this.encKey), apiKeyMask: maskSecret(key), apiKeySetAt: new Date(), lastTestOk: false, lastTestCode: '', lastTestMessage: '', testsPassedAt: null, accountId: '', accountFiscalId: '', accountCompany: '', accountCountry: '' },
      create: { companyId, apiKeyEnc: encryptSecret(key, this.encKey), apiKeyMask: maskSecret(key), apiKeySetAt: new Date() },
    });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_API_KEY_SET', entity: 'fiscal_engine_company', entityId: companyId, after: { apiKeyMask: maskSecret(key), replaced: !!before?.apiKeyEnc } });
    return this.companyDetail(companyId);
  }

  /**
   * Reutiliza a ligação Vendus de outra empresa do MESMO contribuinte (mesmo NIF): copia a
   * chave cifrada no servidor (ninguém a volta a escrever), a caixa e os mapas. Recusado se
   * o NIF do contribuinte da empresa destino não for o NIF da conta Vendus de origem.
   */
  async copyLinkFrom(companyId: string, sourceCompanyId: string, actor: Actor) {
    if (companyId === sourceCompanyId) throw new BadRequestException('Escolha outra empresa');
    const [co, src] = await Promise.all([this.companyById(companyId), this.link(sourceCompanyId)]);
    if (!src?.apiKeyEnc || !src.lastTestOk || !src.accountFiscalId) throw new ConflictException('A empresa de origem não tem uma ligação Vendus testada');
    const target = await this.ensureLink(companyId);
    if (target.engine === 'VENDUS' && target.activatedAt) throw new ConflictException('Suspenda o motor antes de trocar a ligação');
    const nif = nifFor(target, co.nif);
    if (!sameNif(src.accountFiscalId, nif)) {
      throw new ConflictException(`A conta Vendus de origem é do NIF ${src.accountFiscalId}; o NIF do contribuinte desta empresa é ${nif}. Só empresas do mesmo contribuinte partilham a ligação`);
    }
    await this.prisma.fiscalEngineCompany.update({
      where: { companyId },
      data: {
        apiKeyEnc: src.apiKeyEnc, apiKeyMask: src.apiKeyMask, apiKeySetAt: new Date(),
        accountId: src.accountId, accountCompany: src.accountCompany, accountFiscalId: src.accountFiscalId, accountCountry: src.accountCountry, accountAddress: src.accountAddress,
        storeId: src.storeId, registerId: src.registerId, registerTitle: src.registerTitle, registerType: src.registerType, registerSubscription: src.registerSubscription, registerExpires: src.registerExpires,
        paymentMap: src.paymentMap as Prisma.InputJsonValue, taxMap: src.taxMap as Prisma.InputJsonValue,
        lastTestOk: false, lastTestCode: '', lastTestMessage: '', testsPassedAt: null,
      },
    });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_LINK_COPIED', entity: 'fiscal_engine_company', entityId: companyId, after: { from: sourceCompanyId, accountFiscalId: src.accountFiscalId, apiKeyMask: src.apiKeyMask } });
    return this.companyDetail(companyId);
  }

  async removeApiKey(companyId: string, actor: Actor) {
    const l = await this.link(companyId);
    if (!l) return this.companyDetail(companyId);
    if (l.engine === 'VENDUS' && l.activatedAt) throw new ConflictException('Suspenda o motor antes de remover a API KEY');
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data: { apiKeyEnc: null, apiKeyMask: '', apiKeySetAt: new Date(), lastTestOk: false, lastTestCode: '', testsPassedAt: null } });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_API_KEY_REMOVED', entity: 'fiscal_engine_company', entityId: companyId });
    return this.companyDetail(companyId);
  }

  private async client(l: FiscalEngineCompany, timeoutMs?: number): Promise<VendusClient> {
    if (!l.apiKeyEnc) throw new ConflictException('API KEY por inserir');
    const s = await this.settings();
    let key: string;
    try {
      key = decryptSecret(l.apiKeyEnc, this.encKey);
    } catch {
      this.log.error('API KEY Vendus ilegível (chave de cifra mudou?)');
      throw new ServiceUnavailableException('API KEY Vendus ilegível: volte a inseri-la');
    }
    // VENDUS_TIMEOUT_MS só fora de produção (testes de timeout com o simulador).
    const testTimeout = process.env.NODE_ENV !== 'production' ? Number(process.env.VENDUS_TIMEOUT_MS) || undefined : undefined;
    return new VendusClient({ baseUrl: this.baseUrl(s), version: s.vendusApiVersion, apiKey: key, timeoutMs: testTimeout ?? timeoutMs });
  }

  /**
   * Teste de ligação: GET /account/ (empresa, NIF, país), GET /registers/ e a caixa
   * escolhida (subscrição), impostos e isenções da conta, formas de pagamento.
   * A conta tem de ser do MESMO NIF que a empresa no LPS e de Angola (AO).
   */
  async testConnection(companyId: string, actor: Actor) {
    const co = await this.companyById(companyId);
    const l = await this.ensureLink(companyId);
    const api = await this.client(l);
    const acc = await api.account();
    const data: Prisma.FiscalEngineCompanyUpdateInput = { lastTestAt: new Date() };
    let code = 'OK';
    let message = '';
    let catalog: Record<string, unknown> = {};
    if (!acc.ok) {
      code = acc.error!.code;
      message = acc.error!.message;
    } else {
      const a = readVendusAccount(acc.data);
      data.accountId = a.id;
      data.accountCompany = a.company;
      data.accountFiscalId = a.fiscalId;
      data.accountCountry = a.country;
      data.accountAddress = a.address;
      if (!a.fiscalId) {
        code = 'CONTA_SEM_NIF';
        message = `O Vendus não devolveu o NIF da conta (campos recebidos: ${a.keys.join(', ') || 'nenhum'})`;
      } else if (!sameNif(a.fiscalId, nifFor(l, co.nif))) {
        code = 'NIF_DIFERENTE';
        message = `A conta Vendus é do NIF ${a.fiscalId}; o NIF do contribuinte configurado é ${nifFor(l, co.nif)}`;
      } else if (!isAngola(a.country)) {
        code = 'PAIS_DIFERENTE';
        message = `A conta Vendus é do país ${a.country || '—'}, não de Angola (AO)`;
      }
      const [regs, taxes, exemptions, pays, stores] = await Promise.all([api.registers(), api.taxes(), api.exemptions(), api.paymentMethods(), api.stores()]);
      const taxList = Array.isArray(taxes.data) ? taxes.data : [];
      // Correspondência de impostos: só quando o imposto da conta é de ANGOLA e tem a
      // MESMA taxa que o código do LPS (um "NOR" português a 23% nunca serve).
      const lpsRates: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, OUT: 0 };
      const taxMap: Record<string, string> = {};
      // Taxa 0% (ISE isento e OUT não sujeito): no Vendus/AGT ambos usam o imposto de 0%
      // da conta (ISE) com o motivo de isenção da linha (M02, M10…).
      const ao = taxList.filter((t: any) => String(t.country ?? '').toUpperCase() === 'AO');
      for (const [code0, rate] of Object.entries(lpsRates)) {
        const same = ao.filter((t: any) => Number(t.rate) === rate);
        const hit = rate > 0 ? same[0] : (same.find((t: any) => String(t.id) === code0) ?? same.find((t: any) => String(t.id) === 'ISE') ?? (same.length === 1 ? same[0] : undefined));
        if (hit) taxMap[code0] = String(hit.id);
      }
      data.taxMap = taxMap;
      catalog = {
        registers: (Array.isArray(regs.data) ? regs.data : []).map((r: any) => ({ id: String(r.id), title: r.title, store_id: r.store_id, type: r.type, status: r.status, mode: r.mode, subscription_active: r.subscription_active })),
        stores: (Array.isArray(stores.data) ? stores.data : []).map((x: any) => ({ id: String(x.id), title: x.title, status: x.status })),
        taxes: taxList.map((t: any) => ({ id: t.id, rate: t.rate, country: t.country, title: t.title })),
        exemptions: (Array.isArray(exemptions.data) ? exemptions.data : []).map((e: any) => ({ id: e.id, text: e.text })),
        paymentMethods: (Array.isArray(pays.data) ? pays.data : []).map((p: any) => ({ id: String(p.id), title: p.title, type: p.type })),
      };
      // CAIXA UNIFICADA: a API do Vendus só emite numa caixa do tipo API ("Register's type
      // must be [API]", confirmado na conta real). Todas as caixas do LPS emitem por essa
      // única caixa API da conta. Se a escolhida não for API, usa-se a caixa API da conta.
      const regList: any[] = Array.isArray(regs.data) ? regs.data : [];
      const isApi = (r: any) => String(r?.type ?? '').toLowerCase() === 'api';
      let registerId = l.registerId;
      const chosen = regList.find((r) => String(r.id) === registerId);
      if (!registerId || (chosen && !isApi(chosen))) {
        const apiReg = regList.find((r) => isApi(r) && String(r.status ?? 'on').toLowerCase() !== 'off');
        if (apiReg) {
          registerId = String(apiReg.id);
          data.registerId = registerId;
          data.testsPassedAt = null;
        } else if (code === 'OK') {
          code = 'CAIXA_NAO_API';
          message = 'A conta Vendus não tem nenhuma caixa do tipo API. No Backoffice Vendus crie uma caixa do tipo API: o LPS emite por ela em todas as suas caixas';
        }
      }
      if (code === 'OK' && registerId) {
        const reg = await api.register(registerId);
        if (!reg.ok) {
          code = reg.error!.code === 'NAO_ENCONTRADO' ? 'CAIXA_INEXISTENTE' : reg.error!.code;
          message = reg.error!.message;
        } else {
          const r = reg.data as Record<string, any>;
          data.registerTitle = String(r.title ?? '');
          data.registerType = String(r.type ?? '');
          const sub = registerSubscriptionActive(r);
          data.registerSubscription = sub.active ? 'yes' : sub.raw || 'no';
          data.registerExpires = String(r.expires ?? '');
          data.storeId = String(r.store_id ?? l.storeId);
          if (!sub.active) {
            code = 'SUBSCRICAO_INACTIVA';
            message = `A caixa ${r.title ?? registerId} não tem subscrição activa`;
          } else if (String(r.type ?? '').toLowerCase() !== 'api') {
            // Confirmado na conta real: POST /documents/ responde "Register's type must be [API]".
            code = 'CAIXA_NAO_API';
            message = `A caixa ${r.title ?? registerId} é do tipo ${r.type || '—'}; a API do Vendus só emite numa caixa do tipo API (criar no Backoffice Vendus)`;
          }
        }
      }
    }
    data.lastTestOk = code === 'OK';
    data.lastTestCode = code;
    data.lastTestMessage = message;
    data.health = { code, at: new Date().toISOString(), message };
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_CONNECTION_TESTED', entity: 'fiscal_engine_company', entityId: companyId, after: { code, message, accountId: data.accountId ?? null } });
    return { ...(await this.companyDetail(companyId)), test: { ok: code === 'OK', code, message }, catalog };
  }

  async configureCompany(companyId: string, dto: Record<string, any>, actor: Actor) {
    const l = await this.ensureLink(companyId);
    const data: Prisma.FiscalEngineCompanyUpdateInput = {};
    if (dto.registerId !== undefined && String(dto.registerId).trim() !== l.registerId) {
      if (l.engine === 'VENDUS' && l.activatedAt) throw new ConflictException('Suspenda o motor antes de mudar de caixa');
      data.registerId = String(dto.registerId).trim().slice(0, 40);
      data.registerSubscription = '';
      data.registerTitle = '';
      data.testsPassedAt = null;
      data.lastTestOk = false;
    }
    if (dto.storeId !== undefined) data.storeId = String(dto.storeId).trim().slice(0, 40);
    if (dto.taxpayerNif !== undefined) {
      const nif = String(dto.taxpayerNif ?? '').toUpperCase().replace(/\s+/g, '');
      if (nif && !/^(\d{9,10}|\d{9}[A-Z]{2}\d{3})$/.test(nif)) throw new BadRequestException('NIF do contribuinte: 9 ou 10 dígitos (ou 14 do BI)');
      if (nif !== l.taxpayerNif) {
        if (l.engine === 'VENDUS' && l.activatedAt) throw new ConflictException('Suspenda o motor antes de mudar o NIF do contribuinte');
        data.taxpayerNif = nif;
        // Outro NIF: o teste de ligação e os testes de emissão deixam de valer.
        data.lastTestOk = false;
        data.testsPassedAt = null;
      }
    }
    if (dto.paymentMap !== undefined) {
      const pm: Record<string, string> = {};
      for (const [k, v] of Object.entries(dto.paymentMap ?? {})) if (/^[A-Z_]{2,20}$/.test(k) && String(v).trim()) pm[k] = String(v).trim().slice(0, 40);
      data.paymentMap = pm;
    }
    if (dto.feConfirmed === true) {
      data.feConfirmedAt = new Date();
      data.feConfirmedBy = actor.name ?? actor.id ?? '';
    } else if (dto.feConfirmed === false) {
      data.feConfirmedAt = null;
      data.feConfirmedBy = '';
    }
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_COMPANY_CONFIGURED', entity: 'fiscal_engine_company', entityId: companyId, after: { registerId: data.registerId, storeId: data.storeId, paymentMap: data.paymentMap, feConfirmed: dto.feConfirmed, taxpayerNif: data.taxpayerNif } });
    return this.companyDetail(companyId);
  }

  /**
   * Testes de integração em modo "tests" (Formação/Testes do Vendus: SEM validade
   * fiscal e NÃO comunicado à AGT): cria um documento, lê-o e obtém o PDF.
   */
  async runTests(companyId: string, actor: Actor) {
    const co = await this.companyById(companyId);
    if (!co.schemaName) throw new ConflictException('Empresa sem base de dados');
    const l = await this.ensureLink(companyId);
    if (!l.lastTestOk) throw new ConflictException('Teste a ligação primeiro');
    if (!l.registerId) throw new ConflictException('Escolha a caixa Vendus');
    const tax = (l.taxMap as Record<string, string>).NOR;
    if (!tax) throw new ConflictException('A conta Vendus não tem a taxa normal de Angola (14%)');
    const cash = (l.paymentMap as Record<string, string>)?.CASH;
    if (!cash) throw new ConflictException('Escolha a forma de pagamento Vendus para Numerário (a Factura-Recibo exige o pagamento)');
    const id = randomUUID();
    const body = { register_id: Number(l.registerId) || l.registerId, type: 'FR', mode: 'tests', payments: [{ id: Number(cash) || cash, amount: '114.00' }], external_reference: `LPS-TESTE-${id}`, tx_id: `lps-teste-${id}`, errors_full: 'yes', items: [{ reference: 'LPS-TESTE', title: 'Teste de integração LPS', qty: 1, gross_price: '114.00', tax_id: tax }] };
    await this.prisma.runInTenant(co.schemaName, (tx) => tx.$executeRaw`
      INSERT INTO fiscal_engine_documents (id, kind, tx_id, external_reference, mode, state, request)
      VALUES (${id}::uuid, 'TEST', ${body.tx_id}, ${body.external_reference}, 'tests', 'A_PREPARAR', ${JSON.stringify(body)}::jsonb)`);
    const res = await this.dispatch(co.schemaName, id, co);
    const ok = res.state === 'CRIADO_NO_VENDUS' && !!res.pdf;
    await this.prisma.fiscalEngineCompany.update({
      where: { companyId },
      data: ok ? { testsPassedAt: new Date(), lastTestMessage: '' } : { lastTestMessage: `Teste de emissão (modo Formação): ${res.error ?? res.state}`.slice(0, 500) },
    });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_TESTS_RUN', entity: 'fiscal_engine_company', entityId: companyId, after: { ok, state: res.state, number: res.number, error: res.error } });
    return { ok, document: res, detail: await this.companyDetail(companyId) };
  }

  /** Activa o Modo A (Vendus) — só com todas as verificações. */
  async activate(companyId: string, actor: Actor) {
    const co = await this.companyById(companyId);
    const [l, s] = await Promise.all([this.ensureLink(companyId), this.settings()]);
    const r = companyReadiness(l, s, nifFor(l, co.nif));
    if (!r.canActivate) throw new ConflictException(`Falta: ${r.checks.filter((c) => !c.ok).map((c) => c.key).join(', ')}`);
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data: { engine: 'VENDUS', activatedAt: new Date(), activatedBy: actor.name ?? actor.id ?? '', suspendedReason: '' } });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_ACTIVATED', entity: 'fiscal_engine_company', entityId: companyId, before: { engine: l.engine }, after: { engine: 'VENDUS' } });
    return this.companyDetail(companyId);
  }

  /** Modo C: suspende a emissão fiscal da empresa (com motivo). */
  async suspend(companyId: string, reason: string, actor: Actor) {
    const why = String(reason ?? '').trim();
    if (why.length < 5) throw new BadRequestException('Indique o motivo da suspensão');
    const l = await this.ensureLink(companyId);
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data: { engine: 'SUSPENSO', suspendedReason: why.slice(0, 300), activatedAt: null } });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_SUSPENDED', entity: 'fiscal_engine_company', entityId: companyId, before: { engine: l.engine }, after: { engine: 'SUSPENSO', reason: why } });
    return this.companyDetail(companyId);
  }

  /** Modo B: motor próprio — só com a validação própria do LPS completa e confirmada. */
  async useLpsEngine(companyId: string, confirmation: string, actor: Actor) {
    const s = await this.settings();
    const v = lpsValidationComplete(s);
    if (!v.ok) throw new ConflictException(`O motor próprio exige validação AGT do LPS. Falta: ${v.missing.join(', ')}`);
    if (confirmation !== 'MUDAR PARA MOTOR PRÓPRIO') throw new BadRequestException('Confirmação em falta');
    const l = await this.ensureLink(companyId);
    await this.prisma.fiscalEngineCompany.update({ where: { companyId }, data: { engine: 'LPS', activatedAt: null, suspendedReason: '' } });
    await this.audit.record({ actorType: 'PLATFORM', actorId: actor.id ?? null, action: 'FISCAL_ENGINE_SWITCHED_TO_LPS', entity: 'fiscal_engine_company', entityId: companyId, before: { engine: l.engine }, after: { engine: 'LPS', lpsValidationNo: s.lpsValidationNo } });
    return this.companyDetail(companyId);
  }

  /** Monitorização periódica (conta, caixa) — distingue A–F e regista em `health`. */
  private async monitor(l: FiscalEngineCompany, co: CompanyRef): Promise<void> {
    const api = await this.client(l, 15_000).catch(() => null);
    if (!api) return;
    const acc = await api.account();
    let code = 'OK';
    let message = '';
    let regExpires = '';
    if (!acc.ok) { code = acc.error!.code; message = acc.error!.message; }
    else if (!sameNif(readVendusAccount(acc.data).fiscalId, nifFor(l, co.nif))) { code = 'NIF_DIFERENTE'; message = `A conta da API KEY (NIF ${readVendusAccount(acc.data).fiscalId || '—'}) não corresponde ao NIF do contribuinte (${nifFor(l, co.nif)})`; }
    else if (l.registerId) {
      const reg = await api.register(l.registerId);
      if (!reg.ok) { code = reg.error!.code; message = reg.error!.message; }
      else if (!registerSubscriptionActive((reg.data ?? {}) as Record<string, any>).active) { code = 'SUBSCRICAO_INACTIVA'; message = 'Caixa Vendus sem subscrição activa'; }
      if (reg.ok && (reg.data as Record<string, any>)?.expires) regExpires = String((reg.data as Record<string, any>).expires);
    }
    const data: Prisma.FiscalEngineCompanyUpdateInput = { health: { code, at: new Date().toISOString(), message } };
    if (regExpires) data.registerExpires = regExpires;
    this.vendusSubCache.delete(l.companyId);
    if (acc.ok) {
      const a = readVendusAccount(acc.data);
      Object.assign(data, { accountId: a.id, accountCompany: a.company, accountFiscalId: a.fiscalId, accountCountry: a.country, accountAddress: a.address });
    }
    // Chave revogada, conta trocada ou subscrição caída: o teste deixa de valer → a
    // emissão fica suspensa (effectiveEngine) até novo teste com sucesso.
    if (['CHAVE_INVALIDA', 'NIF_DIFERENTE', 'SUBSCRICAO_INACTIVA', 'SEM_PERMISSAO'].includes(code)) {
      data.lastTestOk = false;
      data.lastTestCode = code;
      data.lastTestMessage = message;
      data.lastTestAt = new Date();
      if (code === 'SUBSCRICAO_INACTIVA') data.registerSubscription = 'no';
      await this.audit.record({ actorType: 'SYSTEM', action: 'FISCAL_ENGINE_HEALTH_FAILED', entity: 'fiscal_engine_company', entityId: l.companyId, after: { code, message } });
    }
    await this.prisma.fiscalEngineCompany.update({ where: { id: l.id }, data });
  }

  async checkHealthNow(companyId: string) {
    const co = await this.companyById(companyId);
    const l = await this.link(companyId);
    if (!l?.apiKeyEnc) throw new ConflictException('API KEY por inserir');
    await this.monitor(l, co);
    return this.companyDetail(companyId);
  }

  // ── Emissão (POS) ────────────────────────────────────────────────────────
  /** Motor efectivo de uma empresa (pelo schema do tenant). */
  async engineFor(schema: string): Promise<{ engine: EngineCode; reason: string; legacy: boolean }> {
    const co = await this.companyBySchema(schema).catch(() => null);
    if (!co) return { engine: 'LPS', reason: '', legacy: true };
    const [l, s] = await Promise.all([this.link(co.id), this.settings()]);
    return effectiveEngine(l, s, nifFor(l, co.nif));
  }

  /** Recusa a emissão quando o motor da empresa não é o pedido (ex.: suspenso). */
  async assertCanEmit(schema: string): Promise<EngineCode> {
    const e = await this.engineFor(schema);
    if (e.engine === 'SUSPENSO') throw new ServiceUnavailableException(`Emissão fiscal suspensa: ${e.reason}`);
    return e.engine;
  }

  private async maps(companyId: string, api?: VendusClient): Promise<CompanyMaps> {
    const l = await this.link(companyId);
    if (!l) throw new ConflictException('Ligação Vendus inexistente');
    let exemptions: string[] = [];
    if (api) {
      const ex = await api.exemptions();
      exemptions = Array.isArray(ex.data) ? ex.data.map((e: any) => String(e.id)) : [];
    }
    return { registerId: l.registerId, taxMap: (l.taxMap as Record<string, string>) ?? {}, paymentMap: (l.paymentMap as Record<string, string>) ?? {}, exemptions };
  }

  /**
   * Põe uma venda do LPS na fila do Vendus e tenta enviá-la já (a resposta ao caixa
   * leva o número fiscal quando o Vendus responde a tempo). Idempotente por venda.
   */
  async enqueueSale(schema: string, invoiceId: string, extra: { paymentType: string; payments?: { method: string; amount: number }[] | null }) {
    const co = await this.companyBySchema(schema);
    const sale = await this.saleSnapshot(schema, invoiceId, extra);
    const txId = `lps-${invoiceId}-FT`;
    const ext = `LPS-${invoiceId}`;
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string }[]>`
      INSERT INTO fiscal_engine_documents (invoice_id, kind, tx_id, external_reference, mode, state, request)
      VALUES (${invoiceId}::uuid, 'SALE', ${txId}, ${ext}, 'normal', 'A_PREPARAR', ${JSON.stringify({ sale })}::jsonb)
      ON CONFLICT (tx_id) DO UPDATE SET tx_id = EXCLUDED.tx_id
      RETURNING id`);
    await this.event(schema, rows[0].id, 'A_PREPARAR', `Venda ${sale.internalNumber}`);
    return this.dispatch(schema, rows[0].id, co);
  }

  /** Nota de crédito no Vendus para um documento emitido pelo Vendus (anulação/devolução). */
  async enqueueCreditNote(schema: string, sourceInvoiceId: string, ncInvoiceId: string, reason: string, lines: { productCode: string; quantity: number }[] | 'ALL') {
    const co = await this.companyBySchema(schema);
    const src = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<DocRow[]>`
      SELECT * FROM fiscal_engine_documents WHERE invoice_id = ${sourceInvoiceId}::uuid AND kind = 'SALE' LIMIT 1`);
    const s0 = src[0];
    if (!s0?.number) throw new ConflictException('O documento fiscal Vendus de origem ainda não existe');
    const items: any[] = Array.isArray(s0.details?.items) ? s0.details.items : [];
    const ncLines: CreditNoteSnapshot['lines'] = [];
    if (lines === 'ALL') {
      items.forEach((it, i) => ncLines.push({ row: i + 1, vendusItemId: it.id, reference: String(it.reference ?? ''), quantity: Number(it.qty) }));
    } else {
      for (const l of lines) {
        const idx = items.findIndex((it) => String(it.reference) === l.productCode);
        if (idx < 0) throw new ConflictException(`Linha ${l.productCode} não encontrada no documento Vendus ${s0.number}`);
        ncLines.push({ row: idx + 1, vendusItemId: items[idx].id, reference: l.productCode, quantity: l.quantity });
      }
    }
    const nc: CreditNoteSnapshot = { sourceVendusNumber: s0.number, reason, lines: ncLines };
    const txId = `lps-${ncInvoiceId}-NC`;
    const ext = `LPS-${ncInvoiceId}`;
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string }[]>`
      INSERT INTO fiscal_engine_documents (invoice_id, source_doc_id, kind, tx_id, external_reference, mode, state, request)
      VALUES (${ncInvoiceId}::uuid, ${s0.id}::uuid, 'NC', ${txId}, ${ext}, 'normal', 'A_PREPARAR', ${JSON.stringify({ nc })}::jsonb)
      ON CONFLICT (tx_id) DO UPDATE SET tx_id = EXCLUDED.tx_id
      RETURNING id`);
    await this.event(schema, rows[0].id, 'A_PREPARAR', `Nota de crédito de ${s0.number}`);
    return this.dispatch(schema, rows[0].id, co);
  }

  /** Antes de anular/devolver uma venda emitida pelo Vendus: o documento fiscal tem de existir e o motor tem de estar operacional. */
  async assertCanCredit(schema: string, sourceInvoiceId: string): Promise<void> {
    const e = await this.engineFor(schema);
    if (e.engine !== 'VENDUS') throw new ServiceUnavailableException(`A nota de crédito tem de ser emitida pelo Cegid Vendus e o motor não está operacional: ${e.reason || e.engine}`);
    const src = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ number: string | null }[]>`
      SELECT number FROM fiscal_engine_documents WHERE invoice_id = ${sourceInvoiceId}::uuid AND kind = 'SALE' LIMIT 1`);
    if (!src[0]?.number) throw new ConflictException('O documento fiscal Vendus desta venda ainda está pendente: aguarde a emissão antes de anular ou devolver');
  }

  private async saleSnapshot(schema: string, invoiceId: string, extra: { paymentType: string; payments?: { method: string; amount: number }[] | null }): Promise<SaleSnapshot> {
    return this.prisma.runInTenant(schema, async (tx) => {
      const inv = await tx.$queryRaw<any[]>`
        SELECT i.id, i.number, i.doc_type, i.gross_total, i.customer_id, i.customer_tax_id, COALESCE(i.customer_name, c.name) AS customer_name, c.address, c.email, c.phone
        FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id WHERE i.id = ${invoiceId}::uuid`;
      if (!inv[0]) throw new NotFoundException('Venda não encontrada');
      const items = await tx.$queryRaw<any[]>`
        SELECT product_code, description, quantity, unit_price, iva_code, iva_rate, discount_rate, gross_amount, exemption_code
        FROM invoice_items WHERE invoice_id = ${invoiceId}::uuid ORDER BY line_number`;
      const i = inv[0];
      return {
        invoiceId,
        internalNumber: i.number,
        docType: i.doc_type,
        paymentType: extra.paymentType,
        payments: extra.payments ?? null,
        grossTotal: Number(i.gross_total),
        customer: i.customer_id || i.customer_tax_id ? { id: i.customer_id, taxId: i.customer_tax_id, name: i.customer_name, address: i.address, email: i.email, phone: i.phone } : null,
        lines: items.map((l) => ({ productCode: l.product_code, description: l.description, quantity: Number(l.quantity), unitPrice: Number(l.unit_price), ivaCode: l.iva_code, ivaRate: Number(l.iva_rate), discountRate: Number(l.discount_rate), grossAmount: Number(l.gross_amount), exemptionCode: l.exemption_code })),
      };
    });
  }

  private async event(schema: string, docId: string, state: string, detail: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw`INSERT INTO fiscal_engine_events (document_id, state, detail) VALUES (${docId}::uuid, ${state}, ${detail.slice(0, 500)})`).catch(() => undefined);
  }

  private async setDoc(schema: string, id: string, fields: Record<string, unknown>, detail?: string): Promise<void> {
    const sets = Object.entries(fields).map(([k, v]) => {
      if (k === 'details' || k === 'agt' || k === 'request') return Prisma.sql`${Prisma.raw(k)} = ${v === null ? null : JSON.stringify(v)}::jsonb`;
      if (k === 'next_attempt_at') return Prisma.sql`next_attempt_at = ${v as Date}::timestamptz`;
      if (k === 'pdf') return Prisma.sql`pdf = ${v as Buffer}`;
      return Prisma.sql`${Prisma.raw(k)} = ${v as any}`;
    });
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw`UPDATE fiscal_engine_documents SET ${Prisma.join(sets, ', ')}, updated_at = now() WHERE id = ${id}::uuid`);
    if (typeof fields.state === 'string') await this.event(schema, id, fields.state, detail ?? '');
  }

  /**
   * Processa UM documento da fila. Ordem de segurança:
   *   1. reclama-o atomicamente (nunca dois envios em paralelo);
   *   2. se já houve tentativa (ou o estado é desconhecido) PROCURA primeiro o
   *      documento no Vendus por external_reference — só envia se não existir;
   *   3. timeout/erro de rede depois de enviar → ESTADO_DESCONHECIDO (pode ter sido
   *      criado), e a próxima passagem reconcilia antes de qualquer novo POST.
   */
  async dispatch(schema: string, id: string, co?: CompanyRef): Promise<{ id: string; state: DocState; number: string | null; pdf: boolean; error: string | null }> {
    const key = `${schema}:${id}`;
    const company = co ?? (await this.companyBySchema(schema));
    if (this.inFlight.has(key)) return this.docSummary(schema, id);
    this.inFlight.add(key);
    try {
      const claimed = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<DocRow[]>`
        UPDATE fiscal_engine_documents SET attempts = attempts + 1, updated_at = now()
        WHERE id = ${id}::uuid AND state = ANY(${RETRYABLE}::text[]) AND next_attempt_at <= now()
        RETURNING *`);
      const d = claimed[0];
      if (!d) {
        await this.completeDetails(schema, id, company).catch(() => undefined);
        return this.docSummary(schema, id);
      }
      const l = await this.link(company.id);
      if (!l?.apiKeyEnc) {
        await this.setDoc(schema, id, { state: 'ERRO_DE_COMUNICACAO', last_error: 'API KEY por inserir', last_error_code: 'SEM_CHAVE', next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(d.attempts)) }, 'API KEY por inserir');
        return this.docSummary(schema, id);
      }
      // Documentos fiscais reais só com o motor Vendus operacional (validade, switch, ligação).
      if (d.mode !== 'tests') {
        const s = await this.settings();
        const eff = effectiveEngine(l, s, nifFor(l, company.nif));
        if (eff.engine !== 'VENDUS') {
          await this.setDoc(schema, id, { state: d.state === 'ESTADO_DESCONHECIDO' ? 'ESTADO_DESCONHECIDO' : 'A_PREPARAR', last_error: `Emissão bloqueada: ${eff.reason}`, last_error_code: 'MOTOR_INDISPONIVEL', next_attempt_at: new Date(Date.now() + 15 * 60_000) }, `Bloqueado: ${eff.reason}`);
          return this.docSummary(schema, id);
        }
      }
      const api = await this.client(l);
      // 2. Reconciliação antes de (re)enviar.
      if (d.attempts > 1 || d.state === 'ESTADO_DESCONHECIDO') {
        const found = await api.documents({ external_reference: d.external_reference, mode: d.mode, per_page: 5 });
        if (found.ok && Array.isArray(found.data)) {
          const hit = found.data.find((x: any) => String(x.external_reference ?? '') === d.external_reference) ?? (found.data.length === 1 ? found.data[0] : null);
          if (hit?.id) {
            await this.adopt(schema, d, hit, company, 'Encontrado no Vendus (reconciliação) — não foi reenviado');
            return this.docSummary(schema, id);
          }
        } else if (!found.ok && !(found.status === 404)) {
          // Sem conseguir confirmar se existe, NÃO se envia de novo.
          await this.setDoc(schema, id, { state: 'ESTADO_DESCONHECIDO', last_error: `Reconciliação impossível: ${found.error?.message}`, last_error_code: found.error?.code ?? 'REDE', next_attempt_at: new Date(Date.now() + nextAttemptDelayMs(d.attempts)) }, 'Reconciliação pendente');
          return this.docSummary(schema, id);
        }
      }
      // 3. Corpo do pedido.
      let body: Record<string, unknown> | undefined;
      if (d.kind === 'TEST') body = d.request;
      else {
        const maps = await this.maps(company.id, api);
        const op = { txId: d.tx_id, externalReference: d.external_reference, mode: d.mode as 'normal' | 'tests' };
        const built = d.kind === 'NC' ? buildCreditNote(d.request.nc, maps, op) : buildSaleDocument(d.request.sale, maps, op);
        if (built.errors.length) {
          await this.setDoc(schema, id, { state: 'CORRECCAO_NECESSARIA', last_error: built.errors.join('; '), last_error_code: 'DADOS' }, built.errors.join('; '));
          return this.docSummary(schema, id);
        }
        body = built.body;
      }
      await this.setDoc(schema, id, { state: 'A_ENVIAR', request: d.kind === 'TEST' ? body : { ...d.request, body } }, 'POST /documents/');
      const res = await api.createDocument(body);
      if (res.ok && (res.data as any)?.id) {
        await this.adopt(schema, d, res.data, company, `Criado no Vendus (HTTP ${res.status})`);
        return this.docSummary(schema, id);
      }
      await this.failed(schema, d, res);
      return this.docSummary(schema, id);
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async failed(schema: string, d: DocRow, res: VendusResult): Promise<void> {
    const code = res.error?.code ?? 'RESPOSTA_INVALIDA';
    const message = res.error?.message ?? `HTTP ${res.status}`;
    const later = new Date(Date.now() + nextAttemptDelayMs(d.attempts));
    if (code === 'VALIDACAO' || code === 'NAO_ENCONTRADO') {
      await this.setDoc(schema, d.id, { state: 'CORRECCAO_NECESSARIA', last_error: message, last_error_code: code }, `Recusado pelo Vendus: ${message}`);
    } else if (code === 'TIMEOUT' || code === 'REDE' || code === 'INDISPONIVEL' || code === 'RESPOSTA_INVALIDA') {
      // Pode ter sido criado do lado do Vendus: estado desconhecido → reconciliação.
      await this.setDoc(schema, d.id, { state: 'ESTADO_DESCONHECIDO', last_error: message, last_error_code: code, next_attempt_at: later }, `Sem confirmação (${code}) — a reconciliar`);
    } else {
      // 401/403/429: não processado; repete-se mais tarde (a monitorização trata a chave/subscrição).
      await this.setDoc(schema, d.id, { state: 'ERRO_DE_COMUNICACAO', last_error: message, last_error_code: code, next_attempt_at: later }, `${code}: ${message}`);
    }
  }

  /** Grava a resposta do Vendus, lê o detalhe e o PDF original. */
  private async adopt(schema: string, d: DocRow, created: any, co: CompanyRef, why: string): Promise<void> {
    await this.setDoc(schema, d.id, {
      state: 'CRIADO_NO_VENDUS',
      vendus_id: String(created.id),
      doc_type: created.type ?? null,
      number: created.number ?? null,
      doc_date: created.date ?? null,
      amount_gross: created.amount_gross != null ? Number(created.amount_gross) : null,
      amount_net: created.amount_net != null ? Number(created.amount_net) : null,
      hash: created.hash ?? null,
      last_error: null,
      last_error_code: null,
    }, `${why}: ${created.number ?? created.id}`);
    await this.completeDetails(schema, d.id, co);
  }

  /**
   * NÚMERO AGT: a AGT pode atribuí-lo depois da emissão. Para os documentos dos
   * últimos 7 dias ainda sem número AGT, volta a ler o detalhe ao Vendus (no
   * máximo `limit` por ciclo e cada um de 10 em 10 min).
   */
  async refreshAgtNumbers(schema: string, co: CompanyRef, limit = 10): Promise<number> {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; vendus_id: string; mode: string }[]>`
      SELECT id, vendus_id, mode FROM fiscal_engine_documents
      WHERE vendus_id IS NOT NULL AND COALESCE(mode, 'normal') <> 'tests'
        AND COALESCE(agt ->> 'document_number', '') !~ '[A-Za-z]'
        AND created_at > now() - interval '7 days' AND updated_at < now() - interval '10 minutes'
      ORDER BY created_at DESC LIMIT ${limit}`).catch(() => []);
    if (!rows.length) return 0;
    const l = await this.link(co.id);
    if (!l?.apiKeyEnc) return 0;
    const api = await this.client(l, 15_000);
    let n = 0;
    for (const r of rows) {
      const det = await api.document(r.vendus_id, r.mode).catch(() => null);
      const x = det?.ok ? (det.data as Record<string, any>) : null;
      await this.prisma.runInTenant(schema, (tx) => x
        ? tx.$executeRaw`UPDATE fiscal_engine_documents SET agt = ${JSON.stringify(x.agt ?? null)}::jsonb,
            details = ${JSON.stringify(x)}::jsonb, qrcode_data = COALESCE(${x.qrcode_data ?? null}, qrcode_data), updated_at = now()
            WHERE id = ${r.id}::uuid`
        : tx.$executeRaw`UPDATE fiscal_engine_documents SET updated_at = now() WHERE id = ${r.id}::uuid`).catch(() => undefined);
      if (x && agtDocumentNumber(x.agt)) n++;
    }
    return n;
  }

  /** Detalhe (GET /documents/{id}) + PDF original (GET /documents/{id}.pdf). */
  private async completeDetails(schema: string, id: string, co: CompanyRef): Promise<void> {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<(DocRow & { pdf_present: boolean; request: any })[]>`
      SELECT *, pdf IS NOT NULL AS pdf_present FROM fiscal_engine_documents WHERE id = ${id}::uuid`);
    const d = rows[0];
    if (!d?.vendus_id || (d.details && d.pdf_present)) return;
    const l = await this.link(co.id);
    if (!l?.apiKeyEnc) return;
    const api = await this.client(l);
    const fields: Record<string, unknown> = {};
    if (!d.details) {
      const det = await api.document(d.vendus_id, d.mode);
      if (!det.ok) fields.last_error = `Detalhe: ${det.error?.message ?? `HTTP ${det.status}`}`.slice(0, 500);
      if (det.ok && det.data) {
        const x = det.data as any;
        fields.details = x;
        fields.agt = x.agt ?? null;
        fields.qrcode_data = x.qrcode_data ?? null;
        if (x.number) fields.number = x.number;
        if (x.hash) fields.hash = x.hash;
        const lpsGross = d.kind === 'SALE' ? Number(d.request?.sale?.grossTotal) : NaN;
        if (Number.isFinite(lpsGross)) fields.divergence = totalsDivergence(lpsGross, x.amount_gross);
        fields.state = agtStateFromDetails(x, d.mode);
      }
    }
    if (!d.pdf_present) {
      const pdf = await api.documentPdf(d.vendus_id, d.mode);
      if (pdf.ok && pdf.bytes) {
        fields.pdf = pdf.bytes;
        fields.pdf_sha256 = createHash('sha256').update(pdf.bytes).digest('hex');
        if (d.last_error?.startsWith('PDF:')) fields.last_error = null;
      } else {
        fields.last_error = `PDF: ${pdf.error?.message ?? `HTTP ${pdf.status}`}`.slice(0, 500);
      }
    }
    if (Object.keys(fields).length) await this.setDoc(schema, id, fields, fields.state ? (d.mode === 'tests' ? 'Documento de testes (sem validade fiscal)' : 'A aguardar confirmação AGT (consulta no Backoffice Vendus)') : undefined);
  }

  private async docSummary(schema: string, id: string) {
    const r = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; state: DocState; number: string | null; pdf: boolean; last_error: string | null }[]>`
      SELECT id, state, number, pdf IS NOT NULL AS pdf, last_error FROM fiscal_engine_documents WHERE id = ${id}::uuid`);
    const x = r[0];
    return { id, state: x?.state ?? 'ESTADO_DESCONHECIDO', number: x?.number ?? null, pdf: !!x?.pdf, error: x?.last_error ?? null };
  }

  async processQueue(schema: string, co: CompanyRef, limit = 20): Promise<void> {
    const due = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM fiscal_engine_documents
      WHERE (state = ANY(${RETRYABLE}::text[]) AND next_attempt_at <= now())
         OR (vendus_id IS NOT NULL AND (details IS NULL OR pdf IS NULL) AND updated_at < now() - interval '1 minute')
      ORDER BY created_at LIMIT ${limit}`).catch(() => [] as { id: string }[]);
    for (const r of due) await this.dispatch(schema, r.id, co).catch((e) => this.log.warn(`documento ${r.id}: ${msg(e)}`));
  }

  /** Reenvio manual de um documento em CORRECCAO_NECESSARIA (depois de corrigir a configuração). */
  async retry(schema: string, id: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ state: string }[]>`SELECT state FROM fiscal_engine_documents WHERE id = ${id}::uuid`);
    if (!rows[0]) throw new NotFoundException('Documento não encontrado');
    if (!['CORRECCAO_NECESSARIA', 'ERRO_DE_COMUNICACAO', 'ESTADO_DESCONHECIDO', 'A_PREPARAR'].includes(rows[0].state)) throw new ConflictException('Este documento já foi emitido');
    // Volta como "desconhecido": a próxima passagem procura-o primeiro no Vendus.
    await this.setDoc(schema, id, { state: 'ESTADO_DESCONHECIDO', next_attempt_at: new Date() }, 'Reenvio pedido (com reconciliação)');
    return this.dispatch(schema, id);
  }

  // ── Consulta ─────────────────────────────────────────────────────────────
  async listDocuments(schema: string, q: { state?: string; limit?: number }) {
    const lim = Math.min(Math.max(Number(q.limit) || 100, 1), 500);
    const where = q.state ? Prisma.sql`WHERE d.state = ${q.state}` : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT d.id, d.kind, d.mode, d.state, d.attempts, d.vendus_id, d.doc_type, d.number, d.doc_date, d.amount_gross, d.amount_net,
             d.hash, d.agt, d.divergence, d.last_error, d.last_error_code, d.created_at, d.updated_at, d.pdf IS NOT NULL AS has_pdf,
             i.number AS internal_number, d.invoice_id
      FROM fiscal_engine_documents d LEFT JOIN invoices i ON i.id = d.invoice_id
      ${where} ORDER BY d.created_at DESC LIMIT ${lim}`);
  }

  async documentSummaryCounts(schema: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ state: string; n: number }[]>`
      SELECT state, COUNT(*)::int AS n FROM fiscal_engine_documents WHERE kind <> 'TEST' GROUP BY state`).catch(() => []);
    return Object.fromEntries(rows.map((r) => [r.state, r.n]));
  }

  async documentDetail(schema: string, id: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT d.id, d.kind, d.mode, d.state, d.tx_id, d.external_reference, d.attempts, d.vendus_id, d.doc_type, d.number, d.doc_date,
             d.amount_gross, d.amount_net, d.hash, d.qrcode_data, d.agt, d.divergence, d.last_error, d.last_error_code, d.pdf_sha256,
             d.created_at, d.updated_at, i.number AS internal_number, d.invoice_id
      FROM fiscal_engine_documents d LEFT JOIN invoices i ON i.id = d.invoice_id WHERE d.id = ${id}::uuid`);
    if (!rows[0]) throw new NotFoundException('Documento não encontrado');
    const events = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`SELECT state, detail, at FROM fiscal_engine_events WHERE document_id = ${id}::uuid ORDER BY at, id`);
    return { ...rows[0], events };
  }

  async documentForInvoice(schema: string, invoiceId: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT id, kind, state, number, doc_type, vendus_id, pdf IS NOT NULL AS has_pdf, last_error, agt FROM fiscal_engine_documents
      WHERE invoice_id = ${invoiceId}::uuid ORDER BY created_at DESC LIMIT 1`).catch(() => []);
    const r = rows[0];
    return r ? { ...r, agt_number: agtDocumentNumber(r.agt) } : null;
  }

  /** PDF ORIGINAL do Vendus, exactamente como foi devolvido (sem alterações). */
  async documentPdf(schema: string, id: string): Promise<{ pdf: Buffer; number: string | null }> {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ pdf: Buffer | null; number: string | null; pdf_sha256: string | null }[]>`
      SELECT pdf, number, pdf_sha256 FROM fiscal_engine_documents WHERE id = ${id}::uuid`);
    const r = rows[0];
    if (!r?.pdf) throw new NotFoundException('PDF ainda não disponível');
    const sha = createHash('sha256').update(r.pdf).digest('hex');
    if (r.pdf_sha256 && sha !== r.pdf_sha256) throw new ConflictException('O PDF arquivado não corresponde ao original (integridade)');
    return { pdf: Buffer.from(r.pdf), number: r.number };
  }

  /**
   * TALÃO do documento para impressora térmica, gerado pelo Cegid Vendus (o LPS não
   * reconstrói o documento fiscal). `html` para imprimir pelo navegador/app;
   * `escpos` (base64) para impressoras emparelhadas por USB/Bluetooth.
   */
  async documentPrint(schema: string, id: string, o: { format: 'html' | 'escpos'; copy: 'ORIGINAL' | 'DUPLICATE' }): Promise<{ format: 'html' | 'escpos'; data: string; number: string | null }> {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ vendus_id: string | null; mode: string; number: string | null }[]>`
      SELECT vendus_id, mode, number FROM fiscal_engine_documents WHERE id = ${id}::uuid`);
    const d = rows[0];
    if (!d) throw new NotFoundException('Documento não encontrado');
    if (!d.vendus_id) throw new ConflictException('O documento ainda não foi emitido no Cegid Vendus');
    const co = await this.companyBySchema(schema);
    const l = await this.link(co.id);
    if (!l) throw new ConflictException('Ligação Vendus inexistente');
    const api = await this.client(l);
    const r = await api.documentOutput(d.vendus_id, { output: o.format, version: o.copy, registerId: l.registerId, mode: d.mode });
    if (!r.ok) throw new ServiceUnavailableException(`Cegid Vendus: ${r.error?.message ?? 'talão indisponível'}`);
    const data = printableOutput((r.data ?? {}) as Record<string, unknown>, o.format);
    if (!data) throw new ServiceUnavailableException('O Cegid Vendus não devolveu o talão');
    return { format: o.format, data, number: d.number };
  }

  // ── Sincronização de clientes e produtos ─────────────────────────────────
  async syncClients(schema: string) {
    const co = await this.companyBySchema(schema);
    const l = await this.link(co.id);
    if (!l?.lastTestOk) throw new ConflictException('Teste a ligação Vendus primeiro');
    const api = await this.client(l);
    const customers = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT c.id, c.tax_id, c.name, c.email, c.phone, c.address, k.vendus_id
      FROM customers c LEFT JOIN fiscal_engine_links k ON k.entity = 'client' AND k.lps_id = c.id::text
      WHERE c.is_active AND c.tax_id IS NOT NULL AND c.tax_id <> '' ORDER BY c.created_at LIMIT 500`);
    const out = { created: 0, linked: 0, updated: 0, skipped: 0, errors: [] as string[] };
    for (const c of customers) {
      const nif = String(c.tax_id).toUpperCase().trim();
      if (!/^[A-Z0-9]{5,20}$/.test(nif) || nif === '999999990') { out.skipped++; continue; }
      const body = { fiscal_id: nif, name: c.name, email: c.email || undefined, phone: c.phone || undefined, address: c.address || undefined, country: 'AO', external_reference: c.id };
      let vid: string | null = c.vendus_id;
      if (!vid) {
        // Procura antes de criar: pelo vínculo externo e pelo NIF (sem duplicados).
        const byRef = await api.clients({ external_reference: c.id });
        const byNif = byRef.ok && Array.isArray(byRef.data) && byRef.data.length ? byRef : await api.clients({ fiscal_id: nif });
        const hit = byNif.ok && Array.isArray(byNif.data) ? byNif.data.find((x: any) => normNif(x.fiscal_id) === nif) : null;
        if (hit?.id) { vid = String(hit.id); out.linked++; }
        else {
          const r = await api.createClient(body);
          if (!r.ok || !(r.data as any)?.id) { out.errors.push(`${c.name}: ${r.error?.message ?? 'sem id'}`); continue; }
          vid = String((r.data as any).id);
          out.created++;
        }
        await this.saveLink(schema, 'client', c.id, vid);
      } else {
        const r = await api.updateClient(vid, body);
        if (r.ok) out.updated++; else out.errors.push(`${c.name}: ${r.error?.message}`);
      }
    }
    return out;
  }

  async syncProducts(schema: string) {
    const co = await this.companyBySchema(schema);
    const l = await this.link(co.id);
    if (!l?.lastTestOk) throw new ConflictException('Teste a ligação Vendus primeiro');
    const api = await this.client(l);
    const taxMap = (l.taxMap as Record<string, string>) ?? {};
    const units = await api.units();
    const unitId = Array.isArray(units.data) && units.data[0]?.id ? units.data[0].id : null;
    const products = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT p.id, p.code, p.name, p.description, p.barcode, p.unit_price, p.iva_code, p.exemption_code, p.is_active, k.vendus_id
      FROM products p LEFT JOIN fiscal_engine_links k ON k.entity = 'product' AND k.lps_id = p.id::text
      ORDER BY p.code LIMIT 1000`).catch(async () => this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT p.id, p.code, p.name, p.description, NULL::text AS barcode, p.unit_price, p.iva_code, p.exemption_code, p.is_active, k.vendus_id
      FROM products p LEFT JOIN fiscal_engine_links k ON k.entity = 'product' AND k.lps_id = p.id::text
      ORDER BY p.code LIMIT 1000`));
    const rates: Record<string, number> = { NOR: 14, INT: 7, RED: 5, ISE: 0, OUT: 0 };
    const out = { created: 0, linked: 0, updated: 0, skipped: 0, errors: [] as string[] };
    for (const p of products) {
      const tax = taxMap[p.iva_code];
      if (!tax) { out.errors.push(`${p.code}: imposto ${p.iva_code} sem correspondência na conta Vendus`); continue; }
      const body: Record<string, unknown> = {
        reference: p.code,
        title: p.name,
        description: p.description || undefined,
        barcode: p.barcode || undefined,
        gross_price: (Math.round(Number(p.unit_price) * (1 + (rates[p.iva_code] ?? 0) / 100) * 100) / 100).toFixed(2),
        tax_id: tax,
        status: p.is_active ? 'on' : 'off',
      };
      if ((rates[p.iva_code] ?? 0) === 0 && p.exemption_code) body.tax_exemption = p.exemption_code;
      let vid: string | null = p.vendus_id;
      if (!vid) {
        const found = await api.products({ reference: p.code, status: 'all' });
        const hit = found.ok && Array.isArray(found.data) ? found.data.find((x: any) => String(x.reference) === p.code) : null;
        if (hit?.id) { vid = String(hit.id); out.linked++; }
        else {
          if (!unitId) { out.errors.push(`${p.code}: a conta Vendus não tem unidades (unit_id obrigatório)`); continue; }
          const r = await api.createProduct({ ...body, unit_id: unitId });
          if (!r.ok || !(r.data as any)?.id) { out.errors.push(`${p.code}: ${r.error?.message ?? 'sem id'}`); continue; }
          vid = String((r.data as any).id);
          out.created++;
        }
        await this.saveLink(schema, 'product', p.id, vid);
      } else {
        const r = await api.updateProduct(vid, body);
        if (r.ok) out.updated++; else out.errors.push(`${p.code}: ${r.error?.message}`);
      }
    }
    return out;
  }

  private async saveLink(schema: string, entity: string, lpsId: string, vendusId: string): Promise<void> {
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw`
      INSERT INTO fiscal_engine_links (entity, lps_id, vendus_id) VALUES (${entity}, ${lpsId}, ${vendusId})
      ON CONFLICT (entity, lps_id) DO UPDATE SET vendus_id = EXCLUDED.vendus_id, synced_at = now()`);
  }

  // ── SAF-T (AO) do Vendus ─────────────────────────────────────────────────
  async fetchSaft(schema: string, year: number, month: number) {
    if (!Number.isInteger(year) || year < 2019 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) throw new BadRequestException('Período inválido');
    const co = await this.companyBySchema(schema);
    const l = await this.link(co.id);
    if (!l?.lastTestOk) throw new ConflictException('Teste a ligação Vendus primeiro');
    const api = await this.client(l, 60_000);
    const r = await api.saft(year, month);
    if (!r.ok || !r.data?.xml) throw new ServiceUnavailableException(`SAF-T do Vendus indisponível: ${r.error?.message ?? 'sem XML'}`);
    const xml = Buffer.from(r.data.xml, 'base64').toString('utf8');
    const xsd = await validateSaftXsd(xml);
    const issues: string[] = xsd.issues.map((i) => (i.line ? `linha ${i.line}: ${i.message}` : i.message));
    const ns = /<AuditFile[^>]*xmlns="([^"]+)"/.exec(xml)?.[1] ?? '';
    if (ns !== 'urn:OECD:StandardAuditFile-Tax:AO_1.01_01') issues.unshift(`Namespace ${ns || '(nenhum)'} — não é o SAF-T (AO) 1.01_01`);
    const header = {
      namespace: ns,
      taxRegistrationNumber: tag(xml, 'TaxRegistrationNumber'),
      startDate: tag(xml, 'StartDate'),
      endDate: tag(xml, 'EndDate'),
      productId: tag(xml, 'ProductID'),
      softwareValidationNumber: tag(xml, 'SoftwareValidationNumber'),
    };
    const tnif = nifFor(l, co.nif);
    if (header.taxRegistrationNumber && !sameNif(header.taxRegistrationNumber, tnif)) issues.unshift(`NIF do ficheiro ${header.taxRegistrationNumber} ≠ NIF do contribuinte ${tnif}`);
    const valid = xsd.valid && issues.length === xsd.issues.length;
    const sha256 = createHash('sha256').update(xml).digest('hex');
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ id: string; fetched_at: Date }[]>`
      INSERT INTO fiscal_engine_saft (year, month, xml, sha256, xsd_valid, issues, header)
      VALUES (${year}, ${month}, ${xml}, ${sha256}, ${valid}, ${JSON.stringify(issues.slice(0, 50))}::jsonb, ${JSON.stringify(header)}::jsonb)
      RETURNING id, fetched_at`);
    return { id: rows[0].id, year, month, sha256, valid, issues: issues.slice(0, 50), header, fetchedAt: rows[0].fetched_at };
  }

  async saftHistory(schema: string) {
    return this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<any[]>`
      SELECT id, year, month, sha256, xsd_valid AS valid, issues, header, fetched_at, length(xml) AS size FROM fiscal_engine_saft ORDER BY fetched_at DESC LIMIT 60`).catch(() => []);
  }

  async saftFile(schema: string, id: string) {
    const rows = await this.prisma.runInTenant(schema, (tx) => tx.$queryRaw<{ xml: string; year: number; month: number }[]>`SELECT xml, year, month FROM fiscal_engine_saft WHERE id = ${id}::uuid`);
    if (!rows[0]) throw new NotFoundException('Ficheiro não encontrado');
    return rows[0];
  }

  // ── Landing (divulgação pública) ─────────────────────────────────────────
  /**
   * O que a landing pode dizer sobre o software fiscal. Só identifica o Cegid Vendus
   * como motor em utilização quando o switch está ligado, a validade está confirmada
   * e pelo menos uma empresa o tem activo. O nº de validação do Vendus nunca é
   * apresentado como sendo do LPS.
   */
  async publicDisclosure() {
    const s = await this.settings().catch(() => null);
    if (!s) return { vendus: null, lps: null };
    const v = providerValidity(s);
    const lps = lpsValidationComplete(s);
    let vendus: Record<string, string> | null = null;
    if (s.vendusEnabled && v.status === 'CONFIRMADO') {
      // Conta só empresas cujo motor EFECTIVO é o Vendus (activas, ligação válida).
      const links = await this.prisma.fiscalEngineCompany.findMany({ where: { engine: 'VENDUS', activatedAt: { not: null } } });
      const nifs = new Map((await this.prisma.company.findMany({ where: { id: { in: links.map((l) => l.companyId) } }, select: { id: true, nif: true } })).map((c) => [c.id, c.nif]));
      const active = links.filter((l) => effectiveEngine(l, s, nifFor(l, nifs.get(l.companyId) ?? '')).engine === 'VENDUS').length;
      if (active > 0) vendus = { name: 'Cegid Vendus', producer: s.providerProducer, validationNo: s.providerValidationNo, feCertNo: s.providerFeCertNo, version: s.providerVersion, validUntil: ymd(s.providerValidUntil) ?? '', url: 'https://www.vendus.co.ao/' };
    }
    return { vendus, lps: lps.ok ? { validationNo: s.lpsValidationNo, version: s.lpsValidationVersion } : null };
  }
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
function ymd(d: Date | null | undefined): string | null {
  return d ? d.toISOString().slice(0, 10) : null;
}
function parseDate(v: unknown): Date | null {
  if (v === null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(`${s}T00:00:00Z`))) throw new BadRequestException(`Data inválida: ${s}`);
  return new Date(`${s}T00:00:00Z`);
}
function tag(xml: string, name: string): string {
  return new RegExp(`<${name}>([^<]*)</${name}>`).exec(xml)?.[1] ?? '';
}

/** NIF do contribuinte de uma ligação: o configurado no Super Admin ou, vazio, o da empresa no LPS. */
function nifFor(l: { taxpayerNif?: string | null } | null | undefined, companyNif: string): string {
  return (l?.taxpayerNif ?? '').trim() || companyNif;
}

/**
 * Conteúdo imprimível devolvido pelo Vendus (`output_data`, ou `output` quando é o
 * próprio conteúdo). HTML pode vir em base64; ESC/POS devolve-se SEMPRE em base64.
 */
export function printableOutput(body: Record<string, unknown>, format: 'html' | 'escpos'): string | null {
  const cands = [body.output_data, body.output].filter((v): v is string => typeof v === 'string' && v.length > 0 && !/^(html|escpos|pdf)$/i.test(v));
  const raw = cands[0];
  if (!raw) return null;
  const isB64 = /^[A-Za-z0-9+/=\s]+$/.test(raw) && raw.replace(/\s/g, '').length % 4 === 0;
  if (format === 'html') {
    if (/<[a-z!]/i.test(raw)) return raw;
    return isB64 ? Buffer.from(raw, 'base64').toString('utf8') : raw;
  }
  return isB64 ? raw.replace(/\s/g, '') : Buffer.from(raw, 'binary').toString('base64');
}
