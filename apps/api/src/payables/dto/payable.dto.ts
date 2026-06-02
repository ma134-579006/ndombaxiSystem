import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

const METHODS = ['CASH', 'TRANSFER', 'REFERENCE', 'CARD', 'EXPRESS'] as const;

/** Criação de uma conta a pagar (dívida a fornecedor). */
export class CreatePayableDto {
  @IsOptional()
  @IsString()
  supplierId?: string;

  @IsString()
  @Length(1, 200)
  supplierName!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  reference?: string;

  /** Vencimento (YYYY-MM-DD). Por omissão, +30 dias. */
  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;
}

/** Registo de um pagamento ao fornecedor (gera comprovativo PG). */
export class RecordPayablePaymentDto {
  @IsNumber()
  @Min(0.01)
  amount!: number;

  @IsOptional()
  @IsIn(METHODS)
  method?: (typeof METHODS)[number];

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;
}
