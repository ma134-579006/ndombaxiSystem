import {
  IsArray,
  IsBoolean,
  IsHexColor,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/** Branding / definições visuais da montra (linha única por tenant, §8). */
export class UpdateSiteSettingsDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  brandName?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  tagline?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;

  @IsOptional()
  @IsString()
  faviconUrl?: string;

  @IsOptional()
  @IsHexColor()
  primaryColor?: string;

  @IsOptional()
  @IsHexColor()
  secondaryColor?: string;

  @IsOptional()
  @IsString()
  contactEmail?: string;

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  receiptMessage?: string;

  @IsOptional()
  @IsObject()
  social?: Record<string, string>;

  @IsOptional()
  @IsString()
  customCss?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

/** Página construída no editor de blocos. */
export class CreatePageDto {
  @IsString()
  @Length(1, 120)
  slug!: string;

  @IsString()
  @Length(1, 200)
  title!: string;

  @IsOptional()
  @IsArray()
  blocks?: unknown[];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;

  @IsOptional()
  @IsArray()
  blocks?: unknown[];

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}
