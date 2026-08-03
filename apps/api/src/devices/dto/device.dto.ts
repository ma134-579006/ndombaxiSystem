import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

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
