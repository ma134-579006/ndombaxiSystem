import { ArrayMaxSize, IsArray, IsString, IsUUID, Length } from 'class-validator';

export class SendChatDto {
  @IsUUID()
  recipientId!: string;

  @IsString()
  @Length(1, 2000)
  body!: string;
}

export class ReadChatDto {
  @IsUUID()
  peerId!: string;
}

export class DeleteChatDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID('all', { each: true })
  ids!: string[];
}
