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
}

export class CustomerGoogleLoginDto {
  @IsString()
  @Length(10, 5000)
  idToken!: string;
}
