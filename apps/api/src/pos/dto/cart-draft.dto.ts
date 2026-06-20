import { Type } from 'class-transformer';
import { IsArray, IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

export class CartDraftLineDto {
  @IsString()
  productId!: string;

  @IsNumber()
  @Min(0)
  quantity!: number;
}

/** Rascunho do carrinho de um operador (guardado no servidor, cross-device). */
export class SaveCartDraftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CartDraftLineDto)
  lines!: CartDraftLineDto[];

  @IsOptional()
  @IsString()
  customerId?: string | null;
}
