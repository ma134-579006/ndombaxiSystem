import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DocumentType, IvaCode, round2 } from '@nexus/agt-xml';
import { PrismaService } from '../prisma/prisma.service';
import { InvoiceService } from '../pos/invoice.service';
import { StockService } from '../erp/stock.service';
import { TenantAuditService } from '../cashbox/tenant-audit.service';
import { allocateDocumentNumber, formatCounterNumber } from '../common/document-counter';

const IVA_NOR = 14; // taxa normal — os preços de atos clínicos são guardados COM IVA incluído

const PROF_CATEGORIES = ['MEDICO', 'ENFERMEIRO', 'TECNICO', 'RECECAO', 'LABORATORIO', 'FARMACIA', 'ADMIN', 'OUTRO'];
const TRIAGE_RISKS = ['RED', 'ORANGE', 'YELLOW', 'GREEN', 'BLUE'];
const TRIAGE_STATUS = ['WAITING', 'IN_CARE', 'OBSERVATION', 'DISCHARGED', 'ADMITTED', 'DECEASED'];
const BED_WARDS = ['ENFERMARIA', 'UTI', 'ISOLAMENTO', 'QUARTO'];
const BED_STATUS = ['FREE', 'OCCUPIED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'];
const EXAM_STATUS = ['REQUESTED', 'COLLECTED', 'IN_LAB', 'DONE', 'DELIVERED'];

/**
 * HOSPITAL (HIS) — domínio clínico enterprise por cima do núcleo do tenant.
 * Mesma engenharia do restaurante: entidades próprias do setor, e a FARMÁCIA
 * liga-se ao stock sagrado apenas pelo livro de movimentos (a dispensa da
 * receita baixa os medicamentos por lote FEFO, como as fichas técnicas baixam
 * ingredientes). Nada do módulo comercial é alterado. Prontuário = derivado,
 * append-only, auditado.
 */
