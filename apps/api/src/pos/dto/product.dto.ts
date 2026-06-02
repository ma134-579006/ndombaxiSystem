import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { IvaCode } from '@nexus/agt-xml';

export class CreateProductDto {
  @IsString()
  @Length(1, 64)
  code!: string;

  @IsOptional()
  @IsString()
  @Length(1, 64)
  barcode?: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsEnum(IvaCode)
  ivaCode!: IvaCode;

  /** Preço unitário NET (sem IVA), em AOA. */
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  /** Custo unitário (para cálculo de lucro), em AOA. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;

  /** Imagem principal mostrada na loja online (URL ou data-URI base64). */
  @IsOptional()
  @IsString()
  imageUrl?: string;

  /** Galeria de imagens adicionais. */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gallery?: string[];

  /** Se o produto aparece na loja online (montra pública). */
  @IsOptional()
  @IsBoolean()
  showOnline?: boolean;
}

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(IvaCode)
  ivaCode?: IvaCode;

  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  gallery?: string[];

  @IsOptional()
  @IsBoolean()
  showOnline?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
