import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { IvaCode } from '@nexus/agt-xml';

/** Códigos de IVA aceites nos formulários: os da AGT + 'AUTO' (usa o IVA
 *  padrão configurado pelo gestor em Configurações). */
const IVA_CHOICES = [...Object.values(IvaCode), 'AUTO'] as const;

export class CreateProductDto {
  /** Código de barras / código do produto. OPCIONAL — vazio gera um EAN-13
   *  interno automaticamente. */
  @IsOptional()
  @IsString()
  @Length(1, 64)
  code?: string;

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

  @IsOptional()
  @IsString()
  @Length(0, 80)
  brand?: string;

  @IsIn(IVA_CHOICES as unknown as string[])
  ivaCode!: IvaCode | 'AUTO';

  /** Motivo de isenção (obrigatório por lei p/ IVA ISE/OUT). */
  @IsOptional()
  @IsString()
  @Length(0, 200)
  exemptionReason?: string;

  /** Código AGT do motivo de isenção (opcional). */
  @IsOptional()
  @IsString()
  @Length(0, 20)
  exemptionCode?: string;

  /** Preço unitário NET (sem IVA), em AOA. Definido na Entrada de stock. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  /** Custo unitário (para cálculo de lucro), em AOA. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  costPrice?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  stockQty?: number;

  /** Lojas onde o produto existe (vazio = todas as lojas). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  storeIds?: string[];

  /** TRUE = stock central partilhado (vendível por qualquer loja do mesmo pool).
   *  FALSE/omisso = stock por loja (cada loja gere o seu saldo). */
  @IsOptional()
  @IsBoolean()
  sharedStock?: boolean;

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

  /** TRUE = ingrediente/matéria-prima: não se vende no caixa nem na loja; só para
   *  a ficha técnica dos pratos (restauração). */
  @IsOptional()
  @IsBoolean()
  isIngredient?: boolean;

  /** Unidade de medida (un, kg, g, L, ml, fatia, folha…). Informativa. */
  @IsOptional()
  @IsString()
  @Length(1, 16)
  unit?: string;
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
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsIn(IVA_CHOICES as unknown as string[])
  ivaCode?: IvaCode | 'AUTO';

  @IsOptional()
  @IsString()
  @Length(0, 80)
  brand?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  exemptionReason?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20)
  exemptionCode?: string;

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
  sharedStock?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Marcar/desmarcar como ingrediente (matéria-prima). */
  @IsOptional()
  @IsBoolean()
  isIngredient?: boolean;

  /** Unidade de medida (un, kg, g, L, ml, fatia, folha…). Informativa. */
  @IsOptional()
  @IsString()
  @Length(0, 16)
  unit?: string;
}
