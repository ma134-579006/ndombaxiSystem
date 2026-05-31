import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

export class ChatMessageDto {
  @IsIn(['user', 'assistant', 'system'])
  role!: 'user' | 'assistant' | 'system';

  @IsString()
  @Length(1, 8000)
  content!: string;
}

export class ChatDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ChatMessageDto)
  messages!: ChatMessageDto[];

  /** Canal: ajusta o tom (chat=Markdown rico, voice=conversacional). */
  @IsOptional()
  @IsIn(['chat', 'voice', 'call'])
  channel?: 'chat' | 'voice' | 'call';
}

export class TtsDto {
  @IsString()
  @Length(1, 4000)
  text!: string;

  @IsOptional()
  @IsString()
  voice?: string;
}

export class SttDto {
  /** Áudio em base64 (ex.: do microfone do browser). */
  @IsString()
  audioBase64!: string;

  @IsOptional()
  @IsString()
  mimeType?: string;
}

export class ImageDto {
  @IsString()
  @Length(1, 2000)
  prompt!: string;

  @IsOptional()
  @IsString()
  size?: string;
}
