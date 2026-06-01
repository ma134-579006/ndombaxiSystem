import { Injectable, NotFoundException } from '@nestjs/common';
import { LandingConfig, Plan, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
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

/**
 * Conteúdo da página inicial pública da plataforma (landing).
 * Singleton lógico gerido 100% pelo Super Admin: hero, imagens, textos,
 * cores, funcionalidades e anúncios/publicidades. Mesmo padrão do AgtConfig.
 */
@Injectable()
export class LandingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Lê a config (cria a default com features na primeira leitura). */
  async get(): Promise<LandingConfig> {
    const existing = await this.prisma.landingConfig.findFirst();
    if (existing) return existing;
    return this.prisma.landingConfig.create({
      data: { features: DEFAULT_FEATURES as unknown as Prisma.InputJsonValue },
    });
  }

  /** Atualização parcial pelo Super Admin. */
  async update(dto: UpdateLandingDto): Promise<LandingConfig> {
    const current = await this.get();
    const { features, ads, ...rest } = dto;
    return this.prisma.landingConfig.update({
      where: { id: current.id },
      data: {
        ...rest,
        ...(features !== undefined ? { features: features as unknown as Prisma.InputJsonValue } : {}),
        ...(ads !== undefined ? { ads: ads as unknown as Prisma.InputJsonValue } : {}),
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
  async getPublicLanding(): Promise<{ config: LandingConfig; plans: Plan[] }> {
    const [config, plans] = await Promise.all([this.get(), this.listPublicPlans()]);
    return { config, plans };
  }
}
