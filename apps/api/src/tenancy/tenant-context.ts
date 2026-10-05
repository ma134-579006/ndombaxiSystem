import { ForbiddenException, Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import type { JwtPayload } from '@nexus/types';

interface Store {
  auth: JwtPayload | null;
  ip?: string;
}

/**
 * Contexto de pedido baseado em AsyncLocalStorage.
 * Disponibiliza o utilizador autenticado (e o seu tenant) em qualquer ponto
 * da stack sem o passar manualmente. Preenchido pelo TenantContextInterceptor.
 */
@Injectable()
export class TenantContext {
  private readonly als = new AsyncLocalStorage<Store>();

  run<T>(store: Store, fn: () => T): T {
    return this.als.run(store, fn);
  }

  get auth(): JwtPayload | null {
    return this.als.getStore()?.auth ?? null;
  }

  get ip(): string | undefined {
    return this.als.getStore()?.ip;
  }

  /** Schema do tenant actual; lança se o contexto não for de um tenant. */
  requireTenantSchema(): string {
    const schema = this.auth?.tenantSchema;
    if (!schema) {
      // Sessão sem empresa (ex.: super admin num endpoint de empresa): 403, não 500.
      throw new ForbiddenException('Esta operação exige uma sessão de empresa.');
    }
    return schema;
  }
}
