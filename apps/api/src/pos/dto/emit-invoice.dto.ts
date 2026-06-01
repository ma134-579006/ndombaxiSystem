import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { DocumentType } from '@nexus/agt-xml';

export class EmitInvoiceLineDto {
  @IsString()
  @Length(1, 64)
  productCode!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  /** Desconto de linha como fracção [0,1). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(0.9999)
  discountRate?: number;
}

export class EmitInvoiceDto {
  /** Tipo de documento fiscal (default FT). */
  @IsOptional()
  @IsEnum(DocumentType)
  docType?: DocumentType;

  /** Série fiscal (default "A"). */
  @IsOptional()
  @IsString()
  @Length(1, 5)
  series?: string;

  @IsOptional()
  @IsString()
  customerId?: string;

  /** Pagamento na caixa (para o turno). */
  @IsOptional()
  @IsIn(['CASH', 'CARD', 'TRANSFER', 'REFERENCE', 'EXPRESS'])
  paymentType?: 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS';

  /** Dinheiro entregue pelo cliente (numerário). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  tendered?: number;

  /** Troco devolvido. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  changeGiven?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EmitInvoiceLineDto)
  lines!: EmitInvoiceLineDto[];
}

/** Cancelamento de venda (emite nota de crédito). */
export class CancelInvoiceDto {
  @IsString()
  @Length(1, 200)
  reason!: string;
}
