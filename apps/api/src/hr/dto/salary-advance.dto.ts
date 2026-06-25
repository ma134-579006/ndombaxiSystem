import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString, Length, Min } from 'class-validator';

export class RequestAdvanceDto {
  @ApiProperty({ description: 'Valor do adiantamento (1 Kz até ao salário)', example: 5000 })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({ required: false, description: 'Motivo (opcional)' })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  reason?: string;
}

export class ReviewAdvanceDto {
  @ApiProperty({ enum: ['APPROVED', 'REJECTED'] })
  @IsIn(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 300)
  note?: string;
}
