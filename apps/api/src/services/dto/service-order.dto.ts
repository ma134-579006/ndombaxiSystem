import { IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class CreateServiceOrderDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() @Length(1, 120) customerName?: string;
  @IsOptional() @IsString() @Length(1, 40) customerPhone?: string;
  @IsOptional() @IsString() equipmentId?: string;
  @IsOptional() @IsString() @Length(1, 20) equipmentType?: string;
  @IsOptional() @IsString() @Length(1, 120) equipmentLabel?: string;
  @IsOptional() @IsString() @Length(1, 80) equipmentRef?: string;
  @IsOptional() @IsString() @Length(1, 2000) problem?: string;
  @IsOptional() @IsString() @Length(1, 120) assignedTo?: string;
  @IsOptional() @IsInt() @IsIn([0, 90, 180, 365]) warrantyDays?: number;
}

export class CreateEquipmentDto {
  @IsOptional() @IsString() customerId?: string;
  @IsOptional() @IsString() @Length(1, 120) customerName?: string;
  @IsOptional() @IsString() @IsIn(['VEHICLE', 'DEVICE', 'OTHER']) kind?: string;
  @IsString() @Length(1, 120) label!: string;
  @IsOptional() @IsString() @Length(1, 60) brand?: string;
  @IsOptional() @IsString() @Length(1, 60) model?: string;
  @IsOptional() @IsString() @Length(1, 60) serial?: string;
  @IsOptional() @IsString() @Length(1, 20) plate?: string;
  @IsOptional() @IsString() @Length(1, 40) vin?: string;
  @IsOptional() @IsString() @Length(1, 30) color?: string;
  @IsOptional() @IsInt() year?: number;
  @IsOptional() @IsInt() @Min(0) km?: number;
  @IsOptional() @IsInt() @Min(0) nextServiceKm?: number;
  @IsOptional() @IsString() @Length(1, 500) notes?: string;
}

export class UpdateEquipmentDto {
  @IsOptional() @IsInt() @Min(0) km?: number;
  @IsOptional() @IsInt() @Min(0) nextServiceKm?: number;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;
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
  @IsOptional() @IsInt() @IsIn([0, 90, 180, 365]) warrantyDays?: number;
}

export class ServiceStatusDto {
  @IsString() status!: string;
}