@Injectable()
export class HospitalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: TenantAuditService,
    private readonly invoices: InvoiceService,
  ) {}

  // ── Profissionais de saúde ─────────────────────────────────
  listProfessionals(schema: string, category?: string) {
    const cond = category && PROF_CATEGORIES.includes(category)
      ? Prisma.sql` AND category = ${category}` : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT * FROM clinic_professionals WHERE is_active = TRUE${cond} ORDER BY category, name`));
  }

  async createProfessional(schema: string, dto: {
    name: string; category?: string; licenseNumber?: string; specialty?: string;
    subspecialty?: string; office?: string; schedule?: string; onCall?: boolean;
  }) {
    if (!dto.name?.trim()) throw new BadRequestException('Indique o nome do profissional.');
    const cat = PROF_CATEGORIES.includes(dto.category ?? '') ? dto.category : 'MEDICO';
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_professionals (name, category, license_number, specialty, subspecialty, office, schedule, on_call)
        VALUES (${dto.name.trim()}, ${cat}, ${dto.licenseNumber?.trim() || null}, ${dto.specialty?.trim() || null},
                ${dto.subspecialty?.trim() || null}, ${dto.office?.trim() || null}, ${dto.schedule?.trim() || null}, ${!!dto.onCall})
        RETURNING id`);
      return rows[0];
    });
  }

  async updateProfessional(schema: string, id: string, dto: {
    specialty?: string; office?: string; schedule?: string; onCall?: boolean; isActive?: boolean;
  }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_professionals SET
          specialty = COALESCE(${dto.specialty ?? null}, specialty),
          office = COALESCE(${dto.office ?? null}, office),
          schedule = COALESCE(${dto.schedule ?? null}, schedule),
          on_call = COALESCE(${dto.onCall ?? null}, on_call),
          is_active = COALESCE(${dto.isActive ?? null}, is_active),
          updated_at = now()
        WHERE id = ${id}::uuid`);
      return { ok: true as const };
    });
  }

  // ── Receitas médicas ───────────────────────────────────────
  async createPrescription(schema: string, by: { id: string | null }, dto: {
    patientId?: string; patientName?: string; consultationId?: string;
    professionalId?: string; professional?: string; notes?: string;
    items: Array<{ productId?: string; medication: string; dosage?: string; posology?: string; route?: string; duration?: string; quantity?: number; notes?: string }>;
  }) {
    if (!dto.items?.length) throw new BadRequestException('A receita precisa de pelo menos 1 medicamento.');
    return this.prisma.runInTenant(schema, async (tx) => {
      let patientName = dto.patientName?.trim() || null;
      if (dto.patientId) {
        const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${dto.patientId}::uuid`);
        if (!p[0]) throw new NotFoundException('Paciente não encontrado.');
        patientName = p[0].name;
      }
      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'RX', year);
      const number = formatCounterNumber('RX', year, seq);
      const rx = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_prescriptions (number, consultation_id, patient_id, patient_name, professional_id, professional, notes, created_by)
        VALUES (${number}, ${dto.consultationId || null}::uuid, ${dto.patientId || null}::uuid, ${patientName},
                ${dto.professionalId || null}::uuid, ${dto.professional?.trim() || null}, ${dto.notes?.trim() || null}, ${by.id}::uuid)
        RETURNING id`);
      for (const it of dto.items) {
        if (!it.medication?.trim()) continue;
        const qty = Number(it.quantity) > 0 ? Number(it.quantity) : 1;
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO clinic_prescription_items (prescription_id, product_id, medication, dosage, posology, route, duration, quantity, notes)
          VALUES (${rx[0].id}::uuid, ${it.productId || null}::uuid, ${it.medication.trim()}, ${it.dosage?.trim() || null},
                  ${it.posology?.trim() || null}, ${it.route?.trim() || null}, ${it.duration?.trim() || null}, ${qty}, ${it.notes?.trim() || null})`);
      }
      return { id: rx[0].id, number };
    });
  }

  listPrescriptions(schema: string, status?: string, patientId?: string) {
    const condS = status ? Prisma.sql` AND p.status = ${status}` : Prisma.empty;
    const condP = patientId ? Prisma.sql` AND p.patient_id = ${patientId}::uuid` : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT p.*, (SELECT COUNT(*)::int FROM clinic_prescription_items i WHERE i.prescription_id = p.id) AS item_count
        FROM clinic_prescriptions p WHERE TRUE${condS}${condP}
        ORDER BY p.issued_at DESC LIMIT 200`));
  }

  getPrescription(schema: string, id: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rx = await tx.$queryRaw<Record<string, unknown>[]>(Prisma.sql`SELECT * FROM clinic_prescriptions WHERE id = ${id}::uuid`);
      if (!rx[0]) throw new NotFoundException('Receita não encontrada.');
      const items = await tx.$queryRaw(Prisma.sql`
        SELECT i.*, pr.code AS product_code, pr.stock_qty AS product_stock
        FROM clinic_prescription_items i LEFT JOIN products pr ON pr.id = i.product_id
        WHERE i.prescription_id = ${id}::uuid ORDER BY i.medication`);
      return { prescription: rx[0], items };
    });
  }

  /**
   * DISPENSA da receita na farmácia — a engenharia do restaurante:
   * 1) valida TUDO antes de tocar no stock (nunca fica meio-dispensada);
   * 2) baixa cada medicamento pelo livro de movimentos (OUT, nunca negativo);
   * 3) consome os LOTES por validade (FEFO) — rastreabilidade da farmácia;
   * 4) auditoria: quem dispensou, o quê, quanto, de que lote.
   */
  async dispensePrescription(schema: string, id: string, actor: { id: string | null; name: string | null }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rx = await tx.$queryRaw<{ id: string; number: string; status: string; patient_name: string | null }[]>(
        Prisma.sql`SELECT id, number, status, patient_name FROM clinic_prescriptions WHERE id = ${id}::uuid FOR UPDATE`);
      if (!rx[0]) throw new NotFoundException('Receita não encontrada.');
      if (rx[0].status !== 'ISSUED') throw new BadRequestException('Esta receita já foi dispensada ou está cancelada.');

      const items = await tx.$queryRaw<{ id: string; product_id: string | null; medication: string; quantity: string; name: string | null; stock_qty: string | null }[]>(
        Prisma.sql`SELECT i.id, i.product_id, i.medication, i.quantity, p.name, p.stock_qty
                   FROM clinic_prescription_items i LEFT JOIN products p ON p.id = i.product_id
                   WHERE i.prescription_id = ${id}::uuid`);
      if (!items.length) throw new BadRequestException('A receita não tem medicamentos.');

      // 1) Validação total ANTES de consumir (como a fornada): stock suficiente.
      for (const it of items) {
        if (!it.product_id) continue; // medicamento externo (sem stock na farmácia)
        const need = Number(it.quantity);
        const have = Number(it.stock_qty ?? 0);
        if (have < need) {
          throw new BadRequestException(
            `Stock insuficiente na farmácia: ${it.name ?? it.medication} (disponível ${have}, receita pede ${need}).`);
        }
      }

      // 2+3) Consome pelo livro de movimentos + lotes FEFO.
      const wh = await StockService.resolveDefaultWarehouse(tx);
      const dispensedDetail: Array<{ medication: string; qty: number; batches: Array<{ code: string | null; qty: number }> }> = [];
      for (const it of items) {
        const need = Number(it.quantity);
        if (it.product_id) {
          if (wh) {
            await StockService.applyMovement(tx, {
              productId: it.product_id, warehouseId: wh, type: 'OUT', quantity: -need,
              reference: `Dispensa ${rx[0].number}`, createdBy: actor.id ?? null, allowNegative: false,
            });
          } else {
            await tx.$executeRaw(Prisma.sql`UPDATE products SET stock_qty = stock_qty - ${need} WHERE id = ${it.product_id}::uuid`);
          }
          // FEFO: abate dos lotes por validade mais próxima (rastreabilidade).
          let remaining = need;
          const batchTrace: Array<{ code: string | null; qty: number }> = [];
          const batches = await tx.$queryRaw<{ id: string; batch_code: string | null; quantity: string }[]>(
            Prisma.sql`SELECT id, batch_code, quantity FROM product_batches
                       WHERE product_id = ${it.product_id}::uuid AND quantity > 0
                       ORDER BY expiry_date NULLS LAST, created_at`);
          for (const b of batches) {
            if (remaining <= 0) break;
            const take = Math.min(remaining, Number(b.quantity));
            await tx.$executeRaw(Prisma.sql`UPDATE product_batches SET quantity = quantity - ${take} WHERE id = ${b.id}::uuid`);
            batchTrace.push({ code: b.batch_code, qty: take });
            remaining -= take;
          }
          dispensedDetail.push({ medication: it.medication, qty: need, batches: batchTrace });
        }
        await tx.$executeRaw(Prisma.sql`UPDATE clinic_prescription_items SET dispensed_qty = ${need} WHERE id = ${it.id}::uuid`);
      }

      await tx.$executeRaw(Prisma.sql`UPDATE clinic_prescriptions
        SET status = 'DISPENSED', dispensed_at = now(), dispensed_by = ${actor.id}::uuid WHERE id = ${id}::uuid`);

      // 4) Auditoria clínica: nada se dispensa sem rasto.
      await this.audit.recordInTx(tx, {
        actorId: actor.id ?? null, actorName: actor.name ?? null,
        action: 'PRESCRIPTION_DISPENSED', entity: 'clinic_prescription', entityId: id,
        details: { number: rx[0].number, patient: rx[0].patient_name, items: dispensedDetail },
      });
      return { ok: true as const, number: rx[0].number };
    });
  }

  async cancelPrescription(schema: string, id: string, actor: { id: string | null; name: string | null }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rx = await tx.$queryRaw<{ status: string; number: string }[]>(
        Prisma.sql`SELECT status, number FROM clinic_prescriptions WHERE id = ${id}::uuid`);
      if (!rx[0]) throw new NotFoundException('Receita não encontrada.');
      if (rx[0].status === 'DISPENSED') throw new BadRequestException('Receita já dispensada — não pode ser cancelada.');
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_prescriptions SET status = 'CANCELLED' WHERE id = ${id}::uuid`);
      await this.audit.recordInTx(tx, {
        actorId: actor.id ?? null, actorName: actor.name ?? null,
        action: 'PRESCRIPTION_CANCELLED', entity: 'clinic_prescription', entityId: id,
        details: { number: rx[0].number },
      });
      return { ok: true as const };
    });
  }

  // ── Sinais vitais ──────────────────────────────────────────
  async addVitals(schema: string, by: { id: string | null }, dto: {
    patientId: string; consultationId?: string; temperatureC?: number; systolic?: number; diastolic?: number;
    heartRate?: number; respRate?: number; spo2?: number; weightKg?: number; heightCm?: number; notes?: string;
  }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_vitals (patient_id, consultation_id, temperature_c, systolic, diastolic, heart_rate, resp_rate, spo2, weight_kg, height_cm, notes, recorded_by)
        VALUES (${dto.patientId}::uuid, ${dto.consultationId || null}::uuid, ${dto.temperatureC ?? null}, ${dto.systolic ?? null},
                ${dto.diastolic ?? null}, ${dto.heartRate ?? null}, ${dto.respRate ?? null}, ${dto.spo2 ?? null},
                ${dto.weightKg ?? null}, ${dto.heightCm ?? null}, ${dto.notes?.trim() || null}, ${by.id}::uuid)
        RETURNING id`);
      return rows[0];
    });
  }

  // ── Prontuário eletrónico (EHR) — linha do tempo derivada, nunca se apaga ──
  async patientRecord(schema: string, patientId: string) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const patient = await tx.$queryRaw<Record<string, unknown>[]>(
        Prisma.sql`SELECT * FROM clinic_patients WHERE id = ${patientId}::uuid`);
      if (!patient[0]) throw new NotFoundException('Paciente não encontrado.');
      const consultations = await tx.$queryRaw(Prisma.sql`
        SELECT id, professional, symptoms, diagnosis, prescription, notes, fee, invoice_id, created_at
        FROM clinic_consultations WHERE patient_id = ${patientId}::uuid ORDER BY created_at DESC LIMIT 100`);
      const prescriptions = await tx.$queryRaw(Prisma.sql`
        SELECT id, number, professional, status, issued_at, dispensed_at,
               (SELECT COUNT(*)::int FROM clinic_prescription_items i WHERE i.prescription_id = p.id) AS item_count
        FROM clinic_prescriptions p WHERE patient_id = ${patientId}::uuid ORDER BY issued_at DESC LIMIT 100`);
      const vitals = await tx.$queryRaw(Prisma.sql`
        SELECT * FROM clinic_vitals WHERE patient_id = ${patientId}::uuid ORDER BY recorded_at DESC LIMIT 50`);
      const admissions = await tx.$queryRaw(Prisma.sql`
        SELECT id, number, bed_label, professional, reason, status, admitted_at, discharged_at, total
        FROM clinic_admissions WHERE patient_id = ${patientId}::uuid ORDER BY admitted_at DESC LIMIT 50`);
      const exams = await tx.$queryRaw(Prisma.sql`
        SELECT id, exam_type, requested_by, status, result_text, requested_at, done_at
        FROM clinic_exams WHERE patient_id = ${patientId}::uuid ORDER BY requested_at DESC LIMIT 100`);
      return { patient: patient[0], consultations, prescriptions, vitals, admissions, exams };
    });
  }

  // ── Leitos / internação ────────────────────────────────────
  listBeds(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT b.*, a.id AS admission_id, a.patient_name AS admitted_patient, a.admitted_at
        FROM clinic_beds b
        LEFT JOIN LATERAL (
          SELECT id, patient_name, admitted_at FROM clinic_admissions
          WHERE bed_id = b.id AND status = 'ADMITTED' ORDER BY admitted_at DESC LIMIT 1
        ) a ON TRUE
        WHERE b.is_active = TRUE ORDER BY b.ward, b.sort_order, b.code`));
  }

  async createBed(schema: string, dto: { code: string; ward?: string; room?: string; dailyRate?: number }) {
    if (!dto.code?.trim()) throw new BadRequestException('Indique o código do leito (ex.: ENF-01).');
    const ward = BED_WARDS.includes(dto.ward ?? '') ? dto.ward : 'ENFERMARIA';
    return this.prisma.runInTenant(schema, async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_beds (code, ward, room, daily_rate)
        VALUES (${dto.code.trim()}, ${ward}, ${dto.room?.trim() || null}, ${Number(dto.dailyRate) || 0})
        RETURNING id`);
      return rows[0];
    });
  }

  async setBedStatus(schema: string, id: string, status: string) {
    if (!BED_STATUS.includes(status)) throw new BadRequestException('Estado de leito inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      if (status !== 'OCCUPIED') {
        const busy = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
          SELECT COUNT(*)::int AS n FROM clinic_admissions WHERE bed_id = ${id}::uuid AND status = 'ADMITTED'`);
        if ((busy[0]?.n ?? 0) > 0) throw new BadRequestException('O leito tem um paciente internado — dê alta/transfira primeiro.');
      }
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_beds SET status = ${status} WHERE id = ${id}::uuid`);
      return { ok: true as const };
    });
  }

  async admitPatient(schema: string, by: { id: string | null; name: string | null }, dto: {
    patientId: string; bedId: string; professional?: string; reason?: string; notes?: string;
  }) {
    return this.prisma.runInTenant(schema, async (tx) => {
      const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${dto.patientId}::uuid`);
      if (!p[0]) throw new NotFoundException('Paciente não encontrado.');
      const bed = await tx.$queryRaw<{ code: string; ward: string; status: string; daily_rate: string }[]>(
        Prisma.sql`SELECT code, ward, status, daily_rate FROM clinic_beds WHERE id = ${dto.bedId}::uuid AND is_active = TRUE FOR UPDATE`);
      if (!bed[0]) throw new NotFoundException('Leito não encontrado.');
      if (bed[0].status !== 'FREE') throw new BadRequestException(`O leito ${bed[0].code} não está livre (${bed[0].status}).`);
      const already = await tx.$queryRaw<{ n: number }[]>(Prisma.sql`
        SELECT COUNT(*)::int AS n FROM clinic_admissions WHERE patient_id = ${dto.patientId}::uuid AND status = 'ADMITTED'`);
      if ((already[0]?.n ?? 0) > 0) throw new BadRequestException('Este paciente já está internado.');

      const year = new Date().getFullYear();
      const seq = await allocateDocumentNumber(tx, 'INT', year);
      const number = formatCounterNumber('INT', year, seq);
      const bedLabel = `${bed[0].ward} ${bed[0].code}`;
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_admissions (number, patient_id, patient_name, bed_id, bed_label, professional, reason, daily_rate, total, notes, created_by)
        VALUES (${number}, ${dto.patientId}::uuid, ${p[0].name}, ${dto.bedId}::uuid, ${bedLabel},
                ${dto.professional?.trim() || null}, ${dto.reason?.trim() || null}, ${Number(bed[0].daily_rate)}, ${Number(bed[0].daily_rate)},
                ${dto.notes?.trim() || null}, ${by.id}::uuid)
        RETURNING id`);
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_beds SET status = 'OCCUPIED' WHERE id = ${dto.bedId}::uuid`);
      await this.audit.recordInTx(tx, {
        actorId: by.id ?? null, actorName: by.name ?? null,
        action: 'PATIENT_ADMITTED', entity: 'clinic_admission', entityId: rows[0].id,
        details: { number, patient: p[0].name, bed: bedLabel },
      });
      return { id: rows[0].id, number };
    });
  }

  /** Alta/óbito/transferência: fecha a internação, calcula diárias e liberta o leito (→ limpeza). */
  async dischargePatient(schema: string, id: string, by: { id: string | null; name: string | null }, outcome = 'DISCHARGED') {
    const status = ['DISCHARGED', 'DECEASED'].includes(outcome) ? outcome : 'DISCHARGED';
    return this.prisma.runInTenant(schema, async (tx) => {
      const adm = await tx.$queryRaw<{ id: string; number: string; bed_id: string | null; status: string; daily_rate: string; admitted_at: Date; patient_name: string | null }[]>(
        Prisma.sql`SELECT id, number, bed_id, status, daily_rate, admitted_at, patient_name
                   FROM clinic_admissions WHERE id = ${id}::uuid FOR UPDATE`);
      if (!adm[0]) throw new NotFoundException('Internação não encontrada.');
      if (adm[0].status !== 'ADMITTED') throw new BadRequestException('Esta internação já foi fechada.');
      // Diárias: nº de dias (mínimo 1) × diária congelada.
      const days = Math.max(1, Math.ceil((Date.now() - new Date(adm[0].admitted_at).getTime()) / 86400000));
      const total = days * Number(adm[0].daily_rate);
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_admissions
        SET status = ${status}, discharged_at = now(), total = ${total} WHERE id = ${id}::uuid`);
      if (adm[0].bed_id) {
        await tx.$executeRaw(Prisma.sql`UPDATE clinic_beds SET status = 'CLEANING' WHERE id = ${adm[0].bed_id}::uuid`);
      }
      await this.audit.recordInTx(tx, {
        actorId: by.id ?? null, actorName: by.name ?? null,
        action: status === 'DECEASED' ? 'PATIENT_DECEASED' : 'PATIENT_DISCHARGED',
        entity: 'clinic_admission', entityId: id,
        details: { number: adm[0].number, patient: adm[0].patient_name, days, total },
      });
      return { ok: true as const, days, total };
    });
  }

  listAdmissions(schema: string, status?: string) {
    const cond = status ? Prisma.sql` AND status = ${status}` : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT * FROM clinic_admissions WHERE TRUE${cond} ORDER BY admitted_at DESC LIMIT 200`));
  }

  /**
   * Fatura a internação (documento fiscal AGT). Só depois da alta — o total só
   * está fechado quando as diárias foram calculadas. Reutiliza o MESMO motor
   * fiscal das consultas (InvoiceService.emit): FT série A, o total inclui IVA.
   */
  async invoiceAdmission(schema: string, id: string, opener: { id: string | null; name: string }) {
    const adm = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ number: string; status: string; total: string; invoice_id: string | null; patient_name: string | null; bed_label: string | null }[]>(
        Prisma.sql`SELECT number, status, total, invoice_id, patient_name, bed_label FROM clinic_admissions WHERE id = ${id}::uuid`));
    if (!adm[0]) throw new NotFoundException('Internação não encontrada.');
    if (adm[0].status === 'ADMITTED') throw new BadRequestException('Dê alta ao paciente antes de faturar (as diárias ainda não estão fechadas).');
    if (adm[0].invoice_id) throw new BadRequestException('Internação já faturada.');
    const total = Number(adm[0].total);
    if (!(total > 0)) throw new BadRequestException('A internação não tem valor a faturar.');
    const net = round2(total / (1 + IVA_NOR / 100));
    const inv = await this.invoices.emit(schema, {
      docType: DocumentType.FT, series: 'A',
      cashierId: opener.id, cashierName: opener.name, paymentType: 'CASH',
      lines: [{ description: `Internação ${adm[0].number}${adm[0].bed_label ? ` — ${adm[0].bed_label}` : ''}`, unitPrice: net, ivaCode: IvaCode.NOR, quantity: 1 }],
    });
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE clinic_admissions SET invoice_id = ${inv.id}::uuid WHERE id = ${id}::uuid`));
    return { invoiceId: inv.id, invoiceNumber: inv.number };
  }

  // ── Emergência / triagem ───────────────────────────────────
  async registerTriage(schema: string, by: { id: string | null }, dto: {
    patientId?: string; patientName?: string; complaint?: string; risk?: string; room?: string; professional?: string;
  }) {
    let name = dto.patientName?.trim();
    const risk = TRIAGE_RISKS.includes(dto.risk ?? '') ? dto.risk : 'GREEN';
    return this.prisma.runInTenant(schema, async (tx) => {
      if (dto.patientId) {
        const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${dto.patientId}::uuid`);
        if (p[0]) name = p[0].name;
      }
      if (!name) throw new BadRequestException('Indique o paciente (nome ou ficha).');
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_triage (patient_id, patient_name, complaint, risk, room, professional, created_by)
        VALUES (${dto.patientId || null}::uuid, ${name}, ${dto.complaint?.trim() || null}, ${risk},
                ${dto.room?.trim() || null}, ${dto.professional?.trim() || null}, ${by.id}::uuid)
        RETURNING id`);
      return rows[0];
    });
  }

  async setTriageStatus(schema: string, id: string, status: string) {
    if (!TRIAGE_STATUS.includes(status)) throw new BadRequestException('Estado de triagem inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const extra = status === 'IN_CARE'
        ? Prisma.sql`, attended_at = COALESCE(attended_at, now())`
        : ['DISCHARGED', 'ADMITTED', 'DECEASED'].includes(status)
          ? Prisma.sql`, closed_at = now()` : Prisma.empty;
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_triage SET status = ${status}${extra} WHERE id = ${id}::uuid`);
      return { ok: true as const };
    });
  }

  /** Fila de emergência ativa, ordenada por risco (Manchester) e chegada. */
  emergencyQueue(schema: string) {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT *, FLOOR(EXTRACT(EPOCH FROM (now() - arrived_at)) / 60)::int AS wait_min
        FROM clinic_triage WHERE status IN ('WAITING','IN_CARE','OBSERVATION')
        ORDER BY CASE risk WHEN 'RED' THEN 0 WHEN 'ORANGE' THEN 1 WHEN 'YELLOW' THEN 2 WHEN 'GREEN' THEN 3 ELSE 4 END, arrived_at`));
  }

  // ── Exames ─────────────────────────────────────────────────
  async requestExam(schema: string, by: { id: string | null }, dto: {
    patientId?: string; patientName?: string; examType: string; requestedBy?: string; fee?: number;
  }) {
    if (!dto.examType?.trim()) throw new BadRequestException('Indique o tipo de exame.');
    return this.prisma.runInTenant(schema, async (tx) => {
      let name = dto.patientName?.trim() || null;
      if (dto.patientId) {
        const p = await tx.$queryRaw<{ name: string }[]>(Prisma.sql`SELECT name FROM clinic_patients WHERE id = ${dto.patientId}::uuid`);
        if (p[0]) name = p[0].name;
      }
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO clinic_exams (patient_id, patient_name, exam_type, requested_by, fee, created_by)
        VALUES (${dto.patientId || null}::uuid, ${name}, ${dto.examType.trim()}, ${dto.requestedBy?.trim() || null},
                ${Number(dto.fee) || 0}, ${by.id}::uuid)
        RETURNING id`);
      return rows[0];
    });
  }

  async setExamStatus(schema: string, id: string, status: string, resultText?: string) {
    if (!EXAM_STATUS.includes(status)) throw new BadRequestException('Estado de exame inválido.');
    return this.prisma.runInTenant(schema, async (tx) => {
      const done = ['DONE', 'DELIVERED'].includes(status) ? Prisma.sql`, done_at = COALESCE(done_at, now())` : Prisma.empty;
      await tx.$executeRaw(Prisma.sql`UPDATE clinic_exams
        SET status = ${status}, result_text = COALESCE(${resultText?.trim() || null}, result_text)${done}
        WHERE id = ${id}::uuid`);
      return { ok: true as const };
    });
  }

  listExams(schema: string, status?: string) {
    const cond = status ? Prisma.sql` AND status = ${status}` : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`SELECT * FROM clinic_exams WHERE TRUE${cond} ORDER BY requested_at DESC LIMIT 200`));
  }

  /** Fatura um exame (documento fiscal AGT — mesmo motor das consultas). */
  async invoiceExam(schema: string, id: string, opener: { id: string | null; name: string }) {
    const ex = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<{ exam_type: string; fee: string; invoice_id: string | null }[]>(
        Prisma.sql`SELECT exam_type, fee, invoice_id FROM clinic_exams WHERE id = ${id}::uuid`));
    if (!ex[0]) throw new NotFoundException('Exame não encontrado.');
    if (ex[0].invoice_id) throw new BadRequestException('Exame já faturado.');
    const fee = Number(ex[0].fee);
    if (!(fee > 0)) throw new BadRequestException('Defina o preço do exame antes de faturar.');
    const net = round2(fee / (1 + IVA_NOR / 100));
    const inv = await this.invoices.emit(schema, {
      docType: DocumentType.FT, series: 'A',
      cashierId: opener.id, cashierName: opener.name, paymentType: 'CASH',
      lines: [{ description: `Exame — ${ex[0].exam_type}`, unitPrice: net, ivaCode: IvaCode.NOR, quantity: 1 }],
    });
    await this.prisma.runInTenant(schema, (tx) => tx.$executeRaw(Prisma.sql`UPDATE clinic_exams SET invoice_id = ${inv.id}::uuid WHERE id = ${id}::uuid`));
    return { invoiceId: inv.id, invoiceNumber: inv.number };
  }

  // ── Farmácia: medicamentos com stock/validade p/ a receita ──
  listMedications(schema: string, search?: string) {
    const cond = search?.trim()
      ? Prisma.sql` AND (p.name ILIKE ${'%' + search.trim() + '%'} OR p.code ILIKE ${'%' + search.trim() + '%'} OR p.active_ingredient ILIKE ${'%' + search.trim() + '%'})`
      : Prisma.empty;
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw(Prisma.sql`
        SELECT p.id, p.code, p.name, p.active_ingredient, p.requires_prescription, p.stock_qty, p.unit,
               (SELECT MIN(b.expiry_date) FROM product_batches b WHERE b.product_id = p.id AND b.quantity > 0) AS next_expiry
        FROM products p WHERE p.is_active = TRUE${cond}
        ORDER BY p.name LIMIT 30`));
  }
}
