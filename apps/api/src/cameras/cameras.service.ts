import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CameraRow {
  id: string;
  name: string;
  stream_url: string;
  snapshot_url: string | null;
  kind: string;
  notes: string | null;
  record: boolean;
  is_active: boolean;
  created_at: Date;
}

export interface CameraInput {
  name: string;
  streamUrl: string;
  snapshotUrl?: string | null;
  kind?: string;
  notes?: string | null;
  record?: boolean;
  isActive?: boolean;
}

const KINDS = new Set(['AUTO', 'HLS', 'MJPEG', 'MP4']);

/** Deduz o tipo de stream pela URL (quando AUTO). */
export function detectKind(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('.m3u8')) return 'HLS';
  if (u.includes('.mp4') || u.includes('.webm')) return 'MP4';
  return 'MJPEG';
}

@Injectable()
export class CamerasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private validateUrl(url: string): string {
    const v = url.trim();
    if (!/^https?:\/\//i.test(v)) {
      throw new BadRequestException(
        'A URL da câmara tem de ser HTTP(S) — HLS (.m3u8), MJPEG ou MP4. Streams RTSP precisam de ser convertidos pelo DVR/NVR (a maioria expõe HTTP nas definições).',
      );
    }
    return v.slice(0, 500);
  }

  list(schema: string): Promise<CameraRow[]> {
    return this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CameraRow[]>(Prisma.sql`SELECT * FROM cameras ORDER BY is_active DESC, name`),
    );
  }

  async create(schema: string, actorId: string, input: CameraInput): Promise<CameraRow> {
    const name = (input.name ?? '').trim().slice(0, 120);
    if (!name) throw new BadRequestException('Dá um nome à câmara.');
    const streamUrl = this.validateUrl(input.streamUrl ?? '');
    const kind = KINDS.has(input.kind ?? '') ? input.kind! : 'AUTO';
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CameraRow[]>(Prisma.sql`
        INSERT INTO cameras (name, stream_url, snapshot_url, kind, notes, record)
        VALUES (${name}, ${streamUrl}, ${input.snapshotUrl?.trim() || null}, ${kind}, ${input.notes?.trim() || null}, ${input.record ?? false})
        RETURNING *`),
    );
    await this.audit.record({ actorType: 'TENANT', actorId, tenantSchema: schema, action: 'CAMERA_CREATED', entity: 'Camera', entityId: rows[0].id, after: { name, streamUrl } });
    return rows[0];
  }

  /** Atualiza/desativa (NUNCA elimina — histórico preservado). */
  async update(schema: string, actorId: string, id: string, input: Partial<CameraInput>): Promise<CameraRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name.trim().slice(0, 120)}`);
    if (input.streamUrl !== undefined) sets.push(Prisma.sql`stream_url = ${this.validateUrl(input.streamUrl)}`);
    if (input.snapshotUrl !== undefined) sets.push(Prisma.sql`snapshot_url = ${input.snapshotUrl?.trim() || null}`);
    if (input.kind !== undefined && KINDS.has(input.kind)) sets.push(Prisma.sql`kind = ${input.kind}`);
    if (input.notes !== undefined) sets.push(Prisma.sql`notes = ${input.notes?.trim() || null}`);
    if (input.record !== undefined) sets.push(Prisma.sql`record = ${input.record}`);
    if (input.isActive !== undefined) sets.push(Prisma.sql`is_active = ${input.isActive}`);
    if (!sets.length) throw new BadRequestException('Nada para alterar.');
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CameraRow[]>(Prisma.sql`UPDATE cameras SET ${Prisma.join(sets, ', ')} WHERE id = ${id}::uuid RETURNING *`),
    );
    if (!rows[0]) throw new NotFoundException('Câmara não encontrada.');
    await this.audit.record({ actorType: 'TENANT', actorId, tenantSchema: schema, action: 'CAMERA_UPDATED', entity: 'Camera', entityId: id, after: input as object });
    return rows[0];
  }

  /**
   * Teste de ligação REAL. Além de verificar que a câmara responde, classifica
   * o conteúdo: uma causa MUITO comum de "teste OK mas não abre" é o utilizador
   * colar a página/portal do fabricante (HTML) em vez da URL do STREAM — o teste
   * antigo dava "OK" a qualquer 200. Agora distingue stream de página e avisa.
   */
  async test(schema: string, id: string): Promise<{ ok: boolean; status: number; contentType: string | null; kind: string; warning?: string; secure: boolean }> {
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CameraRow[]>(Prisma.sql`SELECT * FROM cameras WHERE id = ${id}::uuid LIMIT 1`),
    );
    const cam = rows[0];
    if (!cam) throw new NotFoundException('Câmara não encontrada.');
    const url = cam.snapshot_url || cam.stream_url;
    const secure = /^https:/i.test(cam.stream_url);
    try {
      const res = await fetch(url, { method: 'GET', headers: { range: 'bytes=0-512' }, signal: AbortSignal.timeout(8000) });
      const ct = (res.headers.get('content-type') ?? '').toLowerCase();
      try { await res.body?.cancel(); } catch { /* ok */ }
      const looksPage = /text\/html|application\/xhtml|application\/json|text\/plain/.test(ct);
      const isStream = /(video\/|image\/|multipart\/x-mixed-replace|application\/(vnd\.apple\.mpegurl|x-mpegurl|mpegurl|octet-stream|dash\+xml|mp4))/.test(ct);
      let warning: string | undefined;
      if (looksPage) {
        warning = 'A URL devolveu uma PÁGINA WEB, não um stream de vídeo. Cola a URL do STREAM da câmara (HLS .m3u8, MJPEG ou MP4) — não a página nem o link da app do fabricante.';
      } else if (res.ok && ct && !isStream) {
        warning = `A câmara respondeu mas o conteúdo «${ct}» não parece um stream de vídeo. Confirma a URL.`;
      }
      return {
        ok: res.ok && !looksPage,
        status: res.status,
        contentType: ct || null,
        kind: cam.kind === 'AUTO' ? detectKind(cam.stream_url) : cam.kind,
        warning,
        secure,
      };
    } catch {
      return { ok: false, status: 0, contentType: null, kind: cam.kind, secure };
    }
  }
}
