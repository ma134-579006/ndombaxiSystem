import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { DownloadsService } from './downloads.service';
import { CreateReleaseDto, UpdateReleaseDto } from './dto/release.dto';

/**
 * Endpoints PÚBLICOS de downloads — sem autenticação.
 *
 * `/downloads/latest` é consumido pelas próprias aplicações (o updater do
 * Electron já o chama). `/downloads/public` alimenta a página oficial do site.
 * Nenhum deles devolve o link direto do armazenamento — só a página oficial
 * para onde o utilizador é encaminhado.
 */
@ApiTags('public')
@Controller('downloads')
export class DownloadsPublicController {
  constructor(private readonly downloads: DownloadsService) {}

  @Public()
  @Get('latest')
  @ApiOperation({ summary: 'Versão publicada mais recente de uma plataforma (usado pelas apps)' })
  latest(@Query('platform') platform = 'windows') {
    return this.downloads.latest(platform);
  }

  @Public()
  @Get('public')
  @ApiOperation({ summary: 'Mais recente de cada plataforma (página oficial de downloads)' })
  publicAll() {
    return this.downloads.publicLatestAll();
  }
}

/**
 * Gestão de Downloads — só o Super Admin. É aqui que se cola o link do
 * instalador (Drive/Mega/R2/GitHub…), sem nunca fixar nada no código.
 */
@ApiTags('super-admin')
@Controller('super-admin/downloads')
@Roles(Role.SUPER_ADMIN)
export class DownloadsAdminController {
  constructor(private readonly downloads: DownloadsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista todas as versões (publicadas ou não)' })
  list() {
    return this.downloads.listAll();
  }

  @Post()
  @ApiOperation({ summary: 'Regista uma nova versão de uma aplicação' })
  create(@Body() dto: CreateReleaseDto) {
    return this.downloads.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita uma versão' })
  update(@Param('id') id: string, @Body() dto: UpdateReleaseDto) {
    return this.downloads.update(id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publica esta versão (despublica as outras da mesma plataforma)' })
  publish(@Param('id') id: string) {
    return this.downloads.publish(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove uma versão' })
  remove(@Param('id') id: string) {
    return this.downloads.remove(id);
  }
}
