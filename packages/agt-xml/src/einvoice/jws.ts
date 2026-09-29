import { createPublicKey, createSign, createVerify } from 'node:crypto';

/**
 * JWS compacto RS256 da Facturação Electrónica AGT (Decreto Presidencial 71/25,
 * Decreto Executivo 683/25): base64url(header).base64url(payload).base64url(assinatura),
 * SEM padding "=", RSA com SHA-256, chave mínima de 2048 bits. O payload é JSON
 * canónico: sem quebras de linha, sem espaços, aspas duplas, números sem formatação.
 */

export const JWS_HEADER = { alg: 'RS256', typ: 'JWT' } as const;
export const MIN_FE_KEY_BITS = 2048;

export function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

/** JSON canónico: a ordem das chaves é a de inserção (os payloads AGT têm ordem definida). */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value);
}

export function signJws(payload: object, privateKeyPem: string): string {
  const head = base64url(canonicalJson(JWS_HEADER));
  const body = base64url(canonicalJson(payload));
  const signer = createSign('RSA-SHA256');
  signer.update(`${head}.${body}`, 'utf8');
  signer.end();
  return `${head}.${body}.${base64url(signer.sign(privateKeyPem))}`;
}

export function verifyJws(jws: string, publicKeyPem: string): { valid: boolean; payload?: unknown } {
  try {
    const [h, p, s] = jws.split('.');
    if (!h || !p || !s) return { valid: false };
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${h}.${p}`, 'utf8');
    verifier.end();
    const valid = verifier.verify(publicKeyPem, Buffer.from(s, 'base64url'));
    return valid ? { valid, payload: JSON.parse(Buffer.from(p, 'base64url').toString('utf8')) } : { valid: false };
  } catch {
    return { valid: false };
  }
}

/** Bits do módulo RSA de uma chave PEM (privada ou pública); 0 se inválida ou não-RSA. */
export function rsaKeyBits(pem: string): number {
  try {
    const k = createPublicKey(pem);
    return k.asymmetricKeyType === 'rsa' ? (k.asymmetricKeyDetails?.modulusLength ?? 0) : 0;
  } catch {
    return 0;
  }
}
