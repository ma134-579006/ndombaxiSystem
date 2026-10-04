import { IsBoolean, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CustomerEmailLoginDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;

  /** TRUE = modo ENTRAR: exige conta existente (não cria nem altera nada). */
  @IsOptional()
  @IsBoolean()
  existing?: boolean;

  /** Código de 6 dígitos enviado para o email (obrigatório para entrar). */
  @IsOptional()
  @IsString()
  @Length(6, 6)
  code?: string;
}

export class CustomerGoogleLoginDto {
  @IsString()
  @Length(10, 5000)
  idToken!: string;
}
