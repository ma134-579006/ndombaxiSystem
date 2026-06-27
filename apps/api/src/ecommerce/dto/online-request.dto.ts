import { IsEmail, IsInt, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

/** Reserva de quarto feita pelo cliente na loja online (vertical Hotelaria). */
export class OnlineReservationDto {
  @IsString() roomId!: string;
  @IsOptional() @IsString() @Length(1, 120) guestName?: string;
  @IsOptional() @IsString() @Length(1, 40) guestPhone?: string;
  @IsOptional() @IsEmail() guestEmail?: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de entrada inválida.' }) checkIn!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Data de saída inválida.' }) checkOut!: string;
  @IsOptional() @IsInt() @Min(1) guests?: number;
}

/** Marcação de consulta feita pelo paciente na loja online (vertical Clínica). */
export class OnlineAppointmentDto {
  @IsString() @Length(1, 120) patientName!: string;
  @IsOptional() @IsString() @Length(1, 40) patientPhone?: string;
  @IsOptional() @IsEmail() patientEmail?: string;
  @IsOptional() @IsString() @Length(1, 120) professional?: string;
  @IsString() scheduledAt!: string;            // ISO timestamp
  @IsOptional() @IsString() @Length(1, 300) reason?: string;
}

/** Pedido de serviço/orçamento feito pelo cliente na loja online (vertical Serviços). */
export class OnlineServiceRequestDto {
  @IsOptional() @IsString() @Length(1, 120) customerName?: string;
  @IsOptional() @IsString() @Length(1, 40) customerPhone?: string;
  @IsOptional() @IsEmail() customerEmail?: string;
  @IsOptional() @IsString() equipmentType?: string;     // VEHICLE | DEVICE | OTHER
  @IsOptional() @IsString() @Length(1, 120) equipmentLabel?: string;
  @IsOptional() @IsString() @Length(1, 60) equipmentRef?: string;
  @IsString() @Length(3, 1000) problem!: string;        // descrição do que precisa
}
