import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';
import type { MigrationKind } from './dto/migration.dto';

// Limite REAL de conteúdo: o corpo HTTP aceita 50 MB (main.ts) e o base64 infla
// ~33%, logo o binário útil ronda os 36 MB — deixamos folga em 30 MB.
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_ROWS = 100_000; // limite de segurança — nunca deixa o servidor engasgar

export interface ParsedFile {
  headers: string[];
  rows: Record<string, unknown>[];
}

/** Deteta se o texto decodificado tem sinais de "mojibake" (encoding errado) —
 *  ex.: "Ã©"/"Ã§" quando um ficheiro Latin1/Windows-1252 é lido como UTF-8. */
function looksMojibake(text: string): boolean {
  return text.includes('�') || /Ã[-ÿ]|Â[-ÿ]/.test(text.slice(0, 5000));
}

/** Decodifica um Buffer para texto, tentando UTF-8 e caindo para Latin1. */
function decodeText(buffer: Buffer): string {
  const utf8 = buffer.toString('utf-8');
  return looksMojibake(utf8) ? buffer.toString('latin1') : utf8;
}

/**
 * Lê o ficheiro de origem e devolve linhas tabulares. Suporta:
 *  • .xlsx/.xls/.xlsm — folha de cálculo (binário)
 *  • .csv/.txt        — texto delimitado (UTF-8 ou Latin1)
 *  • .xml             — SAF-T (AO) da AGT: extrai Produtos ou Clientes conforme `kind`
 *  • .sql             — dump com INSERT INTO … VALUES (…): extrai a tabela relevante
 *
 * `kind` é necessário para XML/SAF-T e .sql (o mesmo ficheiro traz produtos E
 * clientes); para Excel/CSV é ignorado (a folha é mapeada por colunas).
 */
export function parseUploadedFile(buffer: Buffer, fileName = '', kind?: MigrationKind): ParsedFile {
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new BadRequestException(
      `Ficheiro demasiado grande (${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB; máx. ${MAX_FILE_BYTES / 1024 / 1024} MB). ` +
      `Divida-o em partes (ex.: por intervalo de datas ou por letra) e importe cada uma.`,
    );
  }
  const ext = fileName.toLowerCase().split('.').pop() ?? '';

  let result: ParsedFile;
  if (ext === 'xlsx' || ext === 'xls' || ext === 'xlsm') {
    result = parseSpreadsheet(buffer);
  } else if (ext === 'xml') {
    result = parseSaftXml(decodeText(buffer), kind);
  } else if (ext === 'sql') {
    result = parseSqlDump(decodeText(buffer), kind);
  } else {
    // CSV/TXT (ou desconhecido) → tenta como texto delimitado.
    result = parseSpreadsheet(buffer, decodeText(buffer));
  }

  if (!result.rows.length) {
    throw new BadRequestException('O ficheiro não tem linhas de dados legíveis (só cabeçalho, vazio, ou formato não reconhecido).');
  }
  if (result.rows.length > MAX_ROWS) {
    throw new BadRequestException(`Ficheiro com demasiadas linhas (${result.rows.length.toLocaleString('pt-PT')}; máx. ${MAX_ROWS.toLocaleString('pt-PT')}). Divida-o em partes.`);
  }
  return result;
}

