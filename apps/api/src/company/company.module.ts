import { Module } from '@nestjs/common';
import { SnapshotController } from './snapshot.controller';
import { SnapshotService } from './snapshot.service';

/**
 * Cópia inicial da empresa para o servidor local do posto. Ver
 * `snapshot.service.ts` — é o que enche a base local antes de ela poder
 * substituir a nuvem.
 */
@Module({
  controllers: [SnapshotController],
  providers: [SnapshotService],
  exports: [SnapshotService],
})
export class CompanyModule {}
