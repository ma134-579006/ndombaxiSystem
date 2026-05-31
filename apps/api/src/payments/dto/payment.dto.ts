import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { PAYMENT_METHOD_TYPES, type PaymentMethodType } from '../payment-methods';

/** Método de pagamento configurado pelo gestor da loja (§8). */
export class CreatePaymentMethodDto {
  @IsIn(PAYMENT_METHOD_TYPES as unknown as string[])
  type!: PaymentMethodType;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  label?: string;

  @IsOptional()
  @IsString()
  instructions?: string;

  @IsOptional()
  @IsString()
  bankName?: string;

  @IsOptional()
  @IsString()
  iban?: string;

  @IsOptional()
  @IsString()
  accountHolder?: string;

  @IsOptional()
  @IsString()
  referenceEntity?: string;

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  expressPhone?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class UpdatePaymentMethodDto extends CreatePaymentMethodDto {}

/** Comprovativo enviado pelo cliente na montra pública. */
export class UploadProofDto {
  @IsOptional()
  @IsString()
  methodType?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  reference?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsString()
  fileMime?: string;

  @IsOptional()
  @IsString()
  fileUrl?: string;

  /** Conteúdo do comprovativo em base64 (alternativa a fileUrl). */
  @IsOptional()
  @IsString()
  fileData?: string;
}

/** Revisão do comprovativo pelo gestor. */
export class ReviewProofDto {
  @IsIn(['APPROVED', 'REJECTED'])
  status!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  note?: string;
}
