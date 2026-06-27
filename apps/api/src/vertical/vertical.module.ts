import { Module } from '@nestjs/common';
import { VerticalController } from './vertical.controller';
import { VerticalService } from './vertical.service';

/** Métricas por vertical. PrismaService/TenantContext globais. */
@Module({
  controllers: [VerticalController],
  providers: [VerticalService],
})
export class VerticalModule {}
