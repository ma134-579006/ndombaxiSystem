import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { JwtPayload } from '@nexus/types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { BackupService } from './backup.service';
import { RestoreBackupDto, UpdateBackupSettingsDto } from './dto/backup.dto';

/**
 * Backup & Restauro (dados de gestão nunca se perdem): backup manual/automático,
 * listagem/descarregamento, e restauro por upsert (nunca destrutivo). Reservado
 * ao gestor da empresa (COMPANY_ADMIN) — dados sensíveis de toda a empresa.
 */
@ApiTags('backup')
@Controller('backup')
@Roles(Role.COMPANY_ADMIN)
export class BackupController {
  constructor(
    private readonly svc: BackupService,
    private readonly ctx: TenantContext,
  ) {}

  @Get('settings')
  @ApiOperation({ summary: 'Configuração do backup automático (agendado)' })
  getSettings() {
    return this.svc.getSettings(this.ctx.requireTenantSchema());
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Ativa/desativa o backup automático e a frequência' })
  updateSettings(@Body() dto: UpdateBackupSettingsDto) {
    return this.svc.updateSettings(this.ctx.requireTenantSchema(), dto);
  }

  @Post('run')
  @ApiOperation({ summary: 'Faz um backup manual agora' })
  run(@CurrentUser() user: JwtPayload) {
    return this.svc.create(this.ctx.requireTenantSchema(), { id: user.sub, name: user.name }, 'MANUAL');
  }

  @Get()
  @ApiOperation({ summary: 'Lista os backups guardados (metadados)' })
  list() {
    return this.svc.list(this.ctx.requireTenantSchema());
  }

  @Get(':id/download')
  @ApiOperation({ summary: 'Descarrega um backup (.ndbak)' })
  download(@Param('id') id: string) {
    return this.svc.download(this.ctx.requireTenantSchema(), id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove um backup guardado' })
  remove(@Param('id') id: string) {
    return this.svc.remove(this.ctx.requireTenantSchema(), id);
  }

  @Post('restore/preview')
  @ApiOperation({ summary: 'Pré-visualiza um restauro (sem alterar nada)' })
  previewRestore(@Body() dto: RestoreBackupDto) {
    return this.svc.previewRestore(this.ctx.requireTenantSchema(), dto.contentBase64);
  }

  @Post('restore/apply')
  @ApiOperation({ summary: 'Aplica o restauro (upsert por id, nunca apaga nada)' })
  applyRestore(@Body() dto: RestoreBackupDto, @CurrentUser() user: JwtPayload) {
    return this.svc.applyRestore(this.ctx.requireTenantSchema(), dto.contentBase64, { id: user.sub, name: user.name });
  }
}
