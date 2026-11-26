import { Module } from '@nestjs/common';
import { SiteController } from './site.controller';
import { SiteService } from './site.service';
import { ConfigListsController } from './config-lists.controller';
import { ConfigListsService } from './config-lists.service';

/** Módulo do construtor de site / white-label (§8). */
@Module({
  controllers: [SiteController, ConfigListsController],
  providers: [SiteService, ConfigListsService],
  exports: [SiteService],
})
export class SiteModule {}
