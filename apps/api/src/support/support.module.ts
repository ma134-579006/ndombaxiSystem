import { Module } from '@nestjs/common';
import { AiModule } from '../ai/ai.module';
import { AdminSupportController, PublicSupportController } from './support.controller';
import { SupportService } from './support.service';

/** Suporte da plataforma: chat com assistente IA (escala p/ Super Admin) +
 *  comentários públicos com votos e painel de estatísticas. */
@Module({
  imports: [AiModule],
  controllers: [PublicSupportController, AdminSupportController],
  providers: [SupportService],
})
export class SupportModule {}
