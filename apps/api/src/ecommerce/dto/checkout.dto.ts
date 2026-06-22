import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEmail,
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
  quantity!: number;
}

export class CustomerLocationDto {
  @IsNumber()
  @Min(-90)
  lat!: number;

  @IsNumber()
  @Min(-180)
  lng!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  accuracy?: number;
}

export class CheckoutDto {
  @IsString()
  @Length(1, 200)
  customerName!: string;

  @IsOptional()
  @IsEmail()
  customerEmail?: string;

  @IsOptional()
  @IsString()
  customerPhone?: string;

  /** NIF do cliente (opcional; necessário p/ factura com contribuinte). */
  @IsOptional()
  @IsString()
  @Length(1, 32)
  customerTaxId?: string;

  @IsOptional()
  @IsString()
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
  paymentMethod?: string;

  /** Localização GPS do cliente (entrega) — capturada no checkout. */
  @IsOptional()
  @IsNumber()
  @Min(-90)
  geoLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
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
  @ValidateNested({ each: true })
  @Type(() => CheckoutLineDto)
  lines!: CheckoutLineDto[];
}
