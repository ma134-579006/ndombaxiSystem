import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';

/**
 * Módulo global de tempo real. Exporta o RealtimeService para que qualquer
 * módulo de negócio (POS, e-commerce, ...) possa publicar eventos sem depender
 * do gateway directamente.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [RealtimeGateway, RealtimeService],
  exports: [RealtimeService],
})
export class RealtimeModule {}
