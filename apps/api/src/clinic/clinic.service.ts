import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType, IvaCode, round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../pos/invoice.service';

const IVA_NOR = 14;
const APPT_STATUS = ['SCHEDULED', 'DONE', 'CANCELLED', 'NO_SHOW'];

/**
 * Clínica / Saúde (vertical CLINIC): pacientes, marcações (agenda) e consultas.
 * Reutiliza a base partilhada — clientes (faturação), caixa, contabilidade.
 */
@Injectable()
export class ClinicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoices: InvoiceService,
  ) {}

  // ── Pacientes ──────────────────────────────────────────────
  listPatients(schema: string, search?: string) {
    const s = (search ?? '').trim();
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(s
        ? Prisma.sql`SELECT id, name, phone, nif, birth_date, sex, blood_type, allergies, notes, customer_id
                     FROM clinic_patients WHERE is_active = TRUE AND (name ILIKE ${'%' + s + '%'} OR phone ILIKE ${'%' + s + '%'})
                     ORDER BY name LIMIT 200`
        : Prisma.sql`SELECT id, name, phone, nif, birth_date, sex, blood_type, allergies, notes, customer_id
                     FROM clinic_patients WHERE is_active = TRUE ORDER BY name LIMIT 200`));
  }

  async createPatient(schema: string, dto: { name: string; phone?: string; nif?: string; birthDate?: string; sex?: string; bloodType?: string; allergies?: string; notes?: string }) {
    if (!dto.name?.trim()) throw new BadRequestException('Indique o nome do paciente.');
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_patients (name, phone, nif, birth_date, sex, blood_type, allergies, notes)
        VALUES (${dto.name.trim()}, ${dto.phone?.trim() || null}, ${dto.nif?.trim() || null},
                ${dto.birthDate ? Prisma.sql`${dto.birthDate}::date` : Prisma.sql`NULL`}, ${dto.sex || null},
                ${dto.bloodType?.trim() || null}, ${dto.allergies?.trim() || null}, ${dto.notes?.trim() || null})
        RETURNING id`));
  }

  async getPatient(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const p = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM clinic_patients WHERE id = ${id}::uuid`);
      if (!p[0]) throw new NotFoundException('Paciente não encontrado.');
      const consults = await tx.$queryRaw(Prisma.sql`SELECT id, professional, symptoms, diagnosis, prescription, fee, invoice_id, created_at
        FROM clinic_consultations WHERE patient_id = ${id}::uuid ORDER BY created_at DESC LIMIT 100`);
      return { patient: p[0], consultations: consults };
    });
  }

  async updatePatient(schema: string, id: string, dto: { phone?: string; allergies?: string; notes?: string; bloodType?: string }) {
    const sets: Prisma.Sql[] = [];
    if (dto.phone !== undefined) sets.push(Prisma.sql`phone = ${dto.phone}`);
    if (dto.allergies !== undefined) sets.push(Prisma.sql`allergies = ${dto.allergies}`);
    if (dto.notes !== undefined) sets.push(Prisma.sql`notes = ${dto.notes}`);
    if (dto.bloodType !== undefined) sets.push(Prisma.sql`blood_type = ${dto.bloodType}`);
    if (!sets.length) return { ok: true };
    sets.push(Prisma.sql`updated_at = now()`);
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE clinic_patients SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  // ── Marcações (agenda) ─────────────────────────────────────
  /** Agenda por dia (ou próximas, se sem data). */
  listAppointments(schema: string, day?: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(day && /^\d{4}-\d{2}-\d{2}$/.test(day)
        ? Prisma.sql`SELECT id, patient_id, patient_name, professional, scheduled_at, reason, status
                     FROM clinic_appointments WHERE scheduled_at::date = ${day}::date ORDER BY scheduled_at`
        : Prisma.sql`SELECT id, patient_id, patient_name, professional, scheduled_at, reason, status
                     FROM clinic_appointments WHERE scheduled_at >= now() - interval '1 day'
                     ORDER BY scheduled_at LIMIT 200`));
  }

  async createAppointment(schema: string, dto: { patientId?: string; patientName?: string; professional?: string; scheduledAt: string; reason?: string }) {
    if (!dto.scheduledAt) throw new BadRequestException('Indique a data/hora.');
    return this.prisma.runInTenant(schema, async (tx) => {
      let patientName = dto.patientName?.trim() || null;
      if (dto.patientId && !patientName) {
        const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${dto.patientId}::uuid`);
        patientName = p[0]?.name ?? null;
      }
      return tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_appointments (patient_id, patient_name, professional, scheduled_at, reason)
        VALUES (${dto.patientId ?? null}::uuid, ${patientName}, ${dto.professional?.trim() || null}, ${dto.scheduledAt}::timestamptz, ${dto.reason?.trim() || null})
        RETURNING id`);
    });
  }

  async setAppointmentStatus(schema: string, id: string, status: string) {
    if (!APPT_STATUS.includes(status)) throw new BadRequestException('Estado inválido.');
    await this.prisma.runInTenant(schema, (tx) =>
      tx.$executeRaw(Prisma.sql`UPDATE clinic_appointments SET status = ${status}, updated_at = now() WHERE id = ${id}::uuid`));
    return { ok: true };
  }

  // ── Consultas ──────────────────────────────────────────────
  async createConsultation(schema: string, by: { id: string | null }, dto: { appointmentId?: string; patientId?: string; patientName?: string; professional?: string; symptoms?: string; diagnosis?: string; prescription?: string; notes?: string; fee?: number }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      let patientId = dto.patientId ?? null;
      let patientName = dto.patientName?.trim() || null;
      if (dto.appointmentId) {
        const a = await tx.$queryRaw<{ patient_id: string | null; patient_name: string | null; professional: string | null }[]>(
          Prisma.sql`SELECT patient_id, patient_name, professional FROM clinic_appointments WHERE id = ${dto.appointmentId}::uuid`);
        if (a[0]) { patientId = patientId || a[0].patient_id; patientName = patientName || a[0].patient_name; }
        // marca a marcação como realizada
        await tx.$executeRaw(Prisma.sql`UPDATE clinic_appointments SET status = 'DONE', updated_at = now() WHERE id = ${dto.appointmentId}::uuid`);
      }
      if (patientId && !patientName) {
        const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${patientId}::uuid`);
        patientName = p[0]?.name ?? null;
      }
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_consultations (appointment_id, patient_id, patient_name, professional, symptoms, diagnosis, prescription, notes, fee, created_by)
        VALUES (${dto.appointmentId ?? null}::uuid, ${patientId}::uuid, ${patientName}, ${dto.professional?.trim() || null},
                ${dto.symptoms?.trim() || null}, ${dto.diagnosis?.trim() || null}, ${dto.prescription?.trim() || null},
                ${dto.notes?.trim() || null}, ${dto.fee ?? 0}, ${by.id}::uuid)
        RETURNING id`);
      return rows[0];
    });
  }

  /** Fatura a consulta (documento fiscal AGT) — taxa da consulta como linha de serviço. */
  async invoiceConsultation(schema: string, id: string, opener: { id: string | null; name: string }) {
    const c = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ id: string; fee: string; invoice_id: string | null; patient_name: string | null; professional: string | null }[]>(
        Prisma.sql`SELECT id, fee, invoice_id, patient_name, professional FROM clinic_consultations WHERE id = ${id}::uuid`));
    if (!c[0]) throw new NotFoundException('Consulta não encontrada.');
    if (c[0].invoice_id) throw new BadRequestException('Consulta já faturada.');
    const fee = Number(c[0].fee);
    if (!(fee > 0)) throw new BadRequestException('Defina o valor da consulta antes de faturar.');
    const net = round2(fee / (1 + IVA_NOR / 100)); // a taxa guardada inclui IVA
    const inv = await this.invoices.emit(schema, {
      docType: DocumentType.FT, series: 'A',
      cashierId: opener.id, cashierName: opener.name, paymentType: 'CASH',
      lines: [{ description: `Consulta médica${c[0].professional ? ` — ${c[0].professional}` : ''}`, unitPrice: net, ivaCode: IvaCode.NOR, quantity: 1 }],
    });
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE clinic_consultations SET invoice_id = ${inv.id}::uuid WHERE id = ${id}::uuid`));
    return { invoiceId: inv.id, invoiceNumber: inv.number };
  }

  /** KPIs do dia para o dashboard da clínica. */
  async metrics(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const today = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM clinic_appointments WHERE scheduled_at::date = CURRENT_DATE AND status = 'SCHEDULED'`);
      const done = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM clinic_consultations WHERE created_at::date = CURRENT_DATE`);
      const patients = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT COUNT(*)::int AS n FROM clinic_patients WHERE is_active = TRUE`);
      const rev = await tx.$queryRaw<{ s: number }[]>(Prisma.sql`SELECT COALESCE(SUM(fee),0)::float8 AS s FROM clinic_consultations WHERE invoice_id IS NOT NULL AND created_at >= now() - interval '30 days'`);
      return { todayAppointments: today[0]?.n ?? 0, todayConsultations: done[0]?.n ?? 0, patients: patients[0]?.n ?? 0, revenue30: rev[0]?.s ?? 0 };
    });
  }

  /**
   * CENTRO DE COMANDO da clínica (mesma engenharia do restaurante/hotel):
   * agenda de HOJE (com pacientes/profissional/hora e estado), fila de espera,
   * KPIs do dia, pacientes, e vendas faturadas por canal. Só LEITURA.
   */
  async getDashboard(schema: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      // ── Hoje: contagens por estado + próximas ────────────────
      const counts = await tx.$queryRaw<{ scheduled: number; done_appt: number; no_show: number; cancelled: number; overdue: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE status = 'SCHEDULED')::int AS scheduled,
               COUNT(*) FILTER (WHERE status = 'DONE')::int AS done_appt,
               COUNT(*) FILTER (WHERE status = 'NO_SHOW')::int AS no_show,
               COUNT(*) FILTER (WHERE status = 'CANCELLED')::int AS cancelled,
               COUNT(*) FILTER (WHERE status = 'SCHEDULED' AND scheduled_at < now())::int AS overdue
        FROM clinic_appointments WHERE scheduled_at::date = CURRENT_DATE`);
      const consultsToday = await tx.$queryRaw<{ n: number; fee: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n, COALESCE(SUM(fee),0)::float8 AS fee
        FROM clinic_consultations WHERE created_at::date = CURRENT_DATE`);

      // Agenda do dia (SCHEDULED), ordenada por hora, com o essencial p/ a receção.
      const agenda = await tx.$queryRaw<{ id: string; scheduled_at: Date; patient_name: string | null; professional: string | null; reason: string | null; status: string; overdue: boolean }[]>(Prisma.sql`
        SELECT id, scheduled_at, patient_name, professional, reason, status,
               (scheduled_at < now()) AS overdue
        FROM clinic_appointments
        WHERE scheduled_at::date = CURRENT_DATE AND status = 'SCHEDULED'
        ORDER BY scheduled_at`);

      // ── Pacientes ────────────────────────────────────────────
      const patients = await tx.$queryRaw<{ active: number; new_today: number }[]>(Prisma.sql`
        SELECT COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active,
               COUNT(*) FILTER (WHERE created_at::date = CURRENT_DATE)::int AS new_today
        FROM clinic_patients`);

      // ── Vendas faturadas de HOJE por canal (mesma fonte fiscal) ──
      const regWeb = await tx.$queryRaw<{ r: string | null }[]>(Prisma.sql`SELECT to_regclass('web_orders')::text AS r`);
      const onlineExpr = regWeb[0]?.r
        ? Prisma.sql`COALESCE(SUM(gross_total) FILTER (WHERE id IN (SELECT invoice_id FROM web_orders WHERE invoice_id IS NOT NULL)), 0)::float8`
        : Prisma.sql`0::float8`;
      const sales = await tx.$queryRaw<{ total: number; online: number; invoices: number }[]>(Prisma.sql`
        SELECT COALESCE(SUM(gross_total), 0)::float8 AS total, ${onlineExpr} AS online, COUNT(*)::int AS invoices
        FROM invoices WHERE invoice_date = CURRENT_DATE AND status = 'N' AND doc_type IN ('FT','FS')`);

      const c = counts[0] ?? { scheduled: 0, done_appt: 0, no_show: 0, cancelled: 0, overdue: 0 };
      const ct = consultsToday[0] ?? { n: 0, fee: 0 };
      const p = patients[0] ?? { active: 0, new_today: 0 };
      const sl = sales[0] ?? { total: 0, online: 0, invoices: 0 };
      const online = Math.round(sl.online);
      return {
        today: {
          scheduled: c.scheduled, done: ct.n, noShow: c.no_show, cancelled: c.cancelled, overdue: c.overdue,
          agenda: agenda.map((a) => ({
            id: a.id,
            time: a.scheduled_at.toISOString().slice(11, 16),
            patient: a.patient_name ?? '—',
            professional: a.professional ?? '—',
            reason: a.reason ?? '',
            overdue: a.overdue,
          })),
        },
        patients: { active: p.active, newToday: p.new_today },
        sales: { total: Math.round(sl.total), online, counter: Math.max(0, Math.round(sl.total) - online), invoices: sl.invoices },
      };
    });
  }
}
