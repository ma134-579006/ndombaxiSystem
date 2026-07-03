import { IsIn, IsNumber, IsOptional, IsString, IsUUID, Length, Min } from 'class-validator';

/** Pedido de transferência entre lojas (workflow com aprovação). */
export class CreateTransferRequestDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  fromStoreId!: string;

  @IsUUID()
  toStoreId!: string;

  @IsNumber()
  @Min(0.001)
  quantity!: number;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}

export class RejectTransferDto {
  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}

/** Localização física do produto numa loja (corredor/prateleira). */
export class SetLocationDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  storeId!: string;

  /** Vazio/omisso limpa a localização. */
  @IsOptional()
  @IsString()
  @Length(0, 120)
  location?: string;
}

export class ValuationQueryDto {
  @IsOptional()
  @IsIn(['FIFO', 'LIFO', 'CMP'])
  method?: 'FIFO' | 'LIFO' | 'CMP';
}
