import { ArrayMaxSize, IsArray, IsInt, IsNumber, IsOptional, IsString, Length, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTableDto {
  @IsOptional() @IsString() @Length(1, 20) code?: string;
  @IsString() @Length(1, 60) name!: string;
  @IsOptional() @IsString() @Length(1, 60) area?: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) seats?: number;
}

export class OpenOrderDto {
  @IsString() tableId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(50) guests?: number;
  @IsOptional() @IsString() @Length(1, 120) customerName?: string;
}

export class AddItemDto {
  @IsString() productCode!: string;
  @IsNumber() @Min(0.001) quantity!: number;
  @IsOptional() @IsString() @Length(1, 200) notes?: string;
}

export class KitchenStatusDto {
  @IsString() status!: string; // PENDING | PREPARING | READY | SERVED
}

export class CloseOrderDto {
  @IsOptional() @IsString() chargeToReservationId?: string;
}

export class RecipeItemDto {
  @IsString() ingredientCode!: string;
  @IsNumber() @Min(0.001) quantity!: number;
}

export class SetRecipeDto {
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => RecipeItemDto)
  items!: RecipeItemDto[];
}
