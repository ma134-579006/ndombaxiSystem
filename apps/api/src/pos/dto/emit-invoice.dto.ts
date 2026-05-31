import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
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

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => EmitInvoiceLineDto)
  lines!: EmitInvoiceLineDto[];
}
