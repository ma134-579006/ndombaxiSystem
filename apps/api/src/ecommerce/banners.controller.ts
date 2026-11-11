import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { BannersService } from './banners.service';

export class BannerDto {
  @IsOptional() @IsString() @MaxLength(120) title?: string;
  @IsOptional() @IsString() @MaxLength(200) subtitle?: string | null;
  // Imagem enviada pelo painel (data URL, como nos produtos) ou ligação; limite generoso mas finito.
  @IsOptional() @IsString() @MaxLength(2_500_000) imageUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(300) linkUrl?: string | null;
  @IsOptional() @IsString() @MaxLength(40) buttonLabel?: string | null;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

/** Gestão dos anúncios (carrossel) da loja de associados. */
@ApiTags('ecommerce')
@Controller('ecommerce/banners')
export class BannersController {
  constructor(private readonly banners: BannersService, private readonly ctx: TenantContext) {}

  @Get()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Anúncios da loja de associados' })
  list() { return this.banners.list(this.ctx.requireTenantSchema()); }

  @Post()
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um anúncio' })
  create(@Body() dto: BannerDto) { return this.banners.create(this.ctx.requireTenantSchema(), dto); }

  @Patch(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Altera um anúncio' })
  update(@Param('id') id: string, @Body() dto: BannerDto) { return this.banners.update(this.ctx.requireTenantSchema(), id, dto); }

  @Delete(':id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina um anúncio' })
  remove(@Param('id') id: string) { return this.banners.remove(this.ctx.requireTenantSchema(), id); }
}
