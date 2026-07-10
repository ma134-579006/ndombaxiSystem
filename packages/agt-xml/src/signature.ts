import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { buildSignableString } from './hash';
import { Sha256Signer } from './hash';
import { FiscalDocument } from './types';

/**
 * Assinatura digital RSA-2048 dos documentos fiscais (§7, requisito AGT).
 *
 * Conforme a nota deixada no motor de hash: a cadeia de integridade continua a
 * usar SHA-256 (`computeDocumentHash`), e cada documento ganha ADICIONALMENTE
 * uma assinatura digital RSA-2048 da mesma "signable string". Isto prova a
 * origem (chave privada da empresa) e não apenas a integridade da cadeia.
 *
 * A string assinável segue a convenção AGT/PT já usada em `buildSignableString`:
 *   "<InvoiceDate>;<SystemEntryDate>;<InvoiceNo>;<GrossTotal>;<PreviousHash>"
 */

/** Algoritmo de assinatura. Por omissão RSA com SHA-256 (moderno e seguro). */
export type SignatureAlgorithm = 'RSA-SHA256' | 'RSA-SHA1';

export const DEFAULT_SIGNATURE_ALGORITHM: SignatureAlgorithm = 'RSA-SHA256';
export const RSA_MODULUS_LENGTH = 2048;
/**
 * RSA-1024 para a ASSINATURA DE DOCUMENTOS: o campo Hash do SAF-T (AO) aceita
 * no máx. 172 caracteres — exatamente uma assinatura RSA-1024 em base64
 * (128 bytes → 172). RSA-2048 produz 344 e NÃO cabe. É o modelo herdado de
 * Portugal (que usa RSA-1024 nos documentos até hoje).
 */
export const RSA_DOC_MODULUS_LENGTH = 1024;

export interface SigningKeyPair {
  privateKeyPem: string;
  publicKeyPem: string;
}

/**
 * Gera um par de chaves RSA (PEM) para a assinatura fiscal. Por omissão 2048;
 * usar RSA_DOC_MODULUS_LENGTH (1024) quando a assinatura tiver de caber no
 * campo Hash do SAF-T. A chave privada deve ser guardada cifrada em repouso
 * (AES-256-GCM); a pública pode ser exportada para verificação (ex.: AGT).
 */
export function generateSigningKeyPair(modulusLength: number = RSA_MODULUS_LENGTH): SigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { privateKeyPem: privateKey, publicKeyPem: publicKey };
}

/** Assina uma string com a chave privada RSA; devolve a assinatura em base64. */
export function signString(
  signable: string,
  privateKeyPem: string,
  algorithm: SignatureAlgorithm = DEFAULT_SIGNATURE_ALGORITHM,
): string {
  const signer = createSign(algorithm);
  signer.update(signable, 'utf8');
  signer.end();
  return signer.sign(privateKeyPem, 'base64');
}

/** Verifica uma assinatura base64 contra a chave pública. Nunca lança. */
export function verifySignatureString(
  signable: string,
  signatureBase64: string,
  publicKeyPem: string,
  algorithm: SignatureAlgorithm = DEFAULT_SIGNATURE_ALGORITHM,
): boolean {
  try {
    const verifier = createVerify(algorithm);
    verifier.update(signable, 'utf8');
    verifier.end();
    return verifier.verify(publicKeyPem, signatureBase64, 'base64');
  } catch {
    return false;
  }
}

export interface DocumentSignatureResult {
  /** Hash SHA-256 encadeado (igual a computeDocumentHash). */
  hash: string;
  /** Assinatura digital RSA-2048 da signable string (base64). */
  signature: string;
  /** A string que foi assinada (auditoria/reprodutibilidade). */
  signableString: string;
  /** Versão da chave usada (permite rotação). */
  keyVersion: number;
  algorithm: SignatureAlgorithm;
}

type DocHeader = Pick<
  FiscalDocument,
  'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'
>;

/**
 * Assinador de documentos fiscais: combina a cadeia SHA-256 com a assinatura
 * digital RSA-2048 da empresa. Mantém a chave privada e a versão em memória
 * apenas durante a emissão.
 */
export class RsaDocumentSigner {
  private readonly privateKeyPem: string;
  private readonly hasher = new Sha256Signer();
  readonly keyVersion: number;
  readonly algorithm: SignatureAlgorithm;

  constructor(options: {
    privateKeyPem: string;
    keyVersion: number;
    algorithm?: SignatureAlgorithm;
  }) {
    this.privateKeyPem = options.privateKeyPem;
    this.keyVersion = options.keyVersion;
    this.algorithm = options.algorithm ?? DEFAULT_SIGNATURE_ALGORITHM;
  }

  /** Calcula o hash encadeado e assina o documento. */
  signDocument(doc: DocHeader, previousHash: string): DocumentSignatureResult {
    const signableString = buildSignableString(doc, previousHash);
    const hash = this.hasher.hash(signableString);
    const signature = signString(signableString, this.privateKeyPem, this.algorithm);
    return {
      hash,
      signature,
      signableString,
      keyVersion: this.keyVersion,
      algorithm: this.algorithm,
    };
  }
}
