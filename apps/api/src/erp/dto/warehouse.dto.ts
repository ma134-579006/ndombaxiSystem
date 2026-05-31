import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class CreateWarehouseDto {
  @IsString()
  @Length(1, 64)
  code!: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsString()
  storeId?: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
