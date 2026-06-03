import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import { OnboardingController } from './onboarding.controller';
import { OnboardingService } from './onboarding.service';
import { NifService } from './nif.service';

@Module({
  imports: [AuthModule, JwtModule.register({})],
  controllers: [OnboardingController],
  providers: [OnboardingService, NifService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
