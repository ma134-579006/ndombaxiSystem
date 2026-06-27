import { IsIn, IsNumber, IsOptional, IsString, Length, Matches, Min } from 'class-validator';

export class CreatePatientDto {
  @IsString() @Length(1, 120) name!: string;
  @IsOptional() @IsString() @Length(1, 40) phone?: string;
  @IsOptional() @IsString() @Length(1, 20) nif?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) birthDate?: string;
  @IsOptional() @IsString() @IsIn(['M', 'F', 'O']) sex?: string;
  @IsOptional() @IsString() @Length(1, 5) bloodType?: string;
  @IsOptional() @IsString() @Length(1, 400) allergies?: string;
  @IsOptional() @IsString() @Length(1, 1000) notes?: string;
}

export class UpdatePatientDto {
  @IsOptional() @IsString() @Length(0, 40) phone?: string;
  @IsOptional() @IsString() @Length(0, 400) allergies?: string;
  @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @IsOptional() @IsString() @Length(0, 5) bloodType?: string;
}

export class CreateAppointmentDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() @Length(1, 120) patientName?: string;
  @IsOptional() @IsString() @Length(1, 120) professional?: string;
  @IsString() scheduledAt!: string;       // ISO timestamp
  @IsOptional() @IsString() @Length(1, 300) reason?: string;
}

export class StatusDto {
  @IsString() @Length(1, 20) status!: string;
}

export class CreateConsultationDto {
  @IsOptional() @IsString() appointmentId?: string;
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() @Length(1, 120) patientName?: string;
  @IsOptional() @IsString() @Length(1, 120) professional?: string;
  @IsOptional() @IsString() @Length(1, 2000) symptoms?: string;
  @IsOptional() @IsString() @Length(1, 2000) diagnosis?: string;
  @IsOptional() @IsString() @Length(1, 2000) prescription?: string;
  @IsOptional() @IsString() @Length(1, 2000) notes?: string;
  @IsOptional() @IsNumber() @Min(0) fee?: number;
}
