import { Module } from '@nestjs/common';
import { PosModule } from '../pos/pos.module';
import { HotelController } from './hotel.controller';
import { HotelService } from './hotel.service';

/** Hotelaria — quartos, reservas e folio. PrismaService/TenantContext globais. */
@Module({
  imports: [PosModule],
  controllers: [HotelController],
  providers: [HotelService],
  exports: [HotelService],
})
export class HotelModule {}
