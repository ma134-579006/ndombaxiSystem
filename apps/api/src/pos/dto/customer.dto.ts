import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/**
 * NIF, BI ou passaporte: 5 a 32 caracteres, a começar e a acabar em letra ou dígito
 * (aceita espaços, pontos, hífens e barras no meio). "abc" não é identificação fiscal.
 */
const TAX_ID = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{3,30}[A-Za-z0-9]$/;
const TAX_ID_MSG = { message: 'NIF inválido: 5 a 32 letras ou dígitos.' };

export class CreateCustomerDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Matches(TAX_ID, TAX_ID_MSG)
  taxId?: string;

  // Sem o trim, um nome só com espaços passava no comprimento mínimo.
  @Transform(trim)
  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsEmail()
  @Length(3, 200)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(0, 40)
  phone?: string;

  // Sem limite, aceitava-se um campo de vários MB.
  @IsOptional()
  @IsString()
  @Length(0, 500)
  address?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @Transform(trim) @IsString() @Matches(TAX_ID, TAX_ID_MSG) taxId?: string;
  @IsOptional() @Transform(trim) @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsEmail() @Length(3, 200) email?: string;
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 500) address?: string;
  @IsOptional() @IsString() @Length(0, 80) province?: string;
  @IsOptional() @IsString() @Length(0, 80) municipality?: string;
}
