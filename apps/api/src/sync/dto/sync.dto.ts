import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsIn, IsInt, IsISO8601, IsObject, IsOptional,
  IsString, IsUUID, Max, Min, ValidateNested,
} from 'class-validator';

export class PullDto {
  /** Cursor opaco da descida anterior. Ausente = primeira sincronização. */
  @IsOptional()
  @IsString()
  since?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  entities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number;
}

export class PushOpItemDto {
  @IsUUID()
  opId!: string;

  @IsInt()
  @Min(0)
  seq!: number;

  @IsString()
  entity!: string;

  @IsIn(['create', 'update', 'delete'])
  op!: 'create' | 'update' | 'delete';

  @IsString()
  localId!: string;

  @IsObject()
  payload!: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  baseVersion?: number | null;

  @IsISO8601()
  createdAt!: string;
}

export class PushDto {
  /**
   * Teto de 200 operações por pedido. Um posto que esteve um mês offline sobe
   * em várias voltas em vez de num único pedido gigante que estoura o timeout
   * a meio e obriga a repetir tudo.
   */
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PushOpItemDto)
  ops!: PushOpItemDto[];
}
