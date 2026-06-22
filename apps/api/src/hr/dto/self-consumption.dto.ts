import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsNumber, IsPositive, IsUUID, ValidateNested } from 'class-validator';

export class RegisterConsumptionDto {
  @ApiProperty({ description: 'ID do produto consumido' })
  @IsUUID()
  productId!: string;

  @ApiProperty({ description: 'Quantidade consumida', example: 1 })
  @IsNumber()
  @IsPositive()
  quantity!: number;
}

export class RegisterConsumptionsDto {
  @ApiProperty({ description: 'Itens consumidos (vários produtos)', type: [RegisterConsumptionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => RegisterConsumptionDto)
  items!: RegisterConsumptionDto[];
}
