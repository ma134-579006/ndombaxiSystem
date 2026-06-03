import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { PosModule } from '../pos/pos.module';
import { SiteModule } from '../site/site.module';
import { StorefrontController } from './storefront.controller';
import { OrdersController } from './orders.controller';
import { CustomerAuthService } from './customer-auth.service';
import { OrderChatService } from './order-chat.service';
import { StorefrontService } from './storefront.service';
import { OrdersService } from './orders.service';
import { TenantResolverService } from './tenant-resolver.service';

@Module({
  imports: [PosModule, SiteModule, PaymentsModule, AiModule, JwtModule.register({})],
  controllers: [StorefrontController, OrdersController],
  providers: [
    StorefrontService,
    OrdersService,
    OrderChatService,
    CustomerAuthService,
    TenantResolverService,
  ],
})
export class EcommerceModule {}
