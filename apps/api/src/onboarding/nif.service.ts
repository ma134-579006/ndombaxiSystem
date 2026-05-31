import { Injectable, Logger } from '@nestjs/common';

/**
 * Validação de NIF junto à AGT (§3.3).
 *
 * NOTA: a integração real com a API da AGT entra na Fase 2 (Conformidade
 * Fiscal). Por agora valida-se o formato do NIF angolano e devolve-se um
 * resultado optimista. O ponto de integração está isolado aqui.
 */
@Injectable()
export class NifService {
  private readonly logger = new Logger(NifService.name);

  /** NIF de pessoa colectiva em Angola: tipicamente 10 dígitos. */
  isValidFormat(nif: string): boolean {
    return /^\d{9,10}$/.test(nif);
  }

  async validateWithAgt(
    nif: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    if (!this.isValidFormat(nif)) {
      return { valid: false, reason: 'Formato de NIF inválido' };
    }
    // TODO(Fase 2): chamar a API oficial da AGT para confirmar o NIF.
    this.logger.debug(`NIF ${nif} validado (stub) — pendente API AGT`);
    return { valid: true };
  }
}
