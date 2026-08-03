import { Module } from '@nestjs/common';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

/**
 * Postos da empresa + série fiscal por posto. Exportado porque a emissão de
 * documentos (`PosModule`) precisa de resolver a série do posto que está a
 * vender.
 */
@Module({
  controllers: [DevicesController],
  providers: [DevicesService],
  exports: [DevicesService],
})
export class DevicesModule {}
