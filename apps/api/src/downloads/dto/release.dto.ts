import {
  IsArray, IsBoolean, IsInt, IsIn, IsOptional, IsString, Min,
} from 'class-validator';

const PLATFORMS = ['windows', 'android', 'android-loja', 'ios'] as const;

export class CreateReleaseDto {
  @IsIn(PLATFORMS)
  platform!: (typeof PLATFORMS)[number];

  @IsString()
  version!: string;

  @IsOptional() @IsString()
  minSupported?: string;

  @IsString()
  fileUrl!: string;

  @IsOptional() @IsString()
  downloadPageUrl?: string;

  @IsOptional() @IsInt() @Min(0)
  fileSize?: number;

  @IsOptional() @IsString()
  sha256?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  notes?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  fixes?: string[];

  @IsOptional() @IsString()
  requirements?: string;

  @IsOptional() @IsBoolean()
  mandatory?: boolean;

  @IsOptional() @IsBoolean()
  published?: boolean;

  @IsOptional() @IsString()
  releasedAt?: string;
}

/** Atualização parcial — todos os campos opcionais. */
export class UpdateReleaseDto {
  @IsOptional() @IsIn(PLATFORMS)
  platform?: (typeof PLATFORMS)[number];

  @IsOptional() @IsString()
  version?: string;

  @IsOptional() @IsString()
  minSupported?: string;

  @IsOptional() @IsString()
  fileUrl?: string;

  @IsOptional() @IsString()
  downloadPageUrl?: string;

  @IsOptional() @IsInt() @Min(0)
  fileSize?: number;

  @IsOptional() @IsString()
  sha256?: string;

  @IsOptional() @IsArray() @IsString({ each: true })
  notes?: string[];

  @IsOptional() @IsArray() @IsString({ each: true })
  fixes?: string[];

  @IsOptional() @IsString()
  requirements?: string;

  @IsOptional() @IsBoolean()
  mandatory?: boolean;

  @IsOptional() @IsBoolean()
  published?: boolean;

  @IsOptional() @IsString()
  releasedAt?: string;
}
