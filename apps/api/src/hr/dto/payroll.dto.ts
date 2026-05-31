import { IsInt, IsNumber, IsOptional, Max, Min } from 'class-validator';

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
}

/** Override pontual de descontos extra por trabalhador nesta folha (opcional). */
export class PayrollAdjustmentDto {
  @IsOptional()
  @IsNumber()
  @Min(0)
  otherDeductions?: number;
}
