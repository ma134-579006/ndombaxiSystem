import { IsNumber, IsOptional, IsString, Length } from 'class-validator';

/** Acerto manual de stock (inventário). A quantidade é o NOVO saldo absoluto. */
export class AdjustStockDto {
  @IsString()
  productId!: string;

  @IsString()
  warehouseId!: string;

  /** Novo saldo absoluto pretendido para o (produto, armazém). */
  @IsNumber()
  newQuantity!: number;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  reason?: string;
}
