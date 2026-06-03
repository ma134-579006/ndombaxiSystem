import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class CustomerEmailLoginDto {
  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
}

export class CustomerGoogleLoginDto {
  @IsString()
  @Length(10, 5000)
  idToken!: string;
}
