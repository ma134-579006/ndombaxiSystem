import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Length,
  Matches,
} from 'class-validator';

export class PlatformLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  twoFaToken?: string;
}

export class TenantLoginDto {
  /** Código curto da empresa (também via header X-Tenant-Code). */
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9-]{2,40}$/)
  companyCode?: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;

  @IsOptional()
  @IsString()
  @Length(6, 6)
  twoFaToken?: string;
}

export class RefreshDto {
  @IsString()
  @IsNotEmpty()
  refreshToken!: string;
}

export class EnableTwoFaDto {
  @IsString()
  @Length(6, 6)
  token!: string;
}

export class UpdateThemeDto {
  /** Id do tema (vazio = padrão). Validado/whitelisted no serviço. */
  @IsString()
  @Matches(/^[a-z]{0,16}$/)
  theme!: string;
}
