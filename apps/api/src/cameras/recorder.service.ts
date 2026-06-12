import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';

/**
 * GRAVADOR de câmaras por INSTANTÂNEOS: para cada câmara ativa com
 * `record = true` e `snapshot_url` definido, guarda um fotograma JPEG por
 * minuto em RECORDINGS_DIR/<empresa>/<camara>/<dia>/. RETENÇÃO: 30 dias —
 * uma limpeza diária apaga automaticamente o que for mais antigo, libertando
 * espaço para as gravações seguintes.
 *
 * Nota de infraestrutura: o disco tem de ser persistente (no Render, anexar
 * um Disk ao serviço e apontar RECORDINGS_DIR para ele). Para vídeo contínuo
 * 24/7, o caminho recomendado é o DVR/NVR gravar localmente e o sistema
 * guardar os instantâneos como REGISTO de auditoria visual.
 */

const SNAPSHOT_EVERY_MS = 60_000; // 1 fotograma/minuto por câmara
const PURGE_EVERY_MS = 6 * 3600_000; // limpeza de retenção 4x/dia
const RETENTION_DAYS = 30;
const MAX_CAMERAS_PER_TICK = 12;

interface RecCam { schema: string; id: string; snapshot_url: string }

@Injectable()
export class CameraRecorderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CameraRecorderService.name);
  private snapTimer: NodeJS.Timeout | null = null;
  private purgeTimer: NodeJS.Timeout | null = null;
  private readonly dir = resolve(process.env.RECORDINGS_DIR ?? './recordings');

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    mkdirSync(this.dir, { recursive: true });
    this.snapTimer = setInterval(() => void this.tick().catch(() => undefined), SNAPSHOT_EVERY_MS);
    this.purgeTimer = setInterval(() => this.purge(), PURGE_EVERY_MS);
    this.purge();
    this.logger.log(`Gravador de câmaras ativo (instantâneos 1/min, retenção ${RETENTION_DAYS} dias) em ${this.dir}`);
  }

  onModuleDestroy(): void {
    if (this.snapTimer) clearInterval(this.snapTimer);
    if (this.purgeTimer) clearInterval(this.purgeTimer);
  }

  /** Câmaras a gravar, em todas as empresas ativas (com tolerância a falhas). */
  private async camerasToRecord(): Promise<RecCam[]> {
    const companies = await this.prisma.company.findMany({
      where: { status: 'ACTIVE' },
      select: { schemaName: true },
      take: 100,
    });
    const out: RecCam[] = [];
    for (const c of companies) {
      try {
        const rows = await this.prisma.runInTenant(c.schemaName, (tx) =>
          tx.$queryRaw<{ id: string; snapshot_url: string }[]>(
            Prisma.sql`SELECT id, snapshot_url FROM cameras WHERE is_active = TRUE AND record = TRUE AND snapshot_url IS NOT NULL LIMIT 4`,
          ),
        );
        for (const r of rows) out.push({ schema: c.schemaName, id: r.id, snapshot_url: r.snapshot_url });
      } catch { /* tenant sem tabela ainda — auto-heal trata */ }
      if (out.length >= MAX_CAMERAS_PER_TICK) break;
    }
    return out;
  }

  private async tick(): Promise<void> {
    const cams = await this.camerasToRecord();
    for (const cam of cams) {
      try {
        const res = await fetch(cam.snapshot_url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 200 || buf.length > 5_000_000) continue; // sanidade
        const now = new Date();
        const day = now.toISOString().slice(0, 10);
        const dir = join(this.dir, cam.schema, cam.id, day);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${now.toISOString().slice(11, 19).replace(/:/g, '')}.jpg`), buf);
      } catch { /* câmara offline — tenta no próximo minuto */ }
    }
  }

  /** RETENÇÃO: apaga pastas-dia com mais de 30 dias (liberta espaço). */
  purge(): void {
    try {
      if (!existsSync(this.dir)) return;
      const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
      for (const schema of readdirSync(this.dir)) {
        const sDir = join(this.dir, schema);
        if (!statSync(sDir).isDirectory()) continue;
        for (const cam of readdirSync(sDir)) {
          const cDir = join(sDir, cam);
          if (!statSync(cDir).isDirectory()) continue;
          for (const day of readdirSync(cDir)) {
            const t = Date.parse(day);
            if (Number.isFinite(t) && t < cutoff) {
              rmSync(join(cDir, day), { recursive: true, force: true });
              this.logger.log(`Retenção: apagado ${schema}/${cam}/${day}`);
            }
          }
        }
      }
    } catch (e) {
      this.logger.warn(`Limpeza de gravações falhou: ${(e as Error).message}`);
    }
  }

  /** Dias com gravações + fotogramas de um dia (para o frontend listar). */
  listDays(schema: string, cameraId: string): string[] {
    const dir = join(this.dir, schema, cameraId);
    try { return readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse(); }
    catch { return []; }
  }

  listFrames(schema: string, cameraId: string, day: string): string[] {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return [];
    const dir = join(this.dir, schema, cameraId, day);
    try { return readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort(); }
    catch { return []; }
  }

  frame(schema: string, cameraId: string, day: string, file: string): Buffer | null {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{6}\.jpg$/.test(file)) return null;
    try { return require('node:fs').readFileSync(join(this.dir, schema, cameraId, day, file)) as Buffer; }
    catch { return null; }
  }
}
