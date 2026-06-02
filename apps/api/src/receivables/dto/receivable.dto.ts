import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

const METHODS = ['CASH', 'TRANSFER', 'REFERENCE', 'CARD', 'EXPRESS'] as const;

/** Criação manual de uma conta a receber (dívida fora do POS). */
export class CreateReceivableDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  @Length(1, 200)
  customerName!: string;

  @IsNumber()
  @Min(0.01)
  amount!: number;

  /** Vencimento (YYYY-MM-DD). Por omissão, +30 dias. */
  @IsOptional()
  @IsString()
  dueDate?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  notes?: string;
}

/** Registo de um pagamento (gera recibo RC). */
export class RecordPaymentDto {
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
