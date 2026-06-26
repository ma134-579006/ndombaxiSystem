import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/** Atualização do conteúdo da landing pública (tudo controlado pelo Super Admin). */
export class UpdateLandingDto {
  @IsOptional() @IsString() @Length(1, 120) brandName?: string;
  @IsOptional() @IsString() @Length(1, 200) heroTitle?: string;
  @IsOptional() @IsString() @Length(0, 400) heroSubtitle?: string;
  @IsOptional() @IsString() @Length(0, 60) heroCtaPrimary?: string;
  @IsOptional() @IsString() @Length(0, 60) heroCtaSecondary?: string;
  @IsOptional() @IsString() heroImageUrl?: string;
  /** Carrossel: lista de URLs/data-URIs de imagens de fundo (rodam sozinhas). */
  @IsOptional() @IsArray() @IsString({ each: true }) heroImages?: string[];
  @IsOptional() @IsInt() @Min(1000) heroIntervalMs?: number;
  @IsOptional() @IsHexColor() primaryColor?: string;
  @IsOptional() @IsHexColor() accentColor?: string;
  /** [{icon,title,text}] */
  @IsOptional() @IsArray() features?: unknown[];
  /** [{title,text,imageUrl,ctaLabel,ctaUrl,active}] */
  @IsOptional() @IsArray() ads?: unknown[];
  @IsOptional() @IsString() @Length(0, 300) footerText?: string;
  @IsOptional() @IsString() contactEmail?: string;
  @IsOptional() @IsString() contactPhone?: string;
  @IsOptional() @IsBoolean() showPricing?: boolean;
  @IsOptional() @IsBoolean() showAds?: boolean;
  @IsOptional() @IsInt() @Min(1) trialDays?: number;
}

/** Atualização de um plano (preço em Kz + apresentação) pelo Super Admin. */
export class UpdatePlanDto {
  @IsOptional() @IsString() @Length(1, 80) name?: string;
  @IsOptional() @IsInt() @Min(0) priceKz?: number;
  @IsOptional() @IsInt() @Min(0) durationMonths?: number;
  @IsOptional() @IsInt() @Min(0) durationDays?: number;
  @IsOptional() @IsString() @Length(0, 120) tagline?: string;
  @IsOptional() @IsBoolean() highlight?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isPublic?: boolean;
  @IsOptional() @IsInt() maxStores?: number;
  @IsOptional() @IsInt() maxUsers?: number;
  @IsOptional() @IsInt() maxProducts?: number;
  @IsOptional() @IsInt() maxTxPerMonth?: number;
  @IsOptional() @IsArray() @IsString({ each: true }) modules?: string[];
}
