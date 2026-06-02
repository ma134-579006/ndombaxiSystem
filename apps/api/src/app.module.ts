import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv, type Env } from './config/env.validation';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { MailModule } from './common/mail/mail.module';
import { AuthModule } from './auth/auth.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { SuperAdminModule } from './super-admin/super-admin.module';
import { PosModule } from './pos/pos.module';
import { ErpModule } from './erp/erp.module';
import { EcommerceModule } from './ecommerce/ecommerce.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { HrModule } from './hr/hr.module';
import { AiModule } from './ai/ai.module';
import { SiteModule } from './site/site.module';
import { PaymentsModule } from './payments/payments.module';
import { FiscalModule } from './fiscal/fiscal.module';
import { StaffModule } from './staff/staff.module';
import { LandingModule } from './landing/landing.module';
import { SubscriptionModule } from './subscription/subscription.module';
import { CashboxModule } from './cashbox/cashbox.module';
import { PromotionsModule } from './promotions/promotions.module';
import { ProfitModule } from './profit/profit.module';
import { ExpensesModule } from './expenses/expenses.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { TenantContext } from './tenancy/tenant-context';
import { TenantContextInterceptor } from './tenancy/tenant-context.interceptor';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        throttlers: [
          {
            ttl: 60_000,
            limit: config.get('RATE_LIMIT_USER_PER_MIN', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    RealtimeModule,
    AuditModule,
    TenancyModule,
    MailModule,
    AuthModule,
    OnboardingModule,
    SuperAdminModule,
    PosModule,
    ErpModule,
    EcommerceModule,
    DashboardModule,
    HrModule,
    AiModule,
    SiteModule,
    PaymentsModule,
    FiscalModule,
    StaffModule,
    LandingModule,
    SubscriptionModule,
    CashboxModule,
    PromotionsModule,
    ProfitModule,
    ExpensesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    {
      provide: APP_INTERCEPTOR,
      inject: [TenantContext],
      useFactory: (ctx: TenantContext) => new TenantContextInterceptor(ctx),
    },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
