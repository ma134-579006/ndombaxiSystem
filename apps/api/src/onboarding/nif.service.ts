import { Injectable, Logger } from '@nestjs/common';

export const NIF_REGEX = /^(\d{9,10}|\d{9}[A-Z]{2}\d{3})$/;
export const NIF_MESSAGE = 'NIF inválido (9–10 dígitos, ou 14 caracteres no formato do BI: 9 dígitos + 2 letras + 3 dígitos)';
/** Normaliza (trim + maiúsculas) antes de validar/guardar. */
export const normalizeNif = (v: unknown): unknown => (typeof v === 'string' ? v.trim().toUpperCase() : v);

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

  /**
   * NIF angolano: pessoa colectiva (9–10 dígitos) ou contribuinte particular
   * (14 caracteres, formato do BI: 9 dígitos + 2 letras + 3 dígitos).
   */
  isValidFormat(nif: string): boolean {
    return NIF_REGEX.test(nif);
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
