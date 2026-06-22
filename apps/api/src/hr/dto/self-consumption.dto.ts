import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive, IsUUID } from 'class-validator';

export class RegisterConsumptionDto {
  @ApiProperty({ description: 'ID do produto consumido' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Quantidade consumida', example: 1 })
  @IsNumber()
  @IsPositive()
  quantity!: number;
}
