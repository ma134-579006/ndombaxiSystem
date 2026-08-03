import { Injectable, Logger } from '@nestjs/common';
import { pbkdf2, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { TenantUserRepository } from '../tenancy/tenant-user.repository';

const pbkdf2Async = promisify(pbkdf2);

/**
 * CREDENCIAIS OFFLINE — o que o aparelho leva consigo para poder autenticar
 * sem rede.
 *
 * O problema real: o cofre offline das apps só conhecia quem tivesse escrito a
 * senha NAQUELE aparelho, naquele aparelho. Um segundo gestor, um operador
 * contratado depois, ou uma senha trocada noutro computador davam
 * "utilizador desconhecido" assim que faltasse a internet — a app ficava
 * inutilizável exatamente no cenário para que foi feita.
 *
 * A solução: o servidor calcula um VERIFICADOR próprio no único momento em que
 * tem o segredo em mãos (login, recuperação, criação/alteração) e os aparelhos
 * da empresa descarregam-no. A partir daí qualquer utilizador da empresa entra
 * sem rede num aparelho onde nunca escreveu a senha.
 *
 * ⚠️ O que sai e o que NÃO sai do servidor:
 *   • SAI um derivado PBKDF2-SHA256 (150k iterações) do segredo — só serve para
 *     comparar localmente.
 *   • NÃO SAI o hash de autenticação (Argon2id). Nem podia: o navegador não tem
 *     Argon2 e o hash que valida sessões reais nunca deve viajar.
 *
 * Os parâmetros (PBKDF2-SHA256, 150k, 32 bytes, sal de 16 bytes, base64) são os
 * MESMOS que as apps já usavam no cofre local — de propósito: o mesmo código de
 * verificação serve as credenciais que o utilizador escreveu no aparelho e as
 * que vieram do servidor. Alterá-los aqui exige alterá-los lá.
 */
export const OFFLINE_ITERATIONS = 150_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** Comparação em tempo constante de dois base64 (tolera comprimentos diferentes). */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface OfflineVerifier {
  salt: string;       // base64
  verifier: string;   // base64
  iterations: number;
}

/** Uma credencial no pacote que o aparelho descarrega. */
export interface OfflineCredentialDto {
  id: string;
  email: string;
  name: string;
  role: string;
  storeId: string | null;
  storeName: string | null;
  photoUrl: string | null;
  /** Verificador da senha (painel de gestão) — null se nunca entrou com senha. */
  password: OfflineVerifier | null;
  /** Verificador do PIN (caixa) — null se não tem PIN ou nunca o usou. */
  pin: OfflineVerifier | null;
  updatedAt: string | null;
}

export interface OfflineBundle {
  companyCode: string;
  companyName: string;
  /** Momento do servidor — o aparelho usa-o para datar a validade da cópia. */
  serverTime: string;
  /** Alteração mais recente do pacote; se não mudou, o aparelho não reescreve. */
  revision: string | null;
  users: OfflineCredentialDto[];
}

@Injectable()
export class OfflineCredentialsService {
  private readonly logger = new Logger(OfflineCredentialsService.name);

  constructor(private readonly tenantUsers: TenantUserRepository) {}

  /** Deriva o verificador (mesmos parâmetros que o cofre das apps). */
  async derive(secret: string, salt?: Buffer, iterations = OFFLINE_ITERATIONS): Promise<OfflineVerifier> {
    const s = salt ?? randomBytes(SALT_BYTES);
    const key = await pbkdf2Async(
      Buffer.from(secret, 'utf8'), s, iterations, KEY_BYTES, 'sha256',
    );
    return { salt: s.toString('base64'), verifier: key.toString('base64'), iterations };
  }

  /**
   * Regista o verificador da SENHA ou do PIN. Chamado de dentro de caminhos de
   * login e de recuperação: por isso é **best-effort por desenho** — uma falha
   * aqui (schema por migrar, base lenta) nunca pode impedir alguém de entrar.
   */
  async remember(
    schema: string, userId: string, kind: 'PASSWORD' | 'PIN', secret: string,
    current?: { salt?: string | null; verifier?: string | null; iterations?: number | null },
  ): Promise<void> {
    if (!schema || !userId || !secret) return;
    try {
      // Se já lá está o mesmo segredo, não reescreve. Não é micro-otimização:
      // cada escrita mexe em `offline_updated_at`, e isso faria TODOS os
      // aparelhos da empresa voltarem a descarregar o pacote a cada login.
      if (current?.salt && current.verifier) {
        const same = await this.derive(
          secret, Buffer.from(current.salt, 'base64'), current.iterations ?? OFFLINE_ITERATIONS,
        );
        if (timingSafeEqualStr(same.verifier, current.verifier)) return;
      }
      const cred = await this.derive(secret);
      if (kind === 'PIN') await this.tenantUsers.setOfflinePin(schema, userId, cred);
      else await this.tenantUsers.setOfflinePassword(schema, userId, cred);
    } catch (err) {
      this.logger.debug(
        `credencial offline não gravada (${schema}/${userId}): ${
          err instanceof Error ? err.message.split('\n')[0] : 'erro'
        }`,
      );
    }
  }

  /** O pacote que o aparelho descarrega para a empresa do utilizador autenticado. */
  async bundle(schema: string, companyCode: string, companyName: string): Promise<OfflineBundle> {
    const rows = await this.tenantUsers.listOfflineCredentials(schema);
    let newest: number | null = null;
    const users = rows.map((r) => {
      const at = r.offline_updated_at ? r.offline_updated_at.getTime() : null;
      if (at !== null && (newest === null || at > newest)) newest = at;
      return {
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role as string,
        storeId: r.store_id,
        storeName: r.store_name,
        photoUrl: r.photo_url,
        password: r.offline_pw_verifier && r.offline_pw_salt
          ? { salt: r.offline_pw_salt, verifier: r.offline_pw_verifier, iterations: r.offline_pw_iters ?? OFFLINE_ITERATIONS }
          : null,
        pin: r.offline_pin_verifier && r.offline_pin_salt
          ? { salt: r.offline_pin_salt, verifier: r.offline_pin_verifier, iterations: r.offline_pin_iters ?? OFFLINE_ITERATIONS }
          : null,
        updatedAt: r.offline_updated_at ? r.offline_updated_at.toISOString() : null,
      } satisfies OfflineCredentialDto;
    });
    return {
      companyCode,
      companyName,
      serverTime: new Date().toISOString(),
      revision: newest === null ? null : new Date(newest).toISOString(),
      users,
    };
  }
}
