import { IsString, Length } from 'class-validator';

export class SendChatDto {
  @IsString()
  @Length(1, 2000)
  body!: string;
}
