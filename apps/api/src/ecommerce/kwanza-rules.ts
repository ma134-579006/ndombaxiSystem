import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** LPS Kwanza — regras partilhadas dos saques (prazo, aviso, adiamento, banimento) e bancos. */
const H = 3_600_000;
const LUANDA = 1 * H; // UTC+1, sem hora de verão

/** Bancos de Angola para escolher (a empresa pode juntar outros). */
export const ANGOLA_BANKS = [
  'BAI', 'BFA', 'BIC', 'BPC', 'Millennium Atlântico', 'Banco Sol', 'Standard Bank', 'Banco Económico', 'BCI', 'Banco Keve',
  'Banco Yetu', 'BNI', 'Finibanco', 'Banco Caixa Geral Angola', 'Access Bank', 'Banco Comercial do Huambo', 'Banco de Fomento', 'Multicaixa Express',
];

export interface KwanzaRulesView {
  dueHours: number; weekendMode: 'MONDAY_END' | 'SAME'; extendHours: number; postponeMaxDays: number; postponeReasonMin: number; banDays: number;
}
export const DEFAULT_RULES: KwanzaRulesView = { dueHours: 24, weekendMode: 'MONDAY_END', extendHours: 24, postponeMaxDays: 7, postponeReasonMin: 10, banDays: 15 };
const LIMITS: Record<Exclude<keyof KwanzaRulesView, 'weekendMode'>, [number, number]> = {
  dueHours: [1, 168], extendHours: [1, 168], postponeMaxDays: [1, 30], postponeReasonMin: [5, 200], banDays: [1, 365],
};

/**
 * Prazo do saque pedido em `at`: segunda a quinta → `dueHours`; sexta a domingo → até ao fim
 * da segunda-feira seguinte (MONDAY_END, nunca antes de `dueHours`) ou as mesmas horas (SAME).
 */
export function withdrawalDue(at: Date, rules: Pick<KwanzaRulesView, 'dueHours' | 'weekendMode'> = DEFAULT_RULES): Date {
  const plain = new Date(at.getTime() + rules.dueHours * H);
  const local = new Date(at.getTime() + LUANDA);
  const dow = local.getUTCDay(); // 0 domingo … 6 sábado
  if ((dow >= 1 && dow <= 4) || rules.weekendMode === 'SAME') return plain;
  const toMonday = (8 - dow) % 7 || 7; // sexta → 3, sábado → 2, domingo → 1
  const monday = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() + toMonday, 23, 59, 59) - LUANDA);
  return monday > plain ? monday : plain;
}

/** Regras configuráveis pelo Super Admin (com cache curta; fallback seguro nos valores de origem). */
@Injectable()
export class KwanzaRulesService {
  private cache: { at: number; v: KwanzaRulesView } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  async get(): Promise<KwanzaRulesView> {
    if (this.cache && Date.now() - this.cache.at < 15_000) return this.cache.v;
    const r = await this.prisma.kwanzaRules.findUnique({ where: { id: 'default' } }).catch(() => null);
    const v: KwanzaRulesView = r ? {
      dueHours: r.dueHours, weekendMode: r.weekendMode === 'SAME' ? 'SAME' : 'MONDAY_END', extendHours: r.extendHours,
      postponeMaxDays: r.postponeMaxDays, postponeReasonMin: r.postponeReasonMin, banDays: r.banDays,
    } : { ...DEFAULT_RULES };
    this.cache = { at: Date.now(), v };
    return v;
  }

  async save(p: Partial<KwanzaRulesView>): Promise<KwanzaRulesView> {
    const cur = await this.get();
    const next: KwanzaRulesView = { ...cur };
    for (const k of Object.keys(LIMITS) as Array<keyof typeof LIMITS>) {
      if (p[k] === undefined) continue;
      const n = Math.round(Number(p[k]));
      const [lo, hi] = LIMITS[k];
      if (!Number.isFinite(n) || n < lo || n > hi) throw new BadRequestException(`Valor fora do limite (${lo} a ${hi}).`);
      next[k] = n;
    }
    if (p.weekendMode !== undefined) next.weekendMode = p.weekendMode === 'SAME' ? 'SAME' : 'MONDAY_END';
    await this.prisma.kwanzaRules.upsert({ where: { id: 'default' }, create: { id: 'default', ...next }, update: { ...next, updatedAt: new Date() } });
    this.cache = { at: Date.now(), v: next };
    return next;
  }
}
