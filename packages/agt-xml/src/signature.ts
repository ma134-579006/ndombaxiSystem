import { createSign, createVerify, generateKeyPairSync } from 'node:crypto';
import { buildSignableString } from './hash';
import { money } from './money';
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

// ─────────────────────────────────────────────────────────────────────────────
// Modelo AGT (Declaração Modelo 8 — Regras e Requisitos para Validação de
// Sistemas, ponto 34): assinatura RSA da chave do PRODUTOR do software, chave
// privada de 1024 bits, hash SHA-1, PKCS#1 v1.5, resultado em Base64 com
// EXACTAMENTE 172 caracteres, sem quebras de linha. O texto assinado é
//   InvoiceDate;SystemEntryDate;InvoiceNo;GrossTotal;<assinatura do documento
//   anterior da mesma série (vazia no primeiro)>
// e o valor da assinatura é o próprio campo Hash do SAF-T (AO).
// ─────────────────────────────────────────────────────────────────────────────

export const AGT_SIGNATURE_ALGORITHM: SignatureAlgorithm = 'RSA-SHA1';
export const AGT_SIGNATURE_LENGTH = 172;
const AGT_SIGNATURE_RE = /^[A-Za-z0-9+/]{171}=$/;

/** Uma assinatura AGT válida em forma: Base64 de 128 bytes (172 caracteres). */
export function isAgtSignature(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.length === AGT_SIGNATURE_LENGTH && AGT_SIGNATURE_RE.test(value);
}

/** SystemEntryDate no formato AGT: AAAA-MM-DDTHH:MM:SS (sem milissegundos nem fuso). */
export function formatAgtSystemEntryDate(iso: string): string {
  return iso.length > 19 ? iso.slice(0, 19) : iso;
}

/** Texto a assinar (ponto 34 d/e). `previousSignature` vazio no 1.º documento da série. */
export function buildAgtSignableString(
  doc: DocHeader,
  previousSignature: string,
): string {
  return [
    doc.invoiceDate,
    formatAgtSystemEntryDate(doc.systemEntryDate),
    doc.number,
    money(doc.totals.grossTotal),
    previousSignature,
  ].join(';');
}

export interface AgtSignatureResult {
  /** Assinatura Base64 (172 car.) — é o campo Hash do SAF-T e a chave do documento. */
  signature: string;
  signableString: string;
  keyVersion: number;
}

/** Assinador conforme o Modelo 8 da AGT (chave da plataforma, RSA-1024/SHA-1). */
export class AgtDocumentSigner {
  private readonly privateKeyPem: string;
  readonly keyVersion: number;

  constructor(options: { privateKeyPem: string; keyVersion: number }) {
    this.privateKeyPem = options.privateKeyPem;
    this.keyVersion = options.keyVersion;
  }

  signDocument(doc: DocHeader, previousSignature: string): AgtSignatureResult {
    const signableString = buildAgtSignableString(doc, previousSignature);
    const signature = signString(signableString, this.privateKeyPem, AGT_SIGNATURE_ALGORITHM);
    if (!isAgtSignature(signature)) {
      throw new Error(
        `Assinatura AGT inválida (${signature.length} caracteres): a chave da plataforma tem de ser RSA de 1024 bits.`,
      );
    }
    return { signature, signableString, keyVersion: this.keyVersion };
  }
}

/** Verifica um documento assinado no modelo AGT contra a chave pública registada. */
export function verifyAgtDocument(
  doc: DocHeader,
  previousSignature: string,
  signature: string,
  publicKeyPem: string,
): boolean {
  return verifySignatureString(
    buildAgtSignableString(doc, previousSignature),
    signature,
    publicKeyPem,
    AGT_SIGNATURE_ALGORITHM,
  );
}
