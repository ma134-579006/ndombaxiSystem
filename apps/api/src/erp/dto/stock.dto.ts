import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

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

/** Entrada de stock em lote: dá entrada de N unidades a um custo unitário e
 *  (opcionalmente) actualiza o preço de venda. */
export class StockEntryDto {
  @IsString()
  productId!: string;

  @IsString()
  warehouseId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  /** Custo unitário (já calculado = custo total ÷ quantidade), em AOA. */
  @IsNumber()
  @Min(0)
  unitCost!: number;

  /** Novo preço de venda unitário (opcional). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  salePrice?: number;
}
