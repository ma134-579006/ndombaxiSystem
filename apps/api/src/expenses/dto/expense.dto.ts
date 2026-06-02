import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';

/** Categorias de despesa operacional (alinhadas com a UI do gestor). */
export const EXPENSE_CATEGORIES = [
  'RENDA',
  'SALARIOS',
  'ENERGIA',
  'AGUA',
  'FORNECEDORES',
  'TRANSPORTE',
  'MARKETING',
  'MANUTENCAO',
  'IMPOSTOS',
  'COMUNICACOES',
  'SEGURANCA',
  'OUTROS',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const PAYMENT_METHODS = ['CASH', 'TRANSFER', 'REFERENCE', 'CARD'] as const;

export class CreateExpenseDto {
  @IsIn(EXPENSE_CATEGORIES)
  category!: ExpenseCategory;

  /** Valor da despesa em AOA (sempre positivo). */
  @IsNumber()
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  supplier?: string;

  @IsOptional()
  @IsIn(PAYMENT_METHODS)
  paymentMethod?: (typeof PAYMENT_METHODS)[number];

  @IsOptional()
  @IsString()
  @Length(0, 120)
  documentRef?: string;

  /** Data da despesa (YYYY-MM-DD). Por omissão, hoje. */
  @IsOptional()
  @IsString()
  expenseDate?: string;
}
