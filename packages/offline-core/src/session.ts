/**
 * Sessão offline — abrir o sistema sem internet.
 *
 * Como funciona: no primeiro login COM ligação, o servidor confirma a identidade
 * e nós guardamos um verificador PBKDF2 do PIN/senha, mais o pacote de
 * permissões RBAC, cifrado com a chave do dispositivo. A partir daí o caixa, o
 * gerente e o administrador entram com o mesmo PIN de sempre, offline, e o RBAC
 * continua a ser respeitado.
 *
 * O que NÃO fazemos, e porquê:
 *   • Não guardamos o PIN. Só o derivado — quem ler o ficheiro não o descobre.
 *   • Não damos crédito eterno. A credencial tem validade; passada essa janela
 *     exige-se uma revalidação online. Um funcionário despedido não fica com
 *     acesso vitalício a um posto que nunca mais viu a internet.
 *
 * Sobre a força real da cifra: a confidencialidade do ficheiro depende de onde
 * mora o segredo do dispositivo. No Electron mora no cofre do sistema operativo
 * (DPAPI, via `safeStorage`); no WebView móvel, no armazenamento seguro do
 * telefone. Quando nada disso existe, degradamos para um segredo local — isso
 * protege contra um curioso, não contra um atacante com acesso à máquina, e o
 * motor diz isso em vez de fingir o contrário.
 */
import {
  cryptoAvailable, deriveKey, deriveVerifier, fromBase64, randomBytes,
  seal, timingSafeEqual, toBase64, unseal, PIN_ITERATIONS, type SealedBlob,
} from './crypto';
import type { StorageAdapter } from './storage/adapter';
import type { OfflineCredential } from './types';

const META_VAULT = 'session.vault';
const META_SALT = 'session.vaultSalt';

/** Fornece o segredo do dispositivo. Ligado ao cofre do SO quando existe. */
export interface DeviceSecretProvider {
  /** Devolve (criando na primeira vez) o segredo desta instalação. */
  get(): Promise<string>;
  /** True se o segredo está protegido pelo sistema operativo. */
  readonly hardwareBacked: boolean;
}

/** Fallback quando não há cofre do SO: segredo aleatório guardado no próprio armazenamento. */
export function localDeviceSecret(storage: StorageAdapter): DeviceSecretProvider {
  const KEY = 'device.secret';
  return {
    hardwareBacked: false,
    async get() {
      const existing = await storage.metaGet<string>(KEY);
      if (existing) return existing;
      const secret = toBase64(randomBytes(32));
      await storage.metaSet(KEY, secret);
      return secret;
    },
  };
}

export interface VerifyResult {
  ok: boolean;
  credential?: OfflineCredential;
  /** Motivo legível quando `ok` é falso. */
  reason?: 'unknown-user' | 'wrong-secret' | 'expired' | 'unavailable';
}

export class OfflineSessionStore {
  private key: CryptoKey | null = null;

  constructor(
    private readonly storage: StorageAdapter,
    private readonly device: DeviceSecretProvider,
  ) {}

  /** True se o segredo desta máquina está no cofre do sistema operativo. */
  get hardwareBacked(): boolean { return this.device.hardwareBacked; }

  private async cipherKey(): Promise<CryptoKey> {
    if (this.key) return this.key;
    let saltB64 = await this.storage.metaGet<string>(META_SALT);
    if (!saltB64) {
      saltB64 = toBase64(randomBytes(16));
      await this.storage.metaSet(META_SALT, saltB64);
    }
    this.key = await deriveKey(await this.device.get(), fromBase64(saltB64));
    return this.key;
  }

  private async readVault(): Promise<Record<string, OfflineCredential>> {
    if (!cryptoAvailable()) return {};
    const blob = await this.storage.metaGet<SealedBlob>(META_VAULT);
    if (!blob) return {};
    try {
      return await unseal<Record<string, OfflineCredential>>(await this.cipherKey(), blob);
    } catch {
      // Decifragem falhada = ficheiro adulterado ou chave trocada. Não confiamos
      // no conteúdo: tratamos como cofre vazio e exigimos login online.
      return {};
    }
  }

