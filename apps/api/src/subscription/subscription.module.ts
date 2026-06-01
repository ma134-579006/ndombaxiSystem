import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { SubscriptionService } from './subscription.service';
import {
  SubscriptionAdminController,
  SubscriptionController,
} from './subscription.controller';

@Module({
  imports: [PaymentsModule],
  controllers: [SubscriptionController, SubscriptionAdminController],
  providers: [SubscriptionService],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
