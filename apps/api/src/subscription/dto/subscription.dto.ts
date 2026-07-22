import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Min,
} from 'class-validator';
import { IsAngolaIban } from '../../common/validation/angola';

/** Conta bancária da plataforma (Super Admin). */
export class UpsertBankAccountDto {
  @IsString() @Length(1, 80) bankName!: string;
  @IsString() @Length(1, 120) accountHolder!: string;
  @IsString() @Length(8, 40) @IsAngolaIban() iban!: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsInt() sortOrder?: number;
}

/** Empresa cria uma subscrição (escolhe plano + método de pagamento). */
export class CreateSubscriptionDto {
  @IsString() planId!: string;
  @IsIn(['IBAN', 'REFERENCE']) method!: 'IBAN' | 'REFERENCE';
  /** Obrigatório quando method=IBAN: conta bancária escolhida. */
  @IsOptional() @IsString() bankAccountId?: string;
}

/** Empresa submete comprovativo (ficheiro base64). */
export class SubmitProofDto {
  @IsString() @Length(1, 200) fileName!: string;
  @IsString() @Length(1, 100) fileType!: string;
  // Limite alinhado com o cliente (4 MB) + inflacao ~34% do base64.
  @IsString() @Length(1, 6_000_000) fileData!: string; // base64 (sem prefixo data:)
  @IsOptional() @IsInt() @Min(0) amountKz?: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/** Super Admin revê (aprova/rejeita) o comprovativo. */
export class ReviewSubscriptionDto {
  @IsIn(['APPROVE', 'REJECT']) decision!: 'APPROVE' | 'REJECT';
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

/** Mensagem no chat da subscrição. */
export class PostSubMessageDto {
  @IsString() @Length(1, 1000) body!: string;
  @IsOptional() @IsString() @Length(0, 120) senderName?: string;
}

/** Criar subscrição na landing pós-registo (autorizado pelo setupToken). */
export class SetupCreateSubscriptionDto {
  @IsString() setupToken!: string;
  @IsString() planId!: string;
  @IsIn(['IBAN', 'REFERENCE']) method!: 'IBAN' | 'REFERENCE';
  @IsOptional() @IsString() bankAccountId?: string;
}

/** Enviar comprovativo na landing pós-registo (autorizado pelo setupToken). */
export class SetupProofDto {
  @IsString() setupToken!: string;
  @IsString() @Length(1, 200) fileName!: string;
  @IsString() @Length(1, 100) fileType!: string;
  @IsString() @Length(1, 6_000_000) fileData!: string;
  @IsOptional() @IsInt() @Min(0) amountKz?: number;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}
