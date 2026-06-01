import { Module } from '@nestjs/common';
import { LandingService } from './landing.service';
import { PlatformDashboardService } from './platform-dashboard.service';
import {
  LandingAdminController,
  PlatformDashboardController,
  PublicLandingController,
} from './landing.controller';

@Module({
  controllers: [PublicLandingController, LandingAdminController, PlatformDashboardController],
  providers: [LandingService, PlatformDashboardService],
  exports: [LandingService],
})
export class LandingModule {}
