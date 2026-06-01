import { Module } from '@nestjs/common';
import { LandingService } from './landing.service';
import { LandingAdminController, PublicLandingController } from './landing.controller';

@Module({
  controllers: [PublicLandingController, LandingAdminController],
  providers: [LandingService],
  exports: [LandingService],
})
export class LandingModule {}
