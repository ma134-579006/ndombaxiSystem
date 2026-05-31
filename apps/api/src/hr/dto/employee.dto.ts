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
}
