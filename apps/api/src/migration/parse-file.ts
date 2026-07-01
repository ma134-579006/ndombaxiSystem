import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

const MAX_FILE_BYTES = 15 * 1024 * 1024; // 15MB — o corpo HTTP aceita 20MB (main.ts)
const MAX_ROWS = 50_000; // limite de segurança — nunca deixa o servidor engasgar

export interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Deteta se o texto decodificado tem sinais de "mojibake" (encoding errado) —
 *  ex.: "Ã©"/"Ã§" quando um ficheiro Latin1/Windows-1252 é lido como UTF-8. */
function looksMojibake(text: string): boolean {
  return text.includes('�') || /Ã[-ÿ]|Â[-ÿ]/.test(text.slice(0, 5000));
}

/**
 * Lê .xlsx/.xls (binário) ou .csv/.txt (texto — tenta UTF-8; se detectar
 * "mojibake" nos acentos, tenta novamente como Latin1/Windows-1252, comum em
 * exportações de sistemas de gestão portugueses/angolanos mais antigos).
 */
export function parseUploadedFile(buffer: Buffer, fileName = ''): ParsedFile {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new BadRequestException(`Ficheiro demasiado grande (máx. ${MAX_FILE_BYTES / 1024 / 1024}MB).`);
  }
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  let workbook: XLSX.WorkBook;

  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } else {
    let text = buffer.toString('utf-8');
    if (looksMojibake(text)) text = buffer.toString('latin1');
    workbook = XLSX.read(text, { type: 'string', raw: true });
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BadRequestException('O ficheiro não tem nenhuma folha/tabela legível.');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  if (!rows.length) throw new BadRequestException('O ficheiro não tem linhas de dados (só cabeçalho, ou está vazio).');
  if (rows.length > MAX_ROWS) {
    throw new BadRequestException(`Ficheiro com demasiadas linhas (máx. ${MAX_ROWS.toLocaleString('pt-PT')}).`);
  }
  const headers = Object.keys(rows[0]);
  return { headers, rows };
}
