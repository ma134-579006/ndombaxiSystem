import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
} from 'class-validator';
import { AI_ADAPTERS, AI_CAPABILITIES } from '../assistant-prompt';

export class CreateAiProviderDto {
  @IsString()
  @Length(1, 120)
  name!: string;

  @IsIn(AI_ADAPTERS as unknown as string[])
  adapter!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(AI_CAPABILITIES as unknown as string[], { each: true })
  capabilities!: string[];

  @IsUrl({ require_tld: false })
  baseUrl!: string;

  /** Chave da API em claro — encriptada antes de persistir; nunca devolvida. */
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  voice?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}

export class UpdateAiProviderDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  @IsOptional()
  @IsIn(AI_ADAPTERS as unknown as string[])
  adapter?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(AI_CAPABILITIES as unknown as string[], { each: true })
  capabilities?: string[];

  @IsOptional()
  @IsUrl({ require_tld: false })
  baseUrl?: string;

  /** Enviar nova chave (em claro) para rodar; omitir para manter a actual. */
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  model?: string;

  @IsOptional()
  @IsString()
  voice?: string;

  @IsOptional()
  @IsObject()
  headers?: Record<string, string>;

  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  priority?: number;
}
