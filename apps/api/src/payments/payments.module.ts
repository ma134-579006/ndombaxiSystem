import { Module } from '@nestjs/common';
import { PaymentGatewayController } from './payment-gateway.controller';
import { PaymentGatewayService } from './payment-gateway.service';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

/**
 * Módulo de pagamentos (§8):
 *   • Loja: métodos de pagamento + comprovativos (tenant).
 *   • Super Admin: contratos de gateway da plataforma (ex.: Express).
 */
@Module({
  controllers: [PaymentsController, PaymentGatewayController],
  providers: [PaymentsService, PaymentGatewayService],
  exports: [PaymentsService, PaymentGatewayService],
})
export class PaymentsModule {}
