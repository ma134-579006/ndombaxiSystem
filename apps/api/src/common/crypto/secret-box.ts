import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Cofre de segredos simétrico (AES-256-GCM) para guardar valores sensíveis em
 * repouso — ex.: as API keys dos provedores de IA que o Super Admin configura
 * no painel. A chave de 256 bits deriva (SHA-256) de `CONFIG_ENCRYPTION_KEY`.
 *
 * Formato do texto cifrado: base64( iv(12) ‖ authTag(16) ‖ ciphertext ),
 * prefixado por "v1:" para permitir rotação de esquema no futuro.
 */
const PREFIX = 'v1:';
const IV_LEN = 12; // recomendado para GCM
const TAG_LEN = 16;

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(payload: string, secret: string): string {
  if (!payload.startsWith(PREFIX)) {
    throw new Error('Formato de segredo inválido ou versão não suportada.');
  }
  const raw = Buffer.from(payload.slice(PREFIX.length), 'base64');
  const iv = raw.subarray(0, IV_LEN);
  const tag = raw.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const enc = raw.subarray(IV_LEN + TAG_LEN);
  const key = deriveKey(secret);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

export function isEncrypted(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/**
 * Máscara segura para mostrar no painel sem revelar o segredo
 * (ex.: "sk-…a1b2"). Recebe o texto em claro.
 */
export function maskSecret(plaintext: string): string {
  if (!plaintext) return '';
  const tail = plaintext.slice(-4);
  return `••••••••${tail}`;
}
