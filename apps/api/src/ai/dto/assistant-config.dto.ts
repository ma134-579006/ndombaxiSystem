import { IsBoolean, IsIn, IsOptional, IsString, Length } from 'class-validator';

export class UpdateAssistantConfigDto {
  @IsOptional()
  @IsString()
  @Length(1, 120)
  displayName?: string;

  @IsOptional()
  @IsString()
  @Length(1, 500)
  persona?: string;

  @IsOptional()
  @IsString()
  systemPrompt?: string;

  @IsOptional()
  @IsString()
  greeting?: string;

  @IsOptional()
  @IsString()
  locale?: string;

  @IsOptional()
  @IsBoolean()
  voiceEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  callEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  imageEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  chartsEnabled?: boolean;

  @IsOptional()
  @IsIn(['none', 'subtle', 'balanced', 'rich'])
  emojiLevel?: string;
}
