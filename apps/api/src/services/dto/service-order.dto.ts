import { IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, Length, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

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

// ── MECÂNICA (oficina auto) — receção do veículo, orçamento, tempos, agenda ──
export class ChecklistItemDto {
  @IsString() @Length(1, 60) key!: string;
  @IsString() @Length(1, 80) label!: string;
  @IsOptional() ok?: boolean;
  @IsOptional() @IsString() @Length(0, 200) note?: string;
}
export class ReceptionPhotoDto {
  @IsString() @Length(1, 2_000_000) url!: string; // data URL ou URL
  @IsOptional() @IsString() @Length(0, 120) caption?: string;
}
export class ReceiveVehicleDto {
  @IsOptional() @IsInt() @Min(0) kmIn?: number;
  @IsOptional() @IsString() @IsIn(['EMPTY', 'LOW', 'HALF', 'HIGH', 'FULL']) fuelLevel?: string;
  @IsOptional() @IsString() @Length(0, 2000) vehicleState?: string;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ChecklistItemDto) checklist?: ChecklistItemDto[];
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReceptionPhotoDto) photos?: ReceptionPhotoDto[];
  @IsOptional() @IsString() @Length(0, 2_000_000) signature?: string; // data URL
  @IsOptional() @IsInt() @Min(0) estMinutes?: number;
  @IsOptional() @IsString() scheduledAt?: string; // ISO
}
export class ScheduleDto {
  @IsOptional() @IsString() scheduledAt?: string; // ISO; vazio/omitido → remove marcação
}
export class ApproveQuoteDto {
  @IsOptional() @IsString() @Length(0, 120) approvedBy?: string;
}
