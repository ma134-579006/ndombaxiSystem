import { IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateServiceOrderDto {
  @IsOptional() @IsString() @Length(1, 120) customerName?: string;
  @IsOptional() @IsString() @Length(1, 40) customerPhone?: string;
  @IsOptional() @IsString() @Length(1, 20) equipmentType?: string;
  @IsOptional() @IsString() @Length(1, 120) equipmentLabel?: string;
  @IsOptional() @IsString() @Length(1, 80) equipmentRef?: string;
  @IsOptional() @IsString() @Length(1, 2000) problem?: string;
  @IsOptional() @IsString() @Length(1, 120) assignedTo?: string;
}

export class AddServiceItemDto {
  @IsOptional() @IsString() kind?: string;        // PART | LABOR | SERVICE
  @IsOptional() @IsString() productCode?: string; // peça do stock
  @IsOptional() @IsString() @Length(1, 200) description?: string;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber() @Min(0.001) quantity?: number;
}

export class UpdateServiceOrderDto {
  @IsOptional() @IsString() @Length(0, 4000) diagnosis?: string;
  @IsOptional() @IsString() @Length(0, 120) assignedTo?: string;
  @IsOptional() @IsString() @Length(0, 2000) notes?: string;
}

export class ServiceStatusDto {
  @IsString() status!: string;
}
