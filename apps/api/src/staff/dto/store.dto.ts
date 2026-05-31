import { IsBoolean, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateStoreDto {
  @IsString()
  @Matches(/^[A-Za-z0-9-]{2,20}$/, { message: 'Código inválido (2-20: letras, números, hífen).' })
  code!: string;

  @IsString()
  @Length(2, 120)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateStoreDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(0, 240)
  address?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
