import { Module } from '@nestjs/common';
import { PharmacyController } from './pharmacy.controller';
import { PharmacyService } from './pharmacy.service';

/** Farmácia — validade/lotes. PrismaService/TenantContext globais. */
@Module({
  controllers: [PharmacyController],
  providers: [PharmacyService],
})
export class PharmacyModule {}
