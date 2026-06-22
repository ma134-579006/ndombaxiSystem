import { ArrayMaxSize, IsArray, IsString, IsUUID, Length } from 'class-validator';

export class StaffSendDto {
  @IsUUID()
  customerId!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class StaffReadDto {
  @IsUUID()
  customerId!: string;
}

export class StaffDeleteDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}