/** Excel (binário) ou CSV/TXT (texto já decodificado). */
function parseSpreadsheet(buffer: Buffer, asText?: string): ParsedFile {
  const workbook = asText !== undefined
    ? XLSX.read(asText, { type: 'string', raw: true })
    : XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new BadRequestException('O ficheiro não tem nenhuma folha/tabela legível.');
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

// ─────────────────────────── SAF-T (AO) XML ────────────────────────────────

/** Extrai o conteúdo textual da 1.ª tag `<name>…</name>` dentro de `block`. */
function tag(block: string, name: string): string {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  if (!m) return '';
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
    .trim();
}

/** Devolve todos os blocos `<name>…</name>` (sem depender de um parser DOM — não
 *  carrega a árvore inteira em memória, ao contrário de um DOMParser). */
function blocks(xml: string, name: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'gi');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

/**
 * SAF-T (AO): estrutura MasterFiles → Product / Customer. Extraímos os campos
 * standard da AGT e mapeamo-los para os cabeçalhos que o motor de colunas já
 * reconhece (Código, Nome, NIF, …) — assim o resto do fluxo é idêntico ao Excel.
 */
function parseSaftXml(xml: string, kind?: MigrationKind): ParsedFile {
  if (!/<AuditFile|<MasterFiles|SAF-?T/i.test(xml.slice(0, 4000)) && !/<Product>|<Customer>/i.test(xml)) {
    throw new BadRequestException('Este XML não parece um ficheiro SAF-T (AGT). Verifique o ficheiro exportado.');
  }
  if (kind === 'suppliers') {
    // O SAF-T AO tem <Supplier> (opcional). Se não houver, avisa em vez de calar.
    const sups = blocks(xml, 'Supplier').map((b) => ({
      'Nome': tag(b, 'CompanyName') || tag(b, 'SupplierID'),
      'NIF': tag(b, 'SupplierTaxID'),
      'Telefone': tag(b, 'Telephone'),
      'E-mail': tag(b, 'Email'),
      'Morada': tag(b, 'AddressDetail'),
    })).filter((r) => r['Nome']);
    if (!sups.length) throw new BadRequestException('O SAF-T não contém fornecedores (<Supplier>). Exporte os fornecedores em Excel/CSV.');
    return { headers: Object.keys(sups[0]), rows: sups };
  }
  if (kind === 'customers') {
    const custs = blocks(xml, 'Customer').map((b) => ({
      'Nome': tag(b, 'CompanyName') || tag(b, 'Contact') || tag(b, 'CustomerID'),
      'NIF': tag(b, 'CustomerTaxID'),
      'Telefone': tag(b, 'Telephone'),
      'E-mail': tag(b, 'Email'),
      'Morada': [tag(b, 'AddressDetail'), tag(b, 'City'), tag(b, 'PostalCode')].filter(Boolean).join(', '),
    })).filter((r) => r['Nome'] && r['Nome'] !== 'Consumidor Final');
    if (!custs.length) throw new BadRequestException('O SAF-T não contém clientes (<Customer>).');
    return { headers: Object.keys(custs[0]), rows: custs };
  }
  // products (default)
  const prods = blocks(xml, 'Product').map((b) => ({
    'Código': tag(b, 'ProductCode') || tag(b, 'ProductNumberCode'),
    'Nome': tag(b, 'ProductDescription'),
    'Código de barras': tag(b, 'ProductNumberCode'),
    'Categoria': tag(b, 'ProductType'),
  })).filter((r) => r['Nome']);
  if (!prods.length) throw new BadRequestException('O SAF-T não contém produtos (<Product>).');
  return { headers: Object.keys(prods[0]), rows: prods };
}

// ────────────────────────────── SQL dump ───────────────────────────────────

const SQL_TABLE_HINTS: Record<MigrationKind, RegExp> = {
  products: /produt|product|artigo|item/i,
  customers: /client|customer/i,
  suppliers: /fornec|supplier|vendor/i,
};

/**
 * Dump .sql (mysqldump / pg_dump / exportações genéricas): extrai as linhas dos
 * `INSERT INTO <tabela> (colunas) VALUES (…),(…);` cuja tabela combina com o
 * `kind`. Se nenhuma tabela combinar, usa a que tiver mais linhas (o utilizador
 * mapeia as colunas na pré-visualização, como no Excel).
 */
function parseSqlDump(sql: string, kind?: MigrationKind): ParsedFile {
  const inserts = extractInserts(sql);
  if (!inserts.length) throw new BadRequestException('Não encontrei comandos INSERT no ficheiro .sql.');

  const hint = kind ? SQL_TABLE_HINTS[kind] : null;
  const matching = hint ? inserts.filter((i) => hint.test(i.table)) : [];
  const chosen = (matching.length ? matching : inserts)
    .sort((a, b) => b.rows.length - a.rows.length);
  const group = chosen[0];
  // Junta todos os INSERT da MESMA tabela escolhida.
  const all = chosen.filter((g) => g.table === group.table);
  const columns = all[0].columns;
  const rows: Record<string, unknown>[] = [];
  for (const g of all) {
    for (const values of g.rows) {
      const row: Record<string, unknown> = {};
      columns.forEach((c, i) => { row[c] = values[i] ?? ''; });
      rows.push(row);
    }
  }
  if (!rows.length) throw new BadRequestException('Os INSERT do .sql não tinham valores legíveis.');
  return { headers: columns, rows };
}

interface SqlInsert { table: string; columns: string[]; rows: string[][] }

/** Extrai INSERT INTO … (…) VALUES (…),(…); de forma tolerante (aspas, escapes). */
function extractInserts(sql: string): SqlInsert[] {
  const out: SqlInsert[] = [];
  const re = /INSERT\s+INTO\s+[`"']?([\w.]+)[`"']?\s*\(([^)]+)\)\s*VALUES\s*/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    const table = m[1].replace(/^.*\./, ''); // remove schema/prefixo
    const columns = m[2].split(',').map((c) => c.trim().replace(/^[`"']|[`"']$/g, ''));
    const { tuples, end } = readTuples(sql, re.lastIndex);
    re.lastIndex = end; // continua depois do último tuplo consumido
    const rows = tuples.map(splitSqlTuple).filter((v) => v.length === columns.length);
    if (rows.length) out.push({ table, columns, rows });
  }
  return out;
}

/** Lê a lista `(…),(…),(…);` a partir de `start`, respeitando aspas e escapes. */
function readTuples(sql: string, start: number): { tuples: string[]; end: number } {
  const tuples: string[] = [];
  let i = start;
  const n = sql.length;
  while (i < n) {
    while (i < n && /[\s,]/.test(sql[i])) i++;
    if (sql[i] !== '(') break; // fim da lista de VALUES (ex.: ';')
    let depth = 0, inStr = false, quote = '', buf = '';
    for (; i < n; i++) {
      const ch = sql[i];
      if (inStr) {
        if (ch === '\\') { buf += ch + (sql[i + 1] ?? ''); i++; continue; }
        if (ch === quote) { if (sql[i + 1] === quote) { buf += ch + quote; i++; continue; } inStr = false; }
        buf += ch; continue;
      }
      if (ch === "'" || ch === '"') { inStr = true; quote = ch; buf += ch; continue; }
      if (ch === '(') { depth++; if (depth === 1) { buf = ''; continue; } }
      if (ch === ')') { depth--; if (depth === 0) { tuples.push(buf); i++; break; } }
      buf += ch;
    }
  }
  return { tuples, end: i };
}

/** Divide um tuplo "a, 'b,c', NULL" nos seus valores, respeitando aspas. */
function splitSqlTuple(tuple: string): string[] {
  const out: string[] = [];
  let inStr = false, quote = '', buf = '';
  for (let i = 0; i < tuple.length; i++) {
    const ch = tuple[i];
    if (inStr) {
      if (ch === '\\') { buf += sql_unescape(tuple[i + 1] ?? ''); i++; continue; }
      if (ch === quote) { if (tuple[i + 1] === quote) { buf += quote; i++; continue; } inStr = false; continue; }
      buf += ch; continue;
    }
    if (ch === "'" || ch === '"') { inStr = true; quote = ch; continue; }
    if (ch === ',') { out.push(cleanSqlValue(buf)); buf = ''; continue; }
    buf += ch;
  }
  out.push(cleanSqlValue(buf));
  return out;
}

function sql_unescape(ch: string): string {
  return ({ n: '\n', t: '\t', r: '\r', '0': '', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[ch] ?? ch;
}

/** Normaliza um valor SQL não-string (NULL → '', números ficam como texto). */
function cleanSqlValue(raw: string): string {
  const v = raw.trim();
  if (/^null$/i.test(v)) return '';
  return v.replace(/^[`"']|[`"']$/g, '');
}
