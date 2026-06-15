import { Body, Controller, Get, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../auth/decorators/roles.decorator';
import { Role } from '../../rbac/roles.enum';
import { MailService } from './mail.service';

class MailConfigDto {
  @IsOptional() @IsString() @Length(0, 200) host?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsBoolean() secure?: boolean;
  @IsOptional() @IsString() @Length(0, 200) username?: string;
  /** Vazio → remove a password; ausente → mantém a atual. */
  @IsOptional() @IsString() @Length(0, 300) password?: string;
  @IsOptional() @IsString() @Length(0, 200) fromAddr?: string;
  @IsOptional() @IsBoolean() enabled?: boolean;
}

class MailTestDto {
  @IsEmail() to!: string;
}

/** Configuração de e-mail (SMTP) gerida pelo Super Admin. */
@ApiTags('super-admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPER_ADMIN)
@Controller('super-admin/mail')
export class MailAdminController {
  constructor(private readonly mail: MailService) {}

  @Get()
  @ApiOperation({ summary: 'Configuração SMTP atual (sem expor a password)' })
  get() {
    return this.mail.getConfig();
  }

  @Put()
  @ApiOperation({ summary: 'Guarda a configuração SMTP (password encriptada)' })
  save(@Body() dto: MailConfigDto) {
    return this.mail.saveConfig(dto);
  }

  @Post('test')
  @ApiOperation({ summary: 'Envia um e-mail de teste' })
  test(@Body() dto: MailTestDto) {
    return this.mail.sendTest(dto.to);
  }
}
