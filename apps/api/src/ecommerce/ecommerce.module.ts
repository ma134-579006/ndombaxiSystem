import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { PosModule } from '../pos/pos.module';
import { SiteModule } from '../site/site.module';
import { StorefrontController } from './storefront.controller';
import { OrdersController } from './orders.controller';
import { OrderChatService } from './order-chat.service';
import { StorefrontService } from './storefront.service';
import { OrdersService } from './orders.service';
import { TenantResolverService } from './tenant-resolver.service';

@Module({
  imports: [PosModule, SiteModule, PaymentsModule, AiModule],
  controllers: [StorefrontController, OrdersController],
  providers: [StorefrontService, OrdersService, OrderChatService, TenantResolverService],
})
export class EcommerceModule {}
