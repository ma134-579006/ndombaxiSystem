import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Validação ESTRUTURAL de um SAF-T (AO) contra o XSD SAFTAO1.01_01
 * (`packages/agt-xml/xsd/`, cópia publicada pela assoft-portugal como "Official
 * XSD from the Government of Angola" — o URL oficial da AGT para o XSD não foi
 * encontrado; ver docs/compliance/SAF-T-FACTURACAO.md). Usa o libxml2 compilado
 * para WebAssembly (xmllint-wasm): o mesmo motor que o `xmllint --schema`.
 */
export interface XsdIssue { line: number | null; message: string }
export interface XsdResult { valid: boolean; issues: XsdIssue[] }

let xsd: string | null = null;
export function saftXsdPath(): string {
  return join(__dirname, '..', '..', 'xsd', 'SAFTAO1.01_01.xsd');
}

export async function validateSaftXsd(xml: string): Promise<XsdResult> {
  xsd ??= readFileSync(saftXsdPath(), 'utf8').replace(/^﻿/, '');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { validateXML } = require('xmllint-wasm') as typeof import('xmllint-wasm');
  let r;
  try {
    r = await validateXML({
      xml: [{ fileName: 'saft.xml', contents: xml }],
      schema: [{ fileName: 'SAFTAO1.01_01.xsd', contents: xsd }],
      maxMemoryPages: 16384,
    });
  } catch (e) {
    // XML malformado: o libxml2 pára no parser (não chega à validação).
    return { valid: false, issues: [{ line: null, message: String((e as Error).message ?? e).trim() }] };
  }
  return { valid: r.valid, issues: r.errors.map((e) => ({ line: e.loc?.lineNumber ?? null, message: e.message })) };
}
