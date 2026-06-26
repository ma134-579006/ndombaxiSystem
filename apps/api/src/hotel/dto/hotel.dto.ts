import { IsInt, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreateRoomDto {
  @IsOptional() @IsString() @Length(1, 20) code?: string;
  @IsString() @Length(1, 60) name!: string;
  @IsOptional() @IsString() @Length(1, 40) roomType?: string;
  @IsOptional() @IsInt() @Min(1) capacity?: number;
  @IsOptional() @IsNumber() @Min(0) rate?: number;
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
