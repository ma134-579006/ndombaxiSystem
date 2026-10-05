import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  Matches,
  Max,
  MaxLength,
  IsOptional,
  IsString,
  Length,
  Min,
  IsNumber,
  ValidateNested,
} from 'class-validator';

export class CheckoutLineDto {
  @IsString()
  @Length(1, 64)
  productCode!: string;

  @IsNumber()
  @Min(0.001)
  @Max(100_000)
  quantity!: number;
}

export class VisualSearchDto {
  /** Imagem em base64 (data-URI ou só o base64). */
  @IsString()
  @Length(16, 12_000_000)
  imageBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class CustomerLocationDto {
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  @Max(180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

export class CheckoutDto {
  @IsString()
  @Length(1, 200)
  @Matches(/\S/, { message: 'Indique o nome do cliente.' })
  customerName!: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  customerPhone?: string;

  /** NIF do cliente (opcional; necessário p/ factura com contribuinte). */
  @IsOptional()
  @IsString()
  @Matches(/^[0-9A-Za-z]{5,20}$/, { message: 'NIF inválido (apenas letras e números, 5 a 20 caracteres).' })
  customerTaxId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(400)
  shippingAddress?: string;

  /** Província (ex.: Luanda). */
  @IsString()
  @Length(1, 80)
  province!: string;

  /** Município (ex.: Belas). */
  @IsString()
  @Length(1, 80)
  municipality!: string;

  /** Bairro (ex.: Talatona). */
  @IsString()
  @Length(1, 120)
  neighborhood!: string;

  /** Forma de pagamento escolhida no checkout. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  paymentMethod?: string;

  /** Localização GPS do cliente (entrega) — capturada no checkout. */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  geoLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  geoLng?: number;

  /** Precisão do GPS em metros (quanto menor, mais exato). */
  @IsOptional()
  @IsNumber()
  @Min(0)
  geoAccuracy?: number;

  /** O cliente autorizou a partilha da localização para entrega. */
  @IsOptional()
  geoConsent?: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
}
