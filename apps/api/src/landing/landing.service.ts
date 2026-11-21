import { Injectable, NotFoundException, Optional } from '@nestjs/common';
import { LandingConfig, Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { FiscalEngineService } from '../fiscal-engine/fiscal-engine.service';
import type { UpdateLandingDto, UpdatePlanDto } from './dto/landing.dto';

/** Funcionalidades por defeito mostradas na landing (editáveis pelo Super Admin). */
const DEFAULT_FEATURES = [
  { icon: 'pos', title: 'POS / Caixa', text: 'Venda rápida, táctil e offline. Recibo fiscal AGT com hash e QR.' },
  { icon: 'stock', title: 'Stock & Armazéns', text: 'Inventário por armazém, entradas/saídas e alertas de reposição.' },
  { icon: 'invoice', title: 'Facturação AGT', text: 'Facturas, SAF-T e assinatura digital — conforme a lei angolana.' },
  { icon: 'store', title: 'Loja Online', text: 'A sua montra na internet, com pagamentos e Multicaixa Express.' },
  { icon: 'ai', title: 'Assistente IA', text: 'OpenManus responde a clientes e ajuda a gerir o negócio.' },
  { icon: 'chart', title: 'Relatórios em tempo real', text: 'Vendas, lucros e desempenho — em Kwanzas, ao vivo.' },
];

/** Carrossel por defeito: imagens realistas de comércio/retalho (editável). */
const DEFAULT_HERO_IMAGES = [
  'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1578916171728-46686eac8d58?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1601598851547-4302969d0614?auto=format&fit=crop&w=1920&q=80',
  'https://images.unsplash.com/photo-1556740738-b6a63e27c4df?auto=format&fit=crop&w=1920&q=80',
];

/**
 * Conteúdo da página inicial pública da plataforma (landing).
 * Singleton lógico gerido 100% pelo Super Admin: hero, imagens, textos,
 * cores, funcionalidades e anúncios/publicidades. Mesmo padrão do AgtConfig.
 */
@Injectable()
export class LandingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly integrations: IntegrationsService,
    @Optional() private readonly fiscalEngine?: FiscalEngineService,
  ) {}

  /** Lê a config (cria a default com features na primeira leitura). */
  async get(): Promise<LandingConfig> {
    const existing = await this.prisma.landingConfig.findFirst();
    if (existing) return existing;
    return this.prisma.landingConfig.create({
      data: {
        features: DEFAULT_FEATURES as unknown as Prisma.InputJsonValue,
        heroImages: DEFAULT_HERO_IMAGES as unknown as Prisma.InputJsonValue,
      },
    });
  }

  /** Atualização parcial pelo Super Admin. */
  async update(dto: UpdateLandingDto): Promise<LandingConfig> {
    const current = await this.get();
    const { features, ads, heroImages, authConfig, ...rest } = dto;
    return this.prisma.landingConfig.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(features !== undefined ? { features: features as unknown as Prisma.InputJsonValue } : {}),
        ...(ads !== undefined ? { ads: ads as unknown as Prisma.InputJsonValue } : {}),
        ...(heroImages !== undefined ? { heroImages: heroImages as unknown as Prisma.InputJsonValue } : {}),
        ...(authConfig !== undefined ? { authConfig: sanitizeAuthConfig(authConfig) as unknown as Prisma.InputJsonValue } : {}),
      },
    });
  }

  /** Planos para gestão (Super Admin) — todos, ordenados. */
  listPlans(): Promise<Plan[]> {
    return this.prisma.plan.findMany({ orderBy: { sortOrder: 'asc' } });
  }

  /** Planos públicos (landing) — só os marcados isPublic. */
  listPublicPlans(): Promise<Plan[]> {
    return this.prisma.plan.findMany({
      where: { isPublic: true },
      orderBy: { sortOrder: 'asc' },
    });
  }

  async updatePlan(id: string, dto: UpdatePlanDto): Promise<Plan> {
    const plan = await this.prisma.plan.findUnique({ where: { id } });
    if (!plan) throw new NotFoundException('Plano não encontrado');
    return this.prisma.plan.update({ where: { id }, data: dto });
  }

  /** Pacote completo para a landing pública (config + planos visíveis). */
  async getPublicLanding(): Promise<{ config: LandingConfig; plans: Plan[]; agtCertificate: string | null; facebookAppId: string | null; fiscalEngine: Record<string, string> | null }> {
    const [config, plans, agt] = await Promise.all([
      this.get(),
      this.listPublicPlans(),
      // Nº de validação do software (Super Admin → Fiscal). "0"/vazio = ainda sem número.
      this.prisma.agtFiscalConfig.findFirst({ select: { softwareCertificateNumber: true } }).catch(() => null),
    ]);
    const n = agt?.softwareCertificateNumber?.trim();
    // App ID PÚBLICO do Facebook Login (só quando a integração está ligada e tem segredo).
    const fb = await this.integrations.getActive('FACEBOOK_LOGIN').catch(() => null);
    const fbId = String(fb?.settings?.appId ?? '').trim();
    // Identificação do software fiscal (missão Vendus): o nº de validação PRÓPRIO só aparece
    // com a validação do LPS documentada (Modo B); o Cegid Vendus só aparece quando é
    // efectivamente o motor em utilização e com a validade confirmada.
    const disc = await this.fiscalEngine?.publicDisclosure().catch(() => null);
    const own = disc?.lps?.validationNo ?? null;
    return {
      config, plans,
      agtCertificate: own && n && n !== '0' && own === n ? n : own,
      facebookAppId: fb && fb.secret && fbId ? fbId : null,
      fiscalEngine: disc?.vendus ?? null,
    };
  }
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v: unknown, max: number): string | undefined => (typeof v === 'string' ? v.trim().slice(0, max) : undefined);
const col = (v: unknown): string | undefined => (typeof v === 'string' && HEX.test(v.trim()) ? v.trim() : undefined);
const bool = (v: unknown): boolean | undefined => (typeof v === 'boolean' ? v : undefined);
const clean = <T extends Record<string, unknown>>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Botão social (Google/Facebook) do login e do registo. */
function socialBtn(v: unknown) {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return clean({ enabled: bool(o.enabled), label: str(o.label, 40), bg: col(o.bg), color: col(o.color), border: col(o.border) });
}

/**
 * Valida a configuração do login/registo vinda do Super Admin: só campos
 * conhecidos, cores #rrggbb, textos com limite e até 8 testemunhos (foto como
 * URL https ou data-URI de imagem até ~300 KB).
 */
export function sanitizeAuthConfig(v: Record<string, unknown>) {
  const t = Array.isArray(v.testimonials) ? v.testimonials.slice(0, 8) : [];
  return clean({
    primary: col(v.primary),
    pageBg: col(v.pageBg),
    linkColor: col(v.linkColor),
    sideFrom: col(v.sideFrom),
    sideTo: col(v.sideTo),
    registerTitle: str(v.registerTitle, 80),
    registerSubtitle: str(v.registerSubtitle, 120),
    optInLabel: str(v.optInLabel, 140),
    showNif: bool(v.showNif),
    google: socialBtn(v.google),
    facebook: socialBtn(v.facebook),
    testimonials: t.map((x) => {
      const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
      const photo = str(o.photoUrl, 400_000);
      return clean({
        text: str(o.text, 300) ?? '', name: str(o.name, 60) ?? '', company: str(o.company, 60),
        photoUrl: photo && (/^https:\/\//.test(photo) || /^data:image\/(png|jpe?g|webp);base64,/.test(photo)) ? photo : undefined,
      });
    }).filter((x) => x.text && x.name),
  });
}
