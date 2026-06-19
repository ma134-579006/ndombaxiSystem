import { IsArray, IsInt, IsNumber, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

/** Bónus e faltas de UM trabalhador, definidos no momento do pagamento. */
export class PayrollEntryDto {
  @IsUUID()
  employeeId!: string;

  @IsOptional() @IsNumber() @Min(0)
  bonus?: number;

  @IsOptional() @IsNumber() @Min(0) @Max(31)
  absenceDays?: number;
}

/** Pedido de processamento de uma folha salarial mensal. */
export class ProcessPayrollDto {
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  /** Bónus/faltas por trabalhador, definidos AO PAGAR (não na ficha). */
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PayrollEntryDto)
  adjustments?: PayrollEntryDto[];
}

/** Override pontual de descontos extra por trabalhador nesta folha (opcional). */
export class PayrollAdjustmentDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherDeductions?: number;
}
