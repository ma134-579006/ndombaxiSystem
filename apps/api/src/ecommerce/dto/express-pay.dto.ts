import { IsOptional, IsString, Length } from 'class-validator';

/** Pagamento por Multicaixa Express (aprovação automática). */
export class ExpressPayDto {
  /** Número de telemóvel associado à conta Express. */
  @IsString()
  @Length(9, 20)
  expressPhone!: string;

  /** Referência/ID da operação Express (opcional). */
  @IsOptional()
  @IsString()
  reference?: string;
}
