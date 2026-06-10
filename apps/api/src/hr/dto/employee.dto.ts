import { IsDateString, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateEmployeeDto {
  @IsString()
  @Length(1, 32)
  employeeNumber!: string;

  @IsString()
  @Length(1, 200)
  fullName!: string;

  @IsOptional()
  @IsString()
  taxId?: string;

  @IsOptional()
  @IsString()
  inssNumber?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsDateString()
  hireDate?: string;

  @IsNumber()
  @Min(0)
  baseSalary!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxableAllowances?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  exemptAllowances?: number;

  @IsOptional()
  @IsString()
  iban?: string;

  /** Foto do funcionário (URL ou data-URI base64; qualquer formato de imagem). */
  @IsOptional()
  @IsString()
  photoUrl?: string;
}

export class UpdateEmployeeDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  fullName?: string;

  @IsOptional()
  @IsString()
  position?: string;

  @IsOptional()
  @IsString()
  department?: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  baseSalary?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  taxableAllowances?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  exemptAllowances?: number;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  /** Bónus mensal (Kz) — entra na folha como subsídio sujeito (INSS/IRT). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  bonus?: number;

  /** Dias de falta injustificada no mês. O desconto segue a Lei Geral do
   *  Trabalho: cada dia desconta o salário diário (base ÷ 30). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  absenceDays?: number;
}
