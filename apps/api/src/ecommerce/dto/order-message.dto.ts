import { IsOptional, IsString, Length } from 'class-validator';

/** Mensagem na conversa de uma encomenda. */
export class PostMessageDto {
  @IsString()
  @Length(1, 2000)
  body!: string;

  /** Nome a apresentar (cliente convidado). */
  @IsOptional()
  @IsString()
  @Length(1, 120)
  senderName?: string;
}
