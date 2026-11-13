import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Injectable, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Prisma } from '@prisma/client';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../common/mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { AdminNotificationsService } from './admin-notifications';
import { KwanzaService } from './kwanza.service';
import { ANGOLA_BANKS, withdrawalDue } from './kwanza-rules';
export { ANGOLA_BANKS, withdrawalDue };

/**
 * LPS Kwanza — regras dos saques entre empresas e associados:
 *  • Prazo: pedido de segunda a quinta → a empresa aprova e transfere em até 24 h.
 *    Sexta a domingo (não especificado pelo cliente): decisão provisória mais segura para o
 *    associado sem obrigar a empresa ao fim de semana — prazo até ao fim da segunda-feira seguinte.
 *  • Prazo ultrapassado → o associado reclama à equipa do sistema (Super Admin), que o
 *    encontra pelo código do associado. O Super Admin notifica a empresa e dá-lhe mais 24 h.
 *  • Ainda sem pagamento → o Super Admin bane a empresa do LPS Kwanza (produtos saem do
 *    marketplace e deixa de publicar) e regista o reembolso ao associado (pago pela plataforma;
 *    o valor fica como dívida da empresa).
 *  • Bancos: cada empresa indica os bancos onde tem conta, para o associado receber no mesmo banco.
 */
const T = (name: string) => Prisma.raw(`nexus_public."${name}"`);
const num = (v: unknown) => Number(v ?? 0) || 0;
const H = 3_600_000;
/** Dias mínimos de banimento antes de o Super Admin poder reativar a empresa (pedido: 15 a 20 dias). */
export const BAN_DAYS = 15;

interface WdRow {
  id: string; associateId: string; companyId: string; amount: unknown; method: string; details: string | null; status: string; note: string | null;
  createdAt: Date; decidedAt: Date | null; dueAt: Date | null; postponedAt: Date | null; complainedAt: Date | null; complaint: string | null; escalation: string | null;
  notifiedAt: Date | null; extendedUntil: Date | null; adminNote: string | null; refundedAt: Date | null; refundRef: string | null;
}
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);

