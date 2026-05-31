import { createHash } from 'node:crypto';
import { money } from './money';
import { FiscalDocument } from './types';

/**
 * Document hash chaining per AGT (§7). Each fiscal document carries a hash of
 * its key fields plus the previous document's hash, forming a tamper-evident
 * chain (blockchain-style) per series.
 *
 * The signable string follows the AGT/Portuguese-derived convention:
 *   "<InvoiceDate>;<SystemEntryDate>;<InvoiceNo>;<GrossTotal>;<PreviousHash>"
 * GrossTotal is formatted with 2 decimals and a dot separator.
 */

export const GENESIS_HASH = '0'.repeat(64);

export function buildSignableString(
  doc: Pick<FiscalDocument, 'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'>,
  previousHash: string,
): string {
  return [
    doc.invoiceDate,
    doc.systemEntryDate,
    doc.number,
    money(doc.totals.grossTotal),
    previousHash,
  ].join(';');
}

/**
 * Pluggable signer. Default is plain SHA-256 over the signable string.
 * Fase 9 swaps in an RSA-2048 signer that signs the string with the company's
 * private key and stores the base64 signature; the chained hash stays SHA-256.
 */
export interface DocumentSigner {
  hash(input: string): string;
}

export class Sha256Signer implements DocumentSigner {
  hash(input: string): string {
    return createHash('sha256').update(input, 'utf8').digest('hex');
  }
}

const defaultSigner = new Sha256Signer();

/** Compute the chained hash for a document given the previous hash in its series. */
export function computeDocumentHash(
  doc: Pick<FiscalDocument, 'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'>,
  previousHash: string,
  signer: DocumentSigner = defaultSigner,
): string {
  return signer.hash(buildSignableString(doc, previousHash));
}

/** Verify a chain of (signable input already known) hashes is internally consistent. */
export function verifyChain(
  docs: {
    doc: Pick<FiscalDocument, 'invoiceDate' | 'systemEntryDate' | 'number' | 'totals'>;
    hash: string;
    previousHash: string;
  }[],
  signer: DocumentSigner = defaultSigner,
): boolean {
  let expectedPrev = GENESIS_HASH;
  for (const entry of docs) {
    if (entry.previousHash !== expectedPrev) {
      return false;
    }
    if (computeDocumentHash(entry.doc, entry.previousHash, signer) !== entry.hash) {
      return false;
    }
    expectedPrev = entry.hash;
  }
  return true;
}