  private async writeVault(vault: Record<string, OfflineCredential>): Promise<void> {
    await this.storage.metaSet(META_VAULT, await seal(await this.cipherKey(), vault));
  }

  /** Chave do cofre: e-mail/identificador normalizado dentro da empresa. */
  private static slot(companyCode: string, userKey: string): string {
    return `${companyCode.trim().toUpperCase()}|${userKey.trim().toLowerCase()}`;
  }

  /**
   * Grava a credencial após um login ONLINE bem-sucedido. Chamar sempre que o
   * servidor confirmar a identidade — é assim que as permissões se mantêm
   * frescas e a validade se renova sozinha.
   */
  async remember(input: {
    companyCode: string;
    /** E-mail ou identificador com que o utilizador entra. */
    userKey: string;
    userId: string;
    displayName: string;
    /** PIN ou senha em claro — usado só para derivar, nunca guardado. */
    secret: string;
    roles: string[];
    permissions: string[];
    /** Dias que a credencial vale sem ver o servidor. */
    validDays?: number;
  }): Promise<void> {
    if (!cryptoAvailable()) return;
    const salt = randomBytes(16);
    const verifier = await deriveVerifier(input.secret, salt, PIN_ITERATIONS);
    const now = new Date();
    const validUntil = new Date(now.getTime() + (input.validDays ?? 30) * 86_400_000);

    const vault = await this.readVault();
    vault[OfflineSessionStore.slot(input.companyCode, input.userKey)] = {
      userId: input.userId,
      companyCode: input.companyCode,
      displayName: input.displayName,
      salt: toBase64(salt),
      verifier,
      iterations: PIN_ITERATIONS,
      roles: input.roles,
      permissions: input.permissions,
      validUntil: validUntil.toISOString(),
      refreshedAt: now.toISOString(),
    };
    await this.writeVault(vault);
  }

  /** Verifica um PIN/senha sem rede. */
  async verify(companyCode: string, userKey: string, secret: string): Promise<VerifyResult> {
    if (!cryptoAvailable()) return { ok: false, reason: 'unavailable' };
    const vault = await this.readVault();
    const cred = vault[OfflineSessionStore.slot(companyCode, userKey)];
    if (!cred) return { ok: false, reason: 'unknown-user' };
    if (Date.parse(cred.validUntil) < Date.now()) return { ok: false, reason: 'expired', credential: cred };

    const candidate = await deriveVerifier(secret, fromBase64(cred.salt), cred.iterations);
    // Comparação em tempo constante — ver nota em crypto.ts.
    if (!timingSafeEqual(candidate, cred.verifier)) return { ok: false, reason: 'wrong-secret' };
    return { ok: true, credential: cred };
  }

  /** Operadores que conseguem entrar offline nesta máquina (para o ecrã de escolha). */
  async operators(companyCode?: string): Promise<{ userKey: string; credential: OfflineCredential }[]> {
    const vault = await this.readVault();
    const wanted = companyCode?.trim().toUpperCase();
    return Object.entries(vault)
      .filter(([slot]) => !wanted || slot.startsWith(`${wanted}|`))
      .map(([slot, credential]) => ({ userKey: slot.split('|')[1] ?? '', credential }));
  }

  /** Remove uma credencial (funcionário saiu, posto reatribuído). */
  async forget(companyCode: string, userKey: string): Promise<void> {
    const vault = await this.readVault();
    delete vault[OfflineSessionStore.slot(companyCode, userKey)];
    await this.writeVault(vault);
  }

  /** Limpa o cofre inteiro. Usado ao desassociar o posto da empresa. */
  async clear(): Promise<void> {
    await this.storage.metaDelete(META_VAULT);
  }

  /** Uma permissão está concedida a esta credencial? RBAC a funcionar offline. */
  static can(cred: OfflineCredential, permission: string): boolean {
    if (cred.roles.includes('OWNER') || cred.roles.includes('SUPER_ADMIN')) return true;
    return cred.permissions.includes(permission) || cred.permissions.includes('*');
  }
}
