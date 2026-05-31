import { Body, Controller, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { OnboardingService } from './onboarding.service';
import { RegisterCompanyDto } from './dto/register-company.dto';

@ApiTags('onboarding')
@Controller('onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Registo público de nova empresa (tenant)' })
  register(@Body() dto: RegisterCompanyDto) {
    return this.onboarding.register(dto);
  }
}
