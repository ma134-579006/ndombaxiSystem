import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AppRelease } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type Platform = 'windows' | 'android' | 'ios';
const PLATFORMS: Platform[] = ['windows', 'android', 'ios'];

/** Forma pública de uma versão — o que o site e as apps podem ver. */
export interface PublicRelease {
  platform: Platform;
  version: string;
  minSupported: string | null;
  downloadPageUrl: string | null;
  fileSize: number | null;
  sha256: string | null;
  notes: string[];
  fixes: string[];
  requirements: string | null;
  mandatory: boolean;
  releasedAt: string;
}

@Injectable()
export class DownloadsService {
  constructor(private readonly prisma: PrismaService) {}

  private static assertPlatform(p: string): Platform {
    if (!PLATFORMS.includes(p as Platform)) {
      throw new BadRequestException(`Plataforma inválida: ${p}. Use windows, android ou ios.`);
    }
    return p as Platform;
  }

  /**
   * Converte para a forma pública. Repare no que fica DE FORA: `fileUrl`, o link
   * direto do armazenamento. O cliente final nunca o vê — é sempre encaminhado
   * para a `downloadPageUrl`, a página oficial. Assim o link do Drive/Mega pode
   * mudar sem partir nada, e ninguém partilha um ficheiro sem passar pela página
   * onde estão o hash e a versão.
   */
  private static toPublic(r: AppRelease): PublicRelease {
    return {
      platform: r.platform as Platform,
      version: r.version,
      minSupported: r.minSupported,
      downloadPageUrl: r.downloadPageUrl,
      fileSize: r.fileSize,
      sha256: r.sha256,
      notes: Array.isArray(r.notes) ? (r.notes as string[]) : [],
      fixes: Array.isArray(r.fixes) ? (r.fixes as string[]) : [],
      requirements: r.requirements,
      mandatory: r.mandatory,
      releasedAt: r.releasedAt.toISOString(),
    };
  }

  /** A versão publicada mais recente de uma plataforma (a que a app consulta). */
  async latest(platformRaw: string): Promise<PublicRelease | null> {
    const platform = DownloadsService.assertPlatform(platformRaw);
    const rel = await this.prisma.appRelease.findFirst({
      where: { platform, published: true },
      orderBy: { releasedAt: 'desc' },
    });
    return rel ? DownloadsService.toPublic(rel) : null;
  }

  /** A mais recente de cada plataforma — alimenta a página oficial de downloads. */
  async publicLatestAll(): Promise<Record<Platform, PublicRelease | null>> {
    const out = { windows: null, android: null, ios: null } as Record<Platform, PublicRelease | null>;
    await Promise.all(PLATFORMS.map(async (p) => { out[p] = await this.latest(p); }));
    return out;
  }

  // ── Super Admin ────────────────────────────────────────────

  /** Todas as versões (publicadas ou não), para o painel de gestão. */
  listAll(): Promise<AppRelease[]> {
    return this.prisma.appRelease.findMany({
      orderBy: [{ platform: 'asc' }, { releasedAt: 'desc' }],
    });
  }

  async create(dto: UpsertReleaseInput): Promise<AppRelease> {
    const platform = DownloadsService.assertPlatform(dto.platform);
    if (!dto.version?.trim()) throw new BadRequestException('A versão é obrigatória.');
    if (!dto.fileUrl?.trim()) throw new BadRequestException('O link do ficheiro é obrigatório.');
    return this.prisma.appRelease.create({
      data: {
        platform,
        version: dto.version.trim(),
        minSupported: dto.minSupported?.trim() || null,
        fileUrl: dto.fileUrl.trim(),
        downloadPageUrl: dto.downloadPageUrl?.trim() || null,
        fileSize: dto.fileSize ?? null,
        sha256: dto.sha256?.trim() || null,
        notes: dto.notes ?? [],
        fixes: dto.fixes ?? [],
        requirements: dto.requirements?.trim() || null,
        mandatory: dto.mandatory ?? false,
        published: dto.published ?? false,
      },
    });
  }

  async update(id: string, dto: Partial<UpsertReleaseInput>): Promise<AppRelease> {
    await this.getOrThrow(id);
    return this.prisma.appRelease.update({
      where: { id },
      data: {
        ...(dto.platform !== undefined ? { platform: DownloadsService.assertPlatform(dto.platform) } : {}),
        ...(dto.version !== undefined ? { version: dto.version.trim() } : {}),
        ...(dto.minSupported !== undefined ? { minSupported: dto.minSupported?.trim() || null } : {}),
        ...(dto.fileUrl !== undefined ? { fileUrl: dto.fileUrl.trim() } : {}),
        ...(dto.downloadPageUrl !== undefined ? { downloadPageUrl: dto.downloadPageUrl?.trim() || null } : {}),
        ...(dto.fileSize !== undefined ? { fileSize: dto.fileSize } : {}),
        ...(dto.sha256 !== undefined ? { sha256: dto.sha256?.trim() || null } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.fixes !== undefined ? { fixes: dto.fixes } : {}),
        ...(dto.requirements !== undefined ? { requirements: dto.requirements?.trim() || null } : {}),
        ...(dto.mandatory !== undefined ? { mandatory: dto.mandatory } : {}),
        ...(dto.published !== undefined ? { published: dto.published } : {}),
        ...(dto.releasedAt !== undefined ? { releasedAt: new Date(dto.releasedAt) } : {}),
      },
    });
  }

  async remove(id: string): Promise<{ deleted: boolean }> {
    await this.getOrThrow(id);
    await this.prisma.appRelease.delete({ where: { id } });
    return { deleted: true };
  }

  /**
   * Publica uma versão e despublica as outras da MESMA plataforma — só pode
   * haver uma "mais recente" por plataforma. Faz-se numa transação para nunca
   * existir um instante com zero (ou duas) versões ativas.
   */
  async publish(id: string): Promise<AppRelease> {
    const rel = await this.getOrThrow(id);
    const [, updated] = await this.prisma.$transaction([
      this.prisma.appRelease.updateMany({
        where: { platform: rel.platform, published: true, NOT: { id } },
        data: { published: false },
      }),
      this.prisma.appRelease.update({ where: { id }, data: { published: true } }),
    ]);
    return updated;
  }

  private async getOrThrow(id: string): Promise<AppRelease> {
    const rel = await this.prisma.appRelease.findUnique({ where: { id } });
    if (!rel) throw new NotFoundException('Versão não encontrada.');
    return rel;
  }
}

export interface UpsertReleaseInput {
  platform: string;
  version: string;
  minSupported?: string | null;
  fileUrl: string;
  downloadPageUrl?: string | null;
  fileSize?: number | null;
  sha256?: string | null;
  notes?: string[];
  fixes?: string[];
  requirements?: string | null;
  mandatory?: boolean;
  published?: boolean;
  releasedAt?: string;
}
