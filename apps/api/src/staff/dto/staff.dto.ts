import { IsBoolean, IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateStaffDto {
  @IsString()
  @Length(2, 120)
  name!: string;

  @IsEmail()
  email!: string;

  /** Papel da empresa (validado no serviço — nunca SUPER_ADMIN). */
  @IsString()
  role!: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  /** Se ausente, é gerada uma palavra-passe temporária. */
  @IsOptional()
  @IsString()
  @Length(8, 72)
  password?: string;

  /** PIN de 6 dígitos para o POS (opcional). */
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O PIN deve ter exactamente 6 dígitos.' })
  pin?: string;
}

export class UpdateStaffDto {
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class ResetPasswordDto {
  /** Se ausente, é gerada uma palavra-passe temporária. */
  @IsOptional()
  @IsString()
  @Length(8, 72)
  password?: string;
}

export class SetPinDto {
  @IsString()
  @Matches(/^\d{6}$/, { message: 'O PIN deve ter exactamente 6 dígitos.' })
  pin!: string;
}
