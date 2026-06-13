import { Body, Controller, Get, Header, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JwtPayload } from '@nexus/types';
import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CamerasService } from './cameras.service';
import { CameraRecorderService } from './recorder.service';

class CameraDto {
  @IsString() @Length(1, 120)
  name!: string;

  @IsOptional() @IsString() @Length(0, 500)
  streamUrl?: string;

  @IsOptional() @IsString() @Length(0, 500)
  snapshotUrl?: string;

  @IsOptional() @IsIn(['AUTO', 'HLS', 'MJPEG', 'MP4'])
  kind?: string;

  @IsOptional() @IsIn(['STREAM', 'P2P'])
  connType?: string;

  @IsOptional() @IsString() @Length(0, 120)
  deviceSn?: string;

  @IsOptional() @IsString() @Length(0, 500)
  appIos?: string;

  @IsOptional() @IsString() @Length(0, 500)
  appAndroid?: string;

  @IsOptional() @IsString() @Length(0, 300)
  notes?: string;

  @IsOptional() @IsBoolean()
  record?: boolean;
}

class CameraUpdateDto {
  @IsOptional() @IsString() @Length(1, 120)
  name?: string;

  @IsOptional() @IsString() @Length(0, 500)
  streamUrl?: string;

  @IsOptional() @IsString() @Length(0, 500)
  snapshotUrl?: string;

  @IsOptional() @IsIn(['AUTO', 'HLS', 'MJPEG', 'MP4'])
  kind?: string;

  @IsOptional() @IsIn(['STREAM', 'P2P'])
  connType?: string;

  @IsOptional() @IsString() @Length(0, 120)
  deviceSn?: string;

  @IsOptional() @IsString() @Length(0, 500)
  appIos?: string;

  @IsOptional() @IsString() @Length(0, 500)
  appAndroid?: string;

  @IsOptional() @IsString() @Length(0, 300)
  notes?: string;

  @IsOptional() @IsBoolean()
  record?: boolean;

  @IsOptional() @IsBoolean()
  isActive?: boolean;
}

/** Câmaras: configurar (manual/QR), ver ao vivo e gravações (30 dias). */
@ApiTags('cameras')
@ApiBearerAuth()
@Controller('cameras')
export class CamerasController {
  constructor(
    private readonly cameras: CamerasService,
    private readonly recorder: CameraRecorderService,
    private readonly ctx: TenantContext,
  ) {}

  @Get()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Lista as câmaras configuradas' })
  list() {
    return this.cameras.list(this.ctx.requireTenantSchema());
  }

  @Post()
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Configura uma câmara (manual ou dados lidos do QR)' })
  create(@Body() dto: CameraDto, @CurrentUser() user: JwtPayload) {
    return this.cameras.create(this.ctx.requireTenantSchema(), user.sub, dto);
  }

  @Patch(':id')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Atualiza/desativa uma câmara (nunca elimina)' })
  update(@Param('id') id: string, @Body() dto: CameraUpdateDto, @CurrentUser() user: JwtPayload) {
    return this.cameras.update(this.ctx.requireTenantSchema(), user.sub, id, dto);
  }

  @Post(':id/test')
  @Roles(Role.COMPANY_ADMIN)
  @ApiOperation({ summary: 'Testa a ligação REAL à câmara' })
  test(@Param('id') id: string) {
    return this.cameras.test(this.ctx.requireTenantSchema(), id);
  }

  // ── gravações (instantâneos, retenção 30 dias) ─────────────
  @Get(':id/recordings')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Dias com gravações desta câmara' })
  days(@Param('id') id: string) {
    return { days: this.recorder.listDays(this.ctx.requireTenantSchema(), id) };
  }

  @Get(':id/recordings/:day')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Fotogramas gravados num dia' })
  frames(@Param('id') id: string, @Param('day') day: string) {
    return { frames: this.recorder.listFrames(this.ctx.requireTenantSchema(), id, day) };
  }

  @Get(':id/recordings/:day/:file')
  @Roles(Role.STORE_MANAGER)
  @Header('Cache-Control', 'private, max-age=3600')
  @ApiOperation({ summary: 'Um fotograma gravado (JPEG)' })
  frame(@Param('id') id: string, @Param('day') day: string, @Param('file') file: string, @Res() res: Response) {
    const buf = this.recorder.frame(this.ctx.requireTenantSchema(), id, day, file);
    if (!buf) { res.status(404).json({ message: 'Fotograma não encontrado.' }); return; }
    res.setHeader('Content-Type', 'image/jpeg');
    res.send(buf);
  }

  /** PROXY do stream para o browser (resolve CORS/mixed-content do MJPEG). */
  @Get(':id/live')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Stream ao vivo via proxy (MJPEG/MP4)' })
  async live(@Param('id') id: string, @Res() res: Response, @Query('snapshot') snapshot?: string) {
    const schema = this.ctx.requireTenantSchema();
    const cams = await this.cameras.list(schema);
    const cam = cams.find((c) => c.id === id);
    if (!cam) { res.status(404).json({ message: 'Câmara não encontrada.' }); return; }
    const url = snapshot === '1' && cam.snapshot_url ? cam.snapshot_url : cam.stream_url;
    if (!url) { res.status(400).json({ message: 'Câmara de nuvem (P2P) não tem stream HTTP — vê-se na app pelo Guia (3 QR).' }); return; }
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(15_000) });
      if (!upstream.ok || !upstream.body) { res.status(502).json({ message: `Câmara respondeu ${upstream.status}.` }); return; }
      res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/octet-stream');
      const reader = upstream.body.getReader();
      const pump = async (): Promise<void> => {
        const { done, value } = await reader.read();
        if (done) { res.end(); return; }
        if (!res.write(Buffer.from(value))) await new Promise((r) => res.once('drain', r));
        return pump();
      };
      res.on('close', () => void reader.cancel().catch(() => undefined));
      await pump();
    } catch {
      if (!res.headersSent) res.status(502).json({ message: 'Não foi possível ligar à câmara.' });
      else res.end();
    }
  }
}
