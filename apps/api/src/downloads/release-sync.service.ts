import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Platform } from './downloads.service';

/** Repositório público onde o CI publica as apps (Releases). */
const REPO = process.env.RELEASES_REPO || 'ma134-579006/ndombaxiSystem';
const API = process.env.RELEASES_API_URL || 'https://api.github.com';
const EVERY_MS = 10 * 60 * 1000;
/** Um pedido manual (CI) não pode martelar o GitHub. */
const MIN_GAP_MS = 20 * 1000;

/** Cada app: a release `*-latest` que o CI substitui e o ficheiro de nome fixo. */
export const RELEASE_SOURCES: { platform: Platform; tag: string; asset: string }[] = [
  { platform: 'windows', tag: 'windows-latest', asset: 'LPSVendas-Setup-x64.exe' },
  { platform: 'android', tag: 'android-latest', asset: 'LPSVendas-Android.apk' },
  { platform: 'android-loja', tag: 'android-loja-latest', asset: 'LPSLoja-Android.apk' },
];

/** 1.5.10 > 1.5.9 (igual à de @nexus/update-core, que as apps usam). */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0), pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** O CI escreve "Versão: 1.5.612" nas notas da release. */
export function versionFromNotes(body: unknown): string | null {
  if (typeof body !== 'string') return null;
  const m = /Vers[ãa]o:\s*v?(\d+\.\d+\.\d+)/i.exec(body);
  return m ? m[1] : null;
}

export interface SyncResult { platform: Platform; version: string | null; action: 'published' | 'unchanged' | 'skipped'; reason?: string }

/**
 * REGRA PERMANENTE: publicar uma app = a versão anterior deixa de funcionar.
 *
 * Sem ninguém registar nada à mão: o servidor lê as releases do GitHub (a cada
 * 10 min, ao arrancar e quando o CI avisa em POST /downloads/sync). Ao ver uma
 * versão maior do que a publicada, regista-a e publica-a — `/downloads/latest`
 * passa a devolvê-la com `mandatory: true` e as apps antigas ficam bloqueadas
 * com o botão para o site oficial.
 */
@Injectable()
export class ReleaseSyncService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReleaseSyncService.name);
  private readonly etags = new Map<string, string>();
  private lastRun = 0;
  private running: Promise<SyncResult[]> | null = null;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test' || process.env.RELEASE_SYNC === 'off') return;
    setTimeout(() => void this.sync().catch(() => undefined), 15_000);
    setInterval(() => void this.sync().catch(() => undefined), EVERY_MS);
  }

  /** Sincroniza agora (pedidos repetidos em menos de 20 s reutilizam o anterior). */
  sync(force = false): Promise<SyncResult[]> {
    if (this.running) return this.running;
    if (!force && Date.now() - this.lastRun < MIN_GAP_MS) return Promise.resolve([]);
    this.lastRun = Date.now();
    this.running = Promise.all(RELEASE_SOURCES.map((s) => this.syncOne(s).catch((e: Error) => ({
      platform: s.platform, version: null, action: 'skipped' as const, reason: e.message,
    })))).finally(() => { this.running = null; });
    return this.running;
  }

  private async syncOne(src: (typeof RELEASE_SOURCES)[number]): Promise<SyncResult> {
    const url = `${API}/repos/${REPO}/releases/tags/${src.tag}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'lps-vendas-api' };
    const etag = this.etags.get(url);
    if (etag) headers['If-None-Match'] = etag; // 304 não gasta o limite de pedidos do GitHub
    if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (res.status === 304) return { platform: src.platform, version: null, action: 'unchanged', reason: 'sem alterações' };
    if (!res.ok) return { platform: src.platform, version: null, action: 'skipped', reason: `GitHub ${res.status}` };
    const rel = (await res.json()) as { body?: string; published_at?: string; assets?: { name: string; browser_download_url: string; size?: number }[] };
    const version = versionFromNotes(rel.body);
    if (!version) return { platform: src.platform, version: null, action: 'skipped', reason: 'release sem "Versão:" nas notas' };
    const asset = rel.assets?.find((a) => a.name === src.asset);
    if (!asset) return { platform: src.platform, version, action: 'skipped', reason: `ficheiro ${src.asset} em falta` };

    const current = await this.prisma.appRelease.findFirst({
      where: { platform: src.platform, published: true }, orderBy: { releasedAt: 'desc' },
    });
    if (current && compareVersions(version, current.version) <= 0) {
      const e = res.headers.get('etag'); if (e) this.etags.set(url, e);
      return { platform: src.platform, version, action: 'unchanged', reason: `publicada ${current.version}` };
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.appRelease.updateMany({ where: { platform: src.platform, published: true }, data: { published: false } });
      await tx.appRelease.create({
        data: {
          platform: src.platform, version, fileUrl: asset.browser_download_url,
          downloadPageUrl: null, // o ecrã de bloqueio leva à página oficial do site
          fileSize: asset.size ?? null, notes: [`Publicada automaticamente pelo CI (release ${src.tag}).`],
          fixes: [], mandatory: true, published: true,
          releasedAt: rel.published_at ? new Date(rel.published_at) : new Date(),
        },
      });
    });
    const e = res.headers.get('etag'); if (e) this.etags.set(url, e);
    this.logger.log(`${src.platform}: versão ${version} publicada — versões anteriores bloqueadas.`);
    return { platform: src.platform, version, action: 'published' };
  }
}
