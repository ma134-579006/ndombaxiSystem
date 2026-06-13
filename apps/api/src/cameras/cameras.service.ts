import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CameraRow {
  id: string;
  name: string;
  stream_url: string | null;
  snapshot_url: string | null;
  kind: string;
  conn_type: string;
  device_sn: string | null;
  app_ios: string | null;
  app_android: string | null;
  notes: string | null;
  record: boolean;
  is_active: boolean;
  created_at: Date;
}

export interface CameraInput {
  name: string;
  streamUrl?: string | null;
  snapshotUrl?: string | null;
  kind?: string;
  connType?: string;
  deviceSn?: string | null;
  appIos?: string | null;
  appAndroid?: string | null;
  notes?: string | null;
  record?: boolean;
  isActive?: boolean;
}

/** Links por omissão das apps de nuvem mais comuns nestes DVR AHD ("Nuvem"). */
const DEFAULT_APP_IOS = 'https://apps.apple.com/app/xmeye/id898682121';
const DEFAULT_APP_ANDROID = 'https://play.google.com/store/apps/details?id=com.xm.csee';

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
    const connType = input.connType === 'P2P' ? 'P2P' : 'STREAM';
    let streamUrl: string | null = null;
    let deviceSn: string | null = null;
    let appIos: string | null = null;
    let appAndroid: string | null = null;
    if (connType === 'P2P') {
      deviceSn = (input.deviceSn ?? '').trim().slice(0, 120);
      if (!deviceSn) throw new BadRequestException('Indica o SN (número de série) do DVR/câmara da nuvem.');
      appIos = (input.appIos?.trim() || DEFAULT_APP_IOS).slice(0, 500);
      appAndroid = (input.appAndroid?.trim() || DEFAULT_APP_ANDROID).slice(0, 500);
    } else {
      streamUrl = this.validateUrl(input.streamUrl ?? '');
    }
    const kind = KINDS.has(input.kind ?? '') ? input.kind! : 'AUTO';
    const rows = await this.prisma.runInTenant(schema, (tx) =>
      tx.$queryRaw<CameraRow[]>(Prisma.sql`
        INSERT INTO cameras (name, stream_url, snapshot_url, kind, conn_type, device_sn, app_ios, app_android, notes, record)
        VALUES (${name}, ${streamUrl}, ${input.snapshotUrl?.trim() || null}, ${kind}, ${connType}, ${deviceSn}, ${appIos}, ${appAndroid}, ${input.notes?.trim() || null}, ${input.record ?? false})
        RETURNING *`),
    );
    await this.audit.record({ actorType: 'TENANT', actorId, tenantSchema: schema, action: 'CAMERA_CREATED', entity: 'Camera', entityId: rows[0].id, after: { name, connType, streamUrl, deviceSn } });
    return rows[0];
  }

  /** Atualiza/desativa (NUNCA elimina — histórico preservado). */
  async update(schema: string, actorId: string, id: string, input: Partial<CameraInput>): Promise<CameraRow> {
    const sets: Prisma.Sql[] = [];
    if (input.name !== undefined) sets.push(Prisma.sql`name = ${input.name.trim().slice(0, 120)}`);
    if (input.connType !== undefined) sets.push(Prisma.sql`conn_type = ${input.connType === 'P2P' ? 'P2P' : 'STREAM'}`);
    if (input.streamUrl !== undefined) sets.push(Prisma.sql`stream_url = ${input.streamUrl ? this.validateUrl(input.streamUrl) : null}`);
    if (input.deviceSn !== undefined) sets.push(Prisma.sql`device_sn = ${input.deviceSn?.trim().slice(0, 120) || null}`);
    if (input.appIos !== undefined) sets.push(Prisma.sql`app_ios = ${input.appIos?.trim().slice(0, 500) || null}`);
    if (input.appAndroid !== undefined) sets.push(Prisma.sql`app_android = ${input.appAndroid?.trim().slice(0, 500) || null}`);
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
    // Câmara de NUVEM/P2P: não há URL HTTP para testar — confirma só o SN e
    // orienta o utilizador a abrir pelo «Guia» (3 QR) na app oficial.
    if (cam.conn_type === 'P2P') {
      return {
        ok: !!cam.device_sn,
        status: cam.device_sn ? 200 : 0,
        contentType: null,
        kind: 'P2P',
        warning: cam.device_sn
          ? 'Câmara de nuvem (P2P): vê-se na app oficial. Abre o «Guia» e escolhe iOS, Android ou lê o QR do SN.'
          : 'Falta o SN do equipamento.',
        secure: true,
      };
    }
    const url = cam.snapshot_url || cam.stream_url || '';
    const secure = /^https:/i.test(cam.stream_url ?? '');
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
        kind: cam.kind === 'AUTO' ? detectKind(cam.stream_url ?? '') : cam.kind,
        warning,
        secure,
      };
    } catch {
      return { ok: false, status: 0, contentType: null, kind: cam.kind, secure };
    }
  }
}
