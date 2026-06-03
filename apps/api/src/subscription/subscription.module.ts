import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionService } from './subscription.service';
import {
  SubscriptionAdminController,
  SubscriptionController,
} from './subscription.controller';
import { SetupSubscriptionController } from './setup-subscription.controller';

@Module({
  imports: [PaymentsModule, JwtModule.register({})],
  controllers: [SubscriptionController, SubscriptionAdminController, SetupSubscriptionController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
