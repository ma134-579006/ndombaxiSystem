import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { CreatePageDto, UpdatePageDto, UpdateSiteSettingsDto } from './dto/site.dto';
import { SiteService } from './site.service';

/**
 * Back-office do construtor de site (§8). O gestor/administrador da loja
 * configura o branding e as páginas. Edição exige STORE_MANAGER+.
 */
@ApiTags('site')
@Controller('site')
@Roles(Role.STORE_MANAGER)
export class SiteController {
  constructor(
    private readonly site: SiteService,
    private readonly ctx: TenantContext,
  ) {}

  // ── Branding / definições ──────────────────────────────────
  @Get('settings')
  @ApiOperation({ summary: 'Definições de branding/white-label da loja' })
  getSettings() {
    return this.site.getSettings(this.ctx.requireTenantSchema());
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Actualiza o branding/white-label da loja' })
  updateSettings(@Body() dto: UpdateSiteSettingsDto) {
    return this.site.updateSettings(this.ctx.requireTenantSchema(), dto);
  }

  // ── Páginas (editor de blocos) ──────────────────────────────
  @Get('pages')
  @ApiOperation({ summary: 'Lista todas as páginas do site' })
  listPages() {
    return this.site.listPages(this.ctx.requireTenantSchema());
  }

  @Get('pages/:id')
  @ApiOperation({ summary: 'Detalhe de uma página' })
  getPage(@Param('id') id: string) {
    return this.site.getPage(this.ctx.requireTenantSchema(), id);
  }

  @Post('pages')
  @ApiOperation({ summary: 'Cria uma página no editor de blocos' })
  createPage(@Body() dto: CreatePageDto) {
    return this.site.createPage(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('pages/:id')
  @ApiOperation({ summary: 'Actualiza uma página' })
  updatePage(@Param('id') id: string, @Body() dto: UpdatePageDto) {
    return this.site.updatePage(this.ctx.requireTenantSchema(), id, dto);
  }

  @Delete('pages/:id')
  @ApiOperation({ summary: 'Elimina uma página' })
  deletePage(@Param('id') id: string) {
    return this.site.deletePage(this.ctx.requireTenantSchema(), id);
  }
}
