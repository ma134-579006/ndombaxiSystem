import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

/** Abertura de turno de caixa. */
export class OpenSessionDto {
  @IsOptional() @IsString() registerCode?: string;
  @IsOptional() @IsString() storeId?: string;
  @IsNumber() @Min(0) openingFloat!: number; // fundo de troco inicial
}

/** Movimento manual de dinheiro: reforço (CASH_IN) ou sangria (CASH_OUT). */
export class CashMovementDto {
  @IsIn(['CASH_IN', 'CASH_OUT']) type!: 'CASH_IN' | 'CASH_OUT';
  @IsNumber() @Min(0) amount!: number;
  @IsOptional() @IsString() @Length(0, 200) reference?: string;
}

/** Fecho de turno: o operador conta o dinheiro físico. */
export class CloseSessionDto {
  @IsNumber() @Min(0) countedCash!: number; // valor em físico contado
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

/** Iniciar uma contagem de inventário. */
export class CreateCountDto {
  @IsString() warehouseId!: string;
  @IsOptional() @IsString() notes?: string;
}

/** Registar a contagem física de um item. */
export class CountItemDto {
  @IsString() productId!: string;
  @IsNumber() @Min(0) countedQty!: number;
}

/** Baixa de stock (quebra/perda/avaria). */
export class StockWriteOffDto {
  @IsString() productId!: string;
  @IsString() warehouseId!: string;
  @IsNumber() @Min(0.001) quantity!: number; // quantidade a abater (positiva)
  @IsString() @Length(1, 200) reason!: string; // motivo obrigatório
}
