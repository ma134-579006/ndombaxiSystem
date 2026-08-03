import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
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

  /** Pagamento na caixa (para o turno). CREDIT = venda a crédito (fiado). */
  @IsOptional()
  @IsIn(['CASH', 'CARD', 'TRANSFER', 'REFERENCE', 'EXPRESS', 'CREDIT'])
  paymentType?: 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS' | 'CREDIT';

  /** Vencimento da dívida (venda a crédito). Por omissão, +30 dias. */
  @IsOptional()
  @IsString()
  dueDate?: string;

  /** Documento retroativo: data da compra ORIGINAL (YYYY-MM-DD). A data fiscal continua a ser hoje. */
  @IsOptional()
  @IsString()
  @Length(10, 10)
  operationDate?: string;

  /**
   * Chave de idempotência da venda (UUID gerado pelo POSTO, estável entre
   * tentativas). Fecha uma janela real de DUPLICAÇÃO FISCAL: o servidor grava a
   * fatura, a rede cai antes da resposta, o posto dá a venda como não emitida e
   * reenvia — sem esta chave nascia um SEGUNDO documento, com stock e dinheiro
   * em dobro. Com ela, o índice único `invoices_client_op_uidx` recusa a
   * segunda gravação e devolvemos a fatura original.
   */
  @IsOptional()
  @IsUUID()
  clientOpId?: string;

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

export class ReturnItemDto {
  @IsString()
  @Length(1, 64)
  productCode!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;
}

/** Devolução parcial: artigos/quantidades a devolver + motivo. */
export class ReturnItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnItemDto)
  items!: ReturnItemDto[];

  @IsString()
  @Length(1, 200)
  reason!: string;

  /**
   * Chave de idempotência da devolução (UUID estável entre tentativas). A
   * ANULAÇÃO já se protege sozinha pelo estado do documento; a devolução PARCIAL
   * não — repetir a mesma devolução por a resposta se ter perdido criava uma
   * SEGUNDA nota de crédito, com stock e dinheiro estornados em dobro.
   */
  @IsOptional()
  @IsUUID()
  clientOpId?: string;
}