@Injectable()
export class KwanzaPayoutsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly notes: AdminNotificationsService,
    private readonly mail: MailService,
    private readonly auditLog: AuditService,
  ) {}

  /* ─────────── bancos da empresa ─────────── */
  async banks(companyId: string): Promise<string[]> {
    const r = await this.prisma.$queryRaw<{ banks: unknown }[]>(Prisma.sql`SELECT banks FROM ${T('kwanza_policies')} WHERE "companyId" = ${companyId}::uuid`).catch(() => []);
    return Array.isArray(r[0]?.banks) ? (r[0]!.banks as unknown[]).map(String) : [];
  }
  async saveBanks(companyId: string, list: string[]) {
    const clean = [...new Set((list ?? []).map((b) => String(b ?? '').trim().slice(0, 60)).filter((b) => b.length >= 2))].slice(0, 20);
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_policies')} ("companyId", "returnDays", text, banks, "updatedAt") VALUES (${companyId}::uuid, 7, NULL, ${JSON.stringify(clean)}::jsonb, now())
      ON CONFLICT ("companyId") DO UPDATE SET banks = EXCLUDED.banks, "updatedAt" = now()`);
    return { banks: clean, catalog: ANGOLA_BANKS };
  }
  /** Bancos de várias empresas de uma vez (para o painel do associado). */
  async banksFor(companyIds: string[]): Promise<Record<string, string[]>> {
    if (!companyIds.length) return {};
    const r = await this.prisma.$queryRaw<{ id: string; banks: unknown }[]>(Prisma.sql`SELECT "companyId"::text AS id, banks FROM ${T('kwanza_policies')} WHERE "companyId" = ANY(${companyIds}::uuid[])`).catch(() => []);
    return Object.fromEntries(r.map((x) => [x.id, Array.isArray(x.banks) ? (x.banks as unknown[]).map(String) : []]));
  }

  /* ─────────── banimento ─────────── */
  async isBanned(companyId: string): Promise<{ reason: string; createdAt: string } | null> {
    const r = await this.prisma.$queryRaw<{ reason: string; createdAt: Date }[]>(Prisma.sql`SELECT reason, "createdAt" FROM ${T('kwanza_bans')} WHERE "companyId" = ${companyId}::uuid`).catch(() => []);
    return r[0] ? { reason: r[0].reason, createdAt: r[0].createdAt.toISOString() } : null;
  }

  /* ─────────── associado: reclamar de um saque fora de prazo ─────────── */
  async complain(associateId: string, id: string, text?: string) {
    const r = await this.prisma.$queryRaw<WdRow[]>(Prisma.sql`SELECT * FROM ${T('kwanza_withdrawals')} WHERE id = ${id}::uuid AND "associateId" = ${associateId}::uuid`);
    const w = r[0];
    if (!w) throw new NotFoundException('Saque não encontrado.');
    if (w.escalation) throw new BadRequestException('Já reclamou deste saque. A equipa do LPS Kwanza está a acompanhar.');
    // Recusa da empresa: o associado que não concorde com o motivo contesta ao Super Admin.
    if (w.status === 'REJECTED') {
      const body = String(text ?? '').trim().slice(0, 600) || null;
      if (!body || body.length < 5) throw new BadRequestException('Explique porque não concorda com a recusa.');
      const n = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE ${T('kwanza_withdrawals')} SET escalation = 'OPEN', "complainedAt" = now(), complaint = ${body}
        WHERE id = ${id}::uuid AND status = 'REJECTED' AND escalation IS NULL`);
      if (!n) throw new BadRequestException('Já contestou esta recusa.');
      await this.pushCompany(w.companyId, { kind: 'KWANZA_WITHDRAWAL_COMPLAINT', title: 'Recusa de saque contestada', body: `${num(w.amount).toLocaleString('pt-PT')} Kz — o associado contestou a recusa junto da equipa do LPS Kwanza.`, section: 'kwanza', ref: 'withdrawals' });
      return { ok: true as const };
    }
    if (w.status !== 'REQUESTED') throw new BadRequestException('Este saque já foi decidido pela empresa.');
    // Comparação no SQL (relógio da base): os dois lados ficam no mesmo fuso.
    // Adiado pela empresa: o associado que não concorde contesta logo; sem adiamento, só depois do prazo.
    const early = await this.prisma.$queryRaw<{ e: boolean }[]>(Prisma.sql`SELECT ("postponedAt" IS NULL AND COALESCE("dueAt", "createdAt" + interval '24 hours') > now()) AS e FROM ${T('kwanza_withdrawals')} WHERE id = ${id}::uuid`);
    if (early[0]?.e) throw new BadRequestException('A empresa ainda está dentro do prazo para pagar.');
    const body = String(text ?? '').trim().slice(0, 600) || null;
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_withdrawals')} SET escalation = 'OPEN', "complainedAt" = now(), complaint = ${body}, "dueAt" = COALESCE("dueAt", "createdAt" + interval '24 hours')
      WHERE id = ${id}::uuid AND status = 'REQUESTED' AND escalation IS NULL AND ("postponedAt" IS NOT NULL OR COALESCE("dueAt", "createdAt" + interval '24 hours') <= now())`);
    if (!n) throw new BadRequestException('Já reclamou deste saque.');
    await this.pushCompany(w.companyId, { kind: 'KWANZA_WITHDRAWAL_COMPLAINT', title: 'Reclamação de saque fora do prazo', body: `${num(w.amount).toLocaleString('pt-PT')} Kz — o associado reclamou à equipa do LPS Kwanza.`, section: 'kwanza', ref: 'withdrawals' });
    return { ok: true as const };
  }

  /* ─────────── Super Admin ─────────── */
  async adminList(q?: string, status?: string) {
    const term = String(q ?? '').trim();
    const filter = status === 'all' ? Prisma.sql`w.escalation IS NOT NULL`
      : status === 'overdue' ? Prisma.sql`w.status = 'REQUESTED' AND w.escalation IS NULL AND COALESCE(w."dueAt", w."createdAt" + interval '24 hours') < now()`
      : status === 'closed' ? Prisma.sql`w.escalation IN ('RESOLVED', 'REFUNDED')`
      : Prisma.sql`w.escalation IN ('OPEN', 'NOTIFIED')`;
    const search = term
      ? Prisma.sql`AND (upper(a.code) = ${term.toUpperCase()} OR a.name ILIKE ${`%${term}%`} OR a.phone LIKE ${`%${term.replace(/\D/g, '') || '¤'}%`} OR c.name ILIKE ${`%${term}%`} OR c.code ILIKE ${`%${term}%`})`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<(WdRow & { aName: string; aCode: string; aPhone: string; aEmail: string | null; cName: string; cCode: string; cEmail: string; cPhone: string | null; banned: boolean })[]>(Prisma.sql`
      SELECT w.*, a.name AS "aName", a.code AS "aCode", a.phone AS "aPhone", a.email AS "aEmail",
             c.name AS "cName", c.code AS "cCode", c."responsibleEmail" AS "cEmail", c."responsiblePhone" AS "cPhone",
             EXISTS (SELECT 1 FROM ${T('kwanza_bans')} b WHERE b."companyId" = w."companyId") AS banned
      FROM ${T('kwanza_withdrawals')} w
      JOIN ${T('kwanza_associates')} a ON a.id = w."associateId"
      JOIN nexus_public.companies c ON c.id = w."companyId"
      WHERE ${filter} ${search}
      ORDER BY (w.escalation = 'OPEN') DESC, w."complainedAt" DESC NULLS LAST, w."createdAt" DESC LIMIT 300`);
    const counts = await this.prisma.$queryRaw<{ open: number; notified: number; overdue: number; refunded: number; resolved: number; debt: unknown; banned: number }[]>(Prisma.sql`
      SELECT COUNT(*) FILTER (WHERE escalation = 'OPEN')::int AS open,
             COUNT(*) FILTER (WHERE escalation = 'NOTIFIED')::int AS notified,
             COUNT(*) FILTER (WHERE status = 'REQUESTED' AND escalation IS NULL AND COALESCE("dueAt", "createdAt" + interval '24 hours') < now())::int AS overdue,
             COUNT(*) FILTER (WHERE escalation = 'REFUNDED')::int AS refunded,
             COUNT(*) FILTER (WHERE escalation = 'RESOLVED')::int AS resolved,
             COALESCE(SUM(amount) FILTER (WHERE escalation = 'REFUNDED'), 0) AS debt,
             (SELECT COUNT(*)::int FROM ${T('kwanza_bans')}) AS banned
      FROM ${T('kwanza_withdrawals')}`);
    const bans = await this.prisma.$queryRaw<{ companyId: string; name: string; code: string; reason: string; createdAt: Date; debt: unknown; liftAt: Date; ready: boolean }[]>(Prisma.sql`
      SELECT b."companyId"::text AS "companyId", c.name, c.code, b.reason, b."createdAt",
             b."createdAt" + (${BAN_DAYS}::int * interval '1 day') AS "liftAt", b."createdAt" <= now() - (${BAN_DAYS}::int * interval '1 day') AS ready,
             COALESCE((SELECT SUM(amount) FROM ${T('kwanza_withdrawals')} w WHERE w."companyId" = b."companyId" AND w.escalation = 'REFUNDED'), 0) AS debt
      FROM ${T('kwanza_bans')} b JOIN nexus_public.companies c ON c.id = b."companyId" ORDER BY b."createdAt" DESC`);
    const k = counts[0];
    return {
      counts: { open: k?.open ?? 0, notified: k?.notified ?? 0, overdue: k?.overdue ?? 0, refunded: k?.refunded ?? 0, resolved: k?.resolved ?? 0, debt: num(k?.debt), banned: k?.banned ?? 0 },
      bans: bans.map((b) => ({ companyId: b.companyId, name: b.name, code: b.code, reason: b.reason, date: b.createdAt.toISOString(), debt: num(b.debt), liftAt: b.liftAt.toISOString(), canLift: b.ready })),
      rows: rows.map((w) => ({
        id: w.id, amount: num(w.amount), method: w.method, details: w.details, status: w.status, escalation: w.escalation, note: w.note,
        createdAt: iso(w.createdAt), dueAt: iso(w.dueAt ?? withdrawalDue(w.createdAt)), complainedAt: iso(w.complainedAt), complaint: w.complaint,
        notifiedAt: iso(w.notifiedAt), extendedUntil: iso(w.extendedUntil), postponedAt: iso(w.postponedAt), refundedAt: iso(w.refundedAt), refundRef: w.refundRef, adminNote: w.adminNote, decidedAt: iso(w.decidedAt),
        associate: { name: w.aName, code: w.aCode, phone: w.aPhone, email: w.aEmail },
        company: { id: w.companyId, name: w.cName, code: w.cCode, email: w.cEmail, phone: w.cPhone, banned: w.banned },
      })),
    };
  }

  private async row(id: string): Promise<WdRow> {
    const r = await this.prisma.$queryRaw<WdRow[]>(Prisma.sql`SELECT * FROM ${T('kwanza_withdrawals')} WHERE id = ${id}::uuid`);
    if (!r[0]) throw new NotFoundException('Saque não encontrado.');
    return r[0];
  }

  /** Notifica a empresa e dá-lhe mais 24 h. */
  async notify(id: string, adminId: string, note?: string) {
    const w = await this.row(id);
    if (w.status === 'REJECTED') return this.notifyRejected(w, adminId, note);
    if (w.status !== 'REQUESTED') throw new BadRequestException('A empresa já decidiu este saque.');
    if (w.escalation !== 'OPEN') throw new BadRequestException(w.escalation === 'NOTIFIED' ? 'A empresa já foi notificada.' : 'Este saque não tem reclamação aberta.');
    const until = new Date(Date.now() + 24 * H);
    const msg = String(note ?? '').trim().slice(0, 500) || null;
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_withdrawals')} SET escalation = 'NOTIFIED', "notifiedAt" = now(), "extendedUntil" = now() + interval '24 hours', "adminNote" = ${msg}
      WHERE id = ${id}::uuid AND escalation = 'OPEN' AND status = 'REQUESTED'`);
    if (!n) throw new BadRequestException('A reclamação mudou entretanto. Atualize a lista.');
    const c = await this.prisma.company.findUnique({ where: { id: w.companyId } });
    const amount = `${num(w.amount).toLocaleString('pt-PT')} Kz`;
    const limit = until.toLocaleString('pt-PT', { timeZone: 'Africa/Luanda', dateStyle: 'short', timeStyle: 'short' });
    await this.pushCompany(w.companyId, { kind: 'KWANZA_WITHDRAWAL_WARNING', title: 'Aviso da equipa LPS Kwanza: saque em atraso', body: `${amount} — tem até ${limit} para aprovar e transferir. Sem pagamento, a empresa é banida do LPS Kwanza.${msg ? ` ${msg}` : ''}`, section: 'kwanza', ref: 'withdrawals' });
    if (c?.responsibleEmail) {
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#16202c">
        <h2 style="color:#c62828;margin:0 0 10px">Saque de associado em atraso</h2>
        <p>A empresa <strong>${esc(c.name)}</strong> tem um saque de <strong>${amount}</strong> por pagar fora do prazo.</p>
        <p>Prazo final: <strong>${limit}</strong> (hora de Luanda). Aprove e transfira em <em>LPS Kwanza → Saques</em>.</p>
        <p style="background:#fff4f4;border-left:4px solid #c62828;padding:10px 14px">Sem pagamento até ao prazo, a empresa é banida do LPS Kwanza e o valor é reembolsado ao associado pela plataforma, ficando em dívida.</p>
        ${msg ? `<p>Nota da equipa: ${esc(msg)}</p>` : ''}</div>`;
      await this.mail.sendHtml(c.responsibleEmail, `Aviso: saque em atraso no LPS Kwanza (${amount})`, html).catch(() => undefined);
    }
    await this.pushAssociate(w.associateId, { kind: 'WITHDRAWAL_ESCALATED', title: 'A equipa do LPS Kwanza notificou a empresa', body: `${amount} — a empresa tem mais 24 h para pagar.`, link: '#/saques' });
    await this.audit(adminId, 'KWANZA_WITHDRAWAL_NOTIFIED', id, { until: until.toISOString() });
    return { ok: true as const, extendedUntil: until.toISOString() };
  }

  /** Recusa contestada: o Super Admin avisa a empresa para rever a decisão com o associado. */
  private async notifyRejected(w: WdRow, adminId: string, note?: string) {
    if (w.escalation !== 'OPEN') throw new BadRequestException(w.escalation === 'NOTIFIED' ? 'A empresa já foi notificada.' : 'Esta recusa não foi contestada.');
    const msg = String(note ?? '').trim().slice(0, 500) || null;
    const n = await this.prisma.$executeRaw(Prisma.sql`
      UPDATE ${T('kwanza_withdrawals')} SET escalation = 'NOTIFIED', "notifiedAt" = now(), "extendedUntil" = now() + interval '24 hours', "adminNote" = ${msg}
      WHERE id = ${w.id}::uuid AND escalation = 'OPEN' AND status = 'REJECTED'`);
    if (!n) throw new BadRequestException('A contestação mudou entretanto. Atualize a lista.');
    const amount = `${num(w.amount).toLocaleString('pt-PT')} Kz`;
    const c = await this.prisma.company.findUnique({ where: { id: w.companyId } });
    await this.pushCompany(w.companyId, { kind: 'KWANZA_WITHDRAWAL_WARNING', title: 'Aviso da equipa LPS Kwanza: recusa de saque contestada', body: `${amount} — o associado não concorda com o motivo "${(w.note ?? '').slice(0, 120)}". Reveja a decisão com o associado nas próximas 24 h.${msg ? ` ${msg}` : ''}`, section: 'kwanza', ref: 'withdrawals' });
    if (c?.responsibleEmail) {
      const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#16202c">
        <h2 style="color:#b45309;margin:0 0 10px">Recusa de saque contestada</h2>
        <p>O associado contestou a recusa do saque de <strong>${amount}</strong> na empresa <strong>${esc(c.name)}</strong>.</p>
        <p>Motivo da recusa: <em>${esc(w.note ?? '—')}</em></p><p>Contestação: <em>${esc(w.complaint ?? '—')}</em></p>
        ${msg ? `<p>Nota da equipa: ${esc(msg)}</p>` : ''}<p>Reveja a decisão em <em>LPS Kwanza → Saques</em> e fale com o associado.</p></div>`;
      await this.mail.sendHtml(c.responsibleEmail, `Aviso: recusa de saque contestada (${amount})`, html).catch(() => undefined);
    }
    await this.pushAssociate(w.associateId, { kind: 'WITHDRAWAL_ESCALATED', title: 'A equipa do LPS Kwanza avisou a empresa', body: `${amount} — a empresa vai rever a recusa do saque.`, link: '#/saques' });
    await this.audit(adminId, 'KWANZA_REJECTION_NOTIFIED', w.id, {});
    return { ok: true as const, extendedUntil: null };
  }

  /** Encerra a reclamação/contestação (decisão do Super Admin, com nota). */
  async close(id: string, adminId: string, note?: string) {
    const w = await this.row(id);
    if (w.escalation !== 'OPEN' && w.escalation !== 'NOTIFIED') throw new BadRequestException('Não há reclamação aberta neste saque.');
    if (w.status === 'REQUESTED') throw new BadRequestException('O saque ainda está por pagar: avise a empresa ou bana e reembolse.');
    const msg = String(note ?? '').trim().slice(0, 500) || null;
    await this.prisma.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_withdrawals')} SET escalation = 'RESOLVED', "adminNote" = COALESCE(${msg}, "adminNote") WHERE id = ${id}::uuid AND escalation IN ('OPEN', 'NOTIFIED')`);
    await this.pushAssociate(w.associateId, { kind: 'WITHDRAWAL_CLOSED', title: 'A equipa do LPS Kwanza encerrou a contestação', body: msg ?? `${num(w.amount).toLocaleString('pt-PT')} Kz`, link: '#/saques' });
    await this.audit(adminId, 'KWANZA_COMPLAINT_CLOSED', id, {});
    return { ok: true as const };
  }

  /** Bane a empresa do LPS Kwanza e regista o reembolso ao associado (pago pela plataforma). */
  async banAndRefund(id: string, adminId: string, refundRef: string, note?: string) {
    const w = await this.row(id);
    if (w.status !== 'REQUESTED') throw new BadRequestException('A empresa já decidiu este saque.');
    if (w.escalation !== 'NOTIFIED') throw new BadRequestException('Notifique primeiro a empresa e dê-lhe mais 24 h.');
    const inside = await this.prisma.$queryRaw<{ e: boolean }[]>(Prisma.sql`SELECT COALESCE("extendedUntil" > now(), FALSE) AS e FROM ${T('kwanza_withdrawals')} WHERE id = ${id}::uuid`);
    if (inside[0]?.e) throw new BadRequestException('A empresa ainda está dentro das 24 h extra.');
    const ref = String(refundRef ?? '').trim().slice(0, 120);
    if (ref.length < 3) throw new BadRequestException('Indique a referência da transferência do reembolso.');
    const msg = String(note ?? '').trim().slice(0, 500) || null;
    await this.prisma.$transaction(async (tx) => {
      const n = await tx.$executeRaw(Prisma.sql`
        UPDATE ${T('kwanza_withdrawals')} SET status = 'REFUNDED', escalation = 'REFUNDED', "refundedAt" = now(), "refundRef" = ${ref},
          "adminNote" = COALESCE(${msg}, "adminNote"), "decidedAt" = now(), note = 'Reembolsado pela equipa do LPS Kwanza'
        WHERE id = ${id}::uuid AND status = 'REQUESTED' AND escalation = 'NOTIFIED' AND COALESCE("extendedUntil" <= now(), TRUE)`);
      if (!n) throw new BadRequestException('O saque mudou entretanto. Atualize a lista.');
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO ${T('kwanza_bans')} ("companyId", reason, "bannedBy", "createdAt") VALUES (${w.companyId}::uuid, ${`Saque de ${num(w.amount).toLocaleString('pt-PT')} Kz não pago depois do aviso`}, ${adminId}, now())
        ON CONFLICT ("companyId") DO NOTHING`);
      await tx.$executeRaw(Prisma.sql`UPDATE ${T('kwanza_listings')} SET active = FALSE, "updatedAt" = now() WHERE "companyId" = ${w.companyId}::uuid`);
    });
    const amount = `${num(w.amount).toLocaleString('pt-PT')} Kz`;
    await this.pushCompany(w.companyId, { kind: 'KWANZA_BANNED', title: 'Empresa banida do LPS Kwanza', body: `O saque de ${amount} não foi pago depois do aviso. O valor foi reembolsado ao associado pela plataforma e fica em dívida.`, section: 'kwanza', ref: 'withdrawals' });
    await this.pushAssociate(w.associateId, { kind: 'WITHDRAWAL_REFUNDED', title: 'Reembolso feito pela equipa do LPS Kwanza', body: `${amount} — referência ${ref}.`, link: '#/saques' });
    await this.audit(adminId, 'KWANZA_COMPANY_BANNED_REFUND', id, { companyId: w.companyId, refundRef: ref });
    return { ok: true as const };
  }

  async unban(companyId: string, adminId: string) {
    const b = await this.prisma.$queryRaw<{ ready: boolean }[]>(Prisma.sql`SELECT "createdAt" <= now() - (${BAN_DAYS}::int * interval '1 day') AS ready FROM ${T('kwanza_bans')} WHERE "companyId" = ${companyId}::uuid`);
    if (!b[0]) throw new NotFoundException('A empresa não está banida.');
    if (!b[0].ready) throw new BadRequestException(`A empresa só pode ser reativada ${BAN_DAYS} dias depois do banimento.`);
    const n = await this.prisma.$executeRaw(Prisma.sql`DELETE FROM ${T('kwanza_bans')} WHERE "companyId" = ${companyId}::uuid AND "createdAt" <= now() - (${BAN_DAYS}::int * interval '1 day')`);
    if (!n) throw new NotFoundException('A empresa não está banida.');
    await this.pushCompany(companyId, { kind: 'KWANZA_UNBANNED', title: 'Empresa readmitida no LPS Kwanza', body: 'Volte a publicar os seus produtos (Atualizar no marketplace).', section: 'kwanza' });
    await this.audit(adminId, 'KWANZA_COMPANY_UNBANNED', companyId, {});
    return { ok: true as const };
  }

  /* ─────────── apoio ─────────── */
  private async pushCompany(companyId: string, n: { kind: string; title: string; body?: string; section?: string; ref?: string }) {
    const c = await this.prisma.company.findUnique({ where: { id: companyId } }).catch(() => null);
    if (c) await this.notes.push(c.schemaName, n).catch(() => undefined);
  }
  private async pushAssociate(associateId: string, n: { kind: string; title: string; body?: string; link?: string }) {
    await this.prisma.$executeRaw(Prisma.sql`
      INSERT INTO ${T('kwanza_notifications')} (id, "associateId", kind, title, body, link, "createdAt")
      VALUES (gen_random_uuid(), ${associateId}::uuid, ${n.kind}, ${n.title}, ${n.body ?? null}, ${n.link ?? null}, now())`).catch(() => undefined);
  }
  private async audit(adminId: string, action: string, entityId: string, after: Record<string, unknown>) {
    await this.auditLog.record({ actorType: 'PLATFORM', actorId: adminId, action, entity: 'KwanzaWithdrawal', entityId, after }).catch(() => undefined);
  }
}
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));

class BanksDto { @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(60, { each: true }) banks!: string[]; }
class ComplainDto { @IsOptional() @IsString() @MaxLength(600) text?: string; }
class NotifyDto { @IsOptional() @IsString() @MaxLength(500) note?: string; }
class RefundDto { @IsString() @MaxLength(120) refundRef!: string; @IsOptional() @IsString() @MaxLength(500) note?: string; }
class ListQuery { @IsOptional() @IsString() @MaxLength(80) q?: string; @IsOptional() @IsIn(['open', 'overdue', 'closed', 'all']) status?: string; }

/** Associado: reclamar de um saque fora do prazo. */
@ApiTags('kwanza')
@Public()
@Controller('kwanza/me/withdrawals')
export class KwanzaPayoutsPublicController {
  constructor(private readonly p: KwanzaPayoutsService, private readonly k: KwanzaService) {}
  @Post(':id/complain') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Reclama ao Super Admin de um saque fora do prazo' })
  async complain(@Param('id') id: string, @Body() d: ComplainDto, @Headers('authorization') a?: string) {
    const me = await this.k.verify(a);
    return this.p.complain(me.id, id, d.text);
  }
}

/** Empresa: bancos onde tem conta e estado no LPS Kwanza. */
@ApiTags('kwanza')
@Controller('ecommerce/kwanza')
export class KwanzaPayoutsAdminController {
  constructor(private readonly p: KwanzaPayoutsService, private readonly ctx: TenantContext, private readonly prisma: PrismaService) {}
  private async companyId() {
    const c = await this.prisma.company.findUnique({ where: { schemaName: this.ctx.requireTenantSchema() } });
    if (!c) throw new ForbiddenException();
    return c.id;
  }
  @Get('banks') @Roles(Role.STORE_MANAGER) @ApiOperation({ summary: 'Bancos da empresa para os saques' })
  async banks() { const id = await this.companyId(); return { banks: await this.p.banks(id), catalog: ANGOLA_BANKS, banned: await this.p.isBanned(id) }; }
  @Put('banks') @Roles(Role.COMPANY_ADMIN) @ApiOperation({ summary: 'Define os bancos da empresa' })
  async saveBanks(@Body() d: BanksDto) { return this.p.saveBanks(await this.companyId(), d.banks); }
}

/** Super Admin → Saques LPS Kwanza: reclamações, aviso + 24 h, banir e reembolsar. */
@ApiTags('super-admin')
@ApiBearerAuth()
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/kwanza')
export class KwanzaPayoutsSuperController {
  constructor(private readonly p: KwanzaPayoutsService) {}
  @Get('withdrawals') @ApiOperation({ summary: 'Reclamações de saques (procura pelo código do associado)' })
  list(@Query() q: ListQuery) { return this.p.adminList(q.q, q.status); }
  @Post('withdrawals/:id/notify') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Notifica a empresa e dá mais 24 h' })
  notify(@Param('id') id: string, @Body() d: NotifyDto, @CurrentUser() u: JwtPayload) { return this.p.notify(id, u.sub, d.note); }
  @Post('withdrawals/:id/ban-refund') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Bane a empresa e regista o reembolso ao associado' })
  banRefund(@Param('id') id: string, @Body() d: RefundDto, @CurrentUser() u: JwtPayload) { return this.p.banAndRefund(id, u.sub, d.refundRef, d.note); }
  @Post('withdrawals/:id/close') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Encerra a reclamação/contestação' })
  close(@Param('id') id: string, @Body() d: NotifyDto, @CurrentUser() u: JwtPayload) { return this.p.close(id, u.sub, d.note); }
  @Post('bans/:companyId/lift') @HttpCode(HttpStatus.OK) @ApiOperation({ summary: 'Readmite a empresa no LPS Kwanza' })
  unban(@Param('companyId') id: string, @CurrentUser() u: JwtPayload) { return this.p.unban(id, u.sub); }
}
