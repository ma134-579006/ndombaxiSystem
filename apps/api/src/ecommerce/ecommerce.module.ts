import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AiModule } from '../ai/ai.module';
import { PaymentsModule } from '../payments/payments.module';
import { PosModule } from '../pos/pos.module';
import { SiteModule } from '../site/site.module';
import { HotelModule } from '../hotel/hotel.module';
import { ServiceOrdersModule } from '../services/service-orders.module';
import { ClinicModule } from '../clinic/clinic.module';
import { FiscalModule } from '../fiscal/fiscal.module';
import { StorefrontController } from './storefront.controller';
import { OrdersController } from './orders.controller';
import { CustomerChatController } from './customer-chat.controller';
import { CustomerAuthService } from './customer-auth.service';
import { OrderChatService } from './order-chat.service';
import { CustomerChatService } from './customer-chat.service';
import { StorefrontService } from './storefront.service';
import { OrdersService } from './orders.service';
import { TenantResolverService } from './tenant-resolver.service';

import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { BannersController } from './banners.controller';
import { BannersService } from './banners.service';
import { AffiliatesController } from './affiliates.controller';
import { AffiliatesService } from './affiliates.service';
import { KwanzaAdminController, KwanzaPublicController } from './kwanza.controller';
import { KwanzaService } from './kwanza.service';
import { KwanzaCheckoutController, KwanzaCheckoutService } from './kwanza-checkout';
import { KwanzaTrustAdminController, KwanzaTrustPublicController, KwanzaTrustService } from './kwanza-trust';
import { AdminNotificationsController, AdminNotificationsService } from './admin-notifications';

@Module({
  imports: [PosModule, SiteModule, PaymentsModule, AiModule, HotelModule, ServiceOrdersModule, ClinicModule, FiscalModule, JwtModule.register({})],
  controllers: [StorefrontController, OrdersController, CustomerChatController, MarketingController, MembersController, BannersController, AffiliatesController, KwanzaPublicController, KwanzaAdminController, KwanzaTrustPublicController, KwanzaTrustAdminController, KwanzaCheckoutController, AdminNotificationsController],
  providers: [
    StorefrontService,
    OrdersService,
    OrderChatService,
    CustomerChatService,
    CustomerAuthService,
    TenantResolverService,
    MarketingService,
    MembersService,
    BannersService,
    AffiliatesService,
    KwanzaService,
    KwanzaTrustService,
    KwanzaCheckoutService,
    AdminNotificationsService,
  ],
  exports: [AdminNotificationsService],
})
export class EcommerceModule {}
