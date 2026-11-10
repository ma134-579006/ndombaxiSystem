import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, ValidateIf, ValidateNested } from 'class-validator';

export class RegisterDeviceDto {
  @ApiProperty({
    description:
      'Identificador ESTÁVEL do posto, gerado uma vez no aparelho e guardado lá. '
      + 'Tem de sobreviver a reinícios e atualizações: se mudar, o posto recebe '
      + 'uma série nova e passa a ter duas cadeias fiscais.',
    example: '9f1c2a0e-4c3b-4a1e-9b77-2f0a6d8e51c4',
  })
  @IsString()
  @Length(8, 128)
  deviceKey!: string;

  @ApiProperty({ description: 'Nome legível do posto', example: 'Loja 1 — Caixa 2' })
  @IsString()
  @Length(1, 80)
  name!: string;

  @ApiProperty({ description: 'Plataforma', example: 'windows' })
  @IsString()
  @Length(1, 20)
  platform!: string;

  @ApiPropertyOptional({ description: 'Loja a que o posto pertence' })
  @IsOptional()
  @IsUUID()
  storeId?: string;
}

/** Definições da caixa (Admin → Lojas → Caixas). */
export class DeviceSettingsDto {
  @IsOptional() @IsIn(['FT', 'FS'])
  defaultDocType?: 'FT' | 'FS';

  @IsOptional() @IsBoolean()
  pricesWithTax?: boolean;

  @IsOptional() @IsBoolean()
  showReference?: boolean;

  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsIn(['80', '58'])
  paperWidth?: '80' | '58' | null;
}

export class UpdateDeviceDto {
  @ApiPropertyOptional({ description: 'Nome da caixa', example: 'Caixa principal' })
  @IsOptional() @IsString() @Length(1, 80)
  name?: string;

  @ApiPropertyOptional({ description: 'Loja da caixa (null = sem loja)' })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsUUID()
  storeId?: string | null;

  @ApiPropertyOptional({ type: DeviceSettingsDto })
  @IsOptional() @ValidateNested() @Type(() => DeviceSettingsDto)
  settings?: DeviceSettingsDto;
}
