import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsBoolean,
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

/** Parcela de um pagamento misto. */
export class PaymentPartDto {
  @IsIn(['CASH', 'CARD', 'TRANSFER', 'REFERENCE', 'EXPRESS'])
  type!: 'CASH' | 'CARD' | 'TRANSFER' | 'REFERENCE' | 'EXPRESS';

  @IsNumber()
  @Min(0.01)
  amount!: number;
}

export class EmitInvoiceDto {
  /** Tipo de documento fiscal (default FT). */
  @IsOptional()
  @IsEnum(DocumentType)
  docType?: DocumentType;

  /**
   * Série fiscal (default "A"). **Ignorada quando o posto está registado** — aí
   * manda a série do posto (ver `devices.service.ts`). Mantida para as
   * aplicações antigas, que ainda não se registam.
   */
  @IsOptional()
  @IsString()
  @Length(1, 5)
  series?: string;

  /**
   * Identificador estável deste posto. É por ele que o servidor sabe em que
   * série fiscal esta venda tem de entrar — o que impede duas caixas de
   * construírem cadeias de hash divergentes com a mesma numeração.
   */
  @IsOptional()
  @IsString()
  @Length(8, 128)
  deviceKey?: string;

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

  /**
   * Venda feita SEM REDE, a subir da fila do aparelho. A mercadoria já saiu da
   * loja: a nuvem não a pode recusar por "stock insuficiente" (o stock dela
   * podia estar desatualizado) — regista-a e o saldo fica negativo, à vista,
   * para ser acertado. Recusá-la deixava a venda presa no aparelho para sempre.
   */
  @IsOptional()
  @IsBoolean()
  offline?: boolean;

  /** Desconto manual (acima da promoção): PIN do supervisor/gerente que o aprova. */
  @IsOptional()
  @IsString()
  @Length(4, 12)
  approvalPin?: string;

  /** Dinheiro entregue pelo cliente (numerário). */
  /** PAGAMENTO MISTO (ex.: parte numerário + parte TPA): soma = total da venda. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @ValidateNested({ each: true })
  @Type(() => PaymentPartDto)
  payments?: PaymentPartDto[];

  /** Farmácia: nº da receita médica (exigido quando há medicamentos sujeitos a receita). */
  @IsOptional()
  @IsString()
  @Length(1, 60)
  prescriptionRef?: string;

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

/** PIN do supervisor/gerente que aprova um desconto manual no balcão. */
export class ApproveDiscountDto {
  @IsString()
  @Length(4, 12)
  pin!: string;
}
