import { Module } from '@nestjs/common';
import { DownloadsPublicController, DownloadsAdminController } from './downloads.controller';
import { DownloadsService } from './downloads.service';

/**
 * Gestão de Downloads das aplicações (Windows/Android/iOS).
 * Aditivo: não toca em nenhum módulo existente.
 */
@Module({
  controllers: [DownloadsPublicController, DownloadsAdminController],
  providers: [DownloadsService],
  exports: [DownloadsService],
})
export class DownloadsModule {}
