import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { CamerasController } from './cameras.controller';
import { CamerasService } from './cameras.service';
import { CameraRecorderService } from './recorder.service';

/**
 * CÂMARAS de vigilância da empresa: configuração (manual ou por QR),
 * visualização ao vivo (HLS/MJPEG/MP4) e gravação por instantâneos com
 * retenção de 30 dias e limpeza automática.
 */
@Module({
  imports: [AuditModule],
  controllers: [CamerasController],
  providers: [CamerasService, CameraRecorderService],
})
export class CamerasModule {}
