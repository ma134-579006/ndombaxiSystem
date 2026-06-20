import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CreateCustomerDto {
  @IsOptional()
  @IsString()
  @Length(1, 32)
  taxId?: string;

  @IsString()
  @Length(1, 200)
  name!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  address?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsString() @Length(1, 32) taxId?: string;
  @IsOptional() @IsString() @Length(1, 200) name?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() province?: string;
  @IsOptional() @IsString() municipality?: string;
}
