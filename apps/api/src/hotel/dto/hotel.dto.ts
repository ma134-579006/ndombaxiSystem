import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateRoomDto {
  @IsOptional() @IsString() @Length(1, 20) code?: string;
  @IsString() @Length(1, 60) name!: string;
  @IsOptional() @IsString() @Length(1, 40) roomType?: string;
  @IsOptional() @IsString() @Length(1, 20) category?: string;
  @IsOptional() @IsString() @Length(1, 10) floor?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
}

export class RoomStatusDto {
  @IsString() @Matches(/^(AVAILABLE|RESERVED|OCCUPIED|CLEANING|MAINTENANCE|BLOCKED)$/) status!: string;
}

export class CreateHousekeepingDto {
  @IsString() roomId!: string;
  @IsOptional() @IsString() @Matches(/^(CLEAN|CHANGE_LINEN|INSPECT)$/) task?: string;
  @IsOptional() @IsString() @Length(1, 80) assignedTo?: string;
  @IsOptional() @IsString() @Length(1, 200) notes?: string;
}

export class CreateMaintenanceDto {
  @IsString() roomId!: string;
  @IsString() @Length(2, 200) problem!: string;
  @IsOptional() @IsString() @Length(1, 80) assignedTo?: string;
}

export class StatusOnlyDto {
  @IsString() @Length(1, 30) status!: string;
}

export class CreateReservationDto {
  @IsString() roomId!: string;
  @IsOptional() @IsString() @Length(1, 120) guestName?: string;
  @IsOptional() @IsString() @Length(1, 40) guestPhone?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de entrada inválida.' }) checkIn!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de saída inválida.' }) checkOut!: string;
  @IsOptional() @IsInt() @Min(1) guests?: number;
}

export class FolioItemDto {
  @IsOptional() @IsString() productCode?: string;
  @IsOptional() @IsString() @Length(1, 200) description?: string;
  @IsOptional() @IsNumber() @Min(0) unitPrice?: number;
  @IsOptional() @IsNumber() @Min(0.001) quantity?: number;
}

export class ReservationStatusDto {
  @IsString() status!: string;
}
