import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { Platform } from './downloads.service';

/** Repositório público onde o CI publica as apps (Releases). */
const REPO = process.env.RELEASES_REPO || 'ma134-579006/ndombaxiSystem';
const API = process.env.RELEASES_API_URL || 'https://api.github.com';
const EVERY_MS = 10 * 60 * 1000;
/** Um pedido manual (CI) não pode martelar o GitHub. */
const MIN_GAP_MS = 20 * 1000;
/** Uma app a perguntar pela versão dispara uma sincronização se a última for mais antiga. */
const STALE_MS = 5 * 60 * 1000;

/** Cada app: a release `*-latest` que o CI substitui e o ficheiro de nome fixo. */
export const RELEASE_SOURCES: { platform: Platform; tag: string; asset: string }[] = [
  { platform: 'windows', tag: 'windows-latest', asset: 'LPSVendas-Setup-x64.exe' },
  { platform: 'android', tag: 'android-latest', asset: 'LPSVendas-Android.apk' },
  { platform: 'android-loja', tag: 'android-loja-latest', asset: 'LPSLoja-Android.apk' },
  { platform: 'android-kwanza', tag: 'android-kwanza-latest', asset: 'LPSKwanza-Android.apk' },
  { platform: 'windows-kwanza', tag: 'windows-kwanza-latest', asset: 'LPSKwanza-Setup-x64.exe' },
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

/**
 * Plano B quando a API do GitHub recusa (403/429 — limite de 60 pedidos/hora por
 * IP sem token; o IP do Render é PARTILHADO, por isso o limite esgota-se com
 * pedidos de outros clientes e a sincronização ficava parada: as versões novas
 * nunca eram publicadas como obrigatórias). O feed público `releases.atom` não
 * conta para esse limite e traz as notas ("Versão: x.y.z") de cada release; o
 * ficheiro tem nome fixo, por isso o link de download monta-se a partir da tag.
 */
export function releaseFromAtom(atom: string, tag: string): { body: string; published_at?: string } | null {
  for (const entry of atom.split('<entry>').slice(1)) {
    if (!entry.includes(`/releases/tag/${tag}"`)) continue;
    const html = (/<content type="html">([\s\S]*?)<\/content>/.exec(entry) ?? [])[1] ?? '';
    const body = html.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&').replace(/<[^>]+>/g, ' ');
    const updated = (/<updated>([^<]+)<\/updated>/.exec(entry) ?? [])[1];
    return { body, published_at: updated };
  }
  return null;
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

  /**
   * Chamado quando uma app pergunta pela versão: se a última sincronização tem
   * mais de 5 min, sincroniza em segundo plano. Garante a atualização mesmo com
   * o servidor gratuito a dormir (o setInterval não corre enquanto dorme).
   */
  syncIfStale(): void {
    if (process.env.NODE_ENV === 'test' || process.env.RELEASE_SYNC === 'off') return;
    if (Date.now() - this.lastRun < STALE_MS) return;
    void this.sync().catch(() => undefined);
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
    let rel: { body?: string; published_at?: string; assets?: { name: string; browser_download_url: string; size?: number }[] };
    if (res.ok) {
      rel = (await res.json()) as typeof rel;
    } else if (res.status === 403 || res.status === 429) {
      // Limite da API esgotado: lê o feed público e monta o link fixo do ficheiro.
      const feed = await fetch(`https://github.com/${REPO}/releases.atom`, {
        headers: { 'User-Agent': 'lps-vendas-api' }, signal: AbortSignal.timeout(10_000),
      });
      const fromAtom = feed.ok ? releaseFromAtom(await feed.text(), src.tag) : null;
      if (!fromAtom) return { platform: src.platform, version: null, action: 'skipped', reason: `GitHub ${res.status} (feed sem a release)` };
      rel = { ...fromAtom, assets: [{ name: src.asset, browser_download_url: `https://github.com/${REPO}/releases/download/${src.tag}/${src.asset}` }] };
    } else {
      return { platform: src.platform, version: null, action: 'skipped', reason: `GitHub ${res.status}` };
    }
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
