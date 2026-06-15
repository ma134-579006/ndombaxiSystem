import { IsOptional, IsString, Length } from 'class-validator';

/** Perfil do cliente da loja online (guardado para não repetir no checkout). */
export class CustomerProfileDto {
  @IsOptional() @IsString() @Length(0, 120)
  name?: string;

  @IsOptional() @IsString() @Length(0, 40)
  phone?: string;

  @IsOptional() @IsString() @Length(0, 300)
  address?: string;

  @IsOptional() @IsString() @Length(0, 60)
  province?: string;

  @IsOptional() @IsString() @Length(0, 60)
  municipality?: string;

  @IsOptional() @IsString() @Length(0, 80)
  neighborhood?: string;

  @IsOptional() @IsString() @Length(0, 30)
  taxId?: string;
}
