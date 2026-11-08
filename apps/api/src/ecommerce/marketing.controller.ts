import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../rbac/roles.enum';
import { TenantContext } from '../tenancy/tenant-context';
import { MarketingService } from './marketing.service';

export class CouponDto {
  @IsOptional() @IsString() @MaxLength(32) code?: string;
  @IsOptional() @IsIn(['PERCENT', 'AMOUNT']) type?: 'PERCENT' | 'AMOUNT';
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) value?: number;
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) minOrder?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxUses?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) perCustomer?: number;
  @IsOptional() @IsString() startsAt?: string | null;
  @IsOptional() @IsString() endsAt?: string | null;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ReviewHiddenDto {
  @IsBoolean() hidden!: boolean;
}

/** Gestão da loja online: cupões e moderação de avaliações. */
@ApiTags('ecommerce')
@Controller('ecommerce')
export class MarketingController {
  constructor(private readonly mk: MarketingService, private readonly ctx: TenantContext) {}

  @Get('coupons')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cupões da loja online (com nº de usos)' })
  coupons() {
    return this.mk.listCoupons(this.ctx.requireTenantSchema());
  }

  @Post('coupons')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Cria um cupão' })
  create(@Body() dto: CouponDto) {
    return this.mk.createCoupon(this.ctx.requireTenantSchema(), dto);
  }

  @Patch('coupons/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Altera um cupão (o código não muda)' })
  update(@Param('id') id: string, @Body() dto: CouponDto) {
    const { code: _ignored, ...rest } = dto;
    return this.mk.updateCoupon(this.ctx.requireTenantSchema(), id, rest);
  }

  @Delete('coupons/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Elimina um cupão' })
  remove(@Param('id') id: string) {
    return this.mk.removeCoupon(this.ctx.requireTenantSchema(), id);
  }

  @Get('reviews')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Avaliações dos produtos (incluindo ocultas)' })
  reviews() {
    return this.mk.listReviews(this.ctx.requireTenantSchema());
  }

  @Patch('reviews/:id')
  @Roles(Role.STORE_MANAGER)
  @ApiOperation({ summary: 'Oculta ou volta a mostrar uma avaliação' })
  hide(@Param('id') id: string, @Body() dto: ReviewHiddenDto) {
    return this.mk.setReviewHidden(this.ctx.requireTenantSchema(), id, dto.hidden);
  }
}
