/**
 * Conversão de valores entre o PGlite e o Prisma.
 *
 * ⚠️ Este ficheiro é a peça mais delicada do adapter, e a razão é simples: o
 * Prisma NÃO recebe os valores como o driver os quer dar. Espera-os na forma
 * EXACTA que o `@prisma/adapter-pg` produz contra o PostgreSQL da nuvem. Se um
 * `numeric` chegar como número em vez de texto, os cêntimos de uma fatura
 * arredondam; se um `timestamp` chegar como `Date` em vez do texto normalizado,
 * a data muda de fuso. O telemóvel e a nuvem passariam a discordar sobre
 * dinheiro e sobre datas — e ninguém daria por isso até ao fecho do mês.
 *
 * Por isso as tabelas abaixo são deliberadamente ESPELHOS do adapter oficial do
 * PostgreSQL. Onde o PGlite já entrega o mesmo (bool, int4, bytea), deixa-se o
 * que ele traz; onde entrega diferente (int8, json, datas), sobrepõe-se.
 */
import { ColumnTypeEnum, type ArgType, type ColumnType } from '@prisma/driver-adapter-utils';

/** O primeiro OID que o PostgreSQL atribui a tipos criados pelo utilizador. */
const FIRST_NORMAL_OBJECT_ID = 16384;

/** OIDs dos tipos escalares (os mesmos números em qualquer PostgreSQL). */
const T = {
  BOOL: 16,
  BYTEA: 17,
  CHAR: 18,
  NAME: 19,
  INT8: 20,
  INT2: 21,
  INT4: 23,
  TEXT: 25,
  OID: 26,
  JSON: 114,
  XML: 142,
  CIDR: 650,
  FLOAT4: 700,
  FLOAT8: 701,
  MONEY: 790,
  INET: 869,
  BPCHAR: 1042,
  VARCHAR: 1043,
  DATE: 1082,
  TIME: 1083,
  TIMESTAMP: 1114,
  TIMESTAMPTZ: 1184,
  TIMETZ: 1266,
  BIT: 1560,
  VARBIT: 1562,
  NUMERIC: 1700,
  UUID: 2950,
  JSONB: 3802,
} as const;

/** OIDs dos tipos-lista correspondentes. */
const A = {
  BIT: 1561,
  BOOL: 1000,
  BYTEA: 1001,
  BPCHAR: 1014,
  CHAR: 1002,
  CIDR: 651,
  DATE: 1182,
  FLOAT4: 1021,
  FLOAT8: 1022,
  INET: 1041,
  INT2: 1005,
  INT4: 1007,
  INT8: 1016,
  JSONB: 3807,
  JSON: 199,
  MONEY: 791,
  NUMERIC: 1231,
  OID: 1028,
  TEXT: 1009,
  TIMESTAMP: 1115,
  TIMESTAMPTZ: 1185,
  TIME: 1183,
  UUID: 2951,
  VARBIT: 1563,
  VARCHAR: 1015,
  XML: 143,
} as const;

/** Uma coluna que o Prisma não sabe transportar — falha cedo e com nome. */
export class UnsupportedNativeDataType extends Error {
  constructor(public readonly oid: number) {
    super(`Tipo de coluna não suportado (OID ${oid})`);
    this.name = 'UnsupportedNativeDataType';
  }
}

/** OID do PostgreSQL → o tipo que o motor do Prisma espera. */
export function fieldToColumnType(oid: number): ColumnType {
  switch (oid) {
    case T.INT2:
    case T.INT4:
      return ColumnTypeEnum.Int32;
    case T.INT8:
    case T.OID:
      return ColumnTypeEnum.Int64;
    case T.FLOAT4:
      return ColumnTypeEnum.Float;
    case T.FLOAT8:
      return ColumnTypeEnum.Double;
    case T.BOOL:
      return ColumnTypeEnum.Boolean;
    case T.DATE:
      return ColumnTypeEnum.Date;
    case T.TIME:
    case T.TIMETZ:
      return ColumnTypeEnum.Time;
    case T.TIMESTAMP:
    case T.TIMESTAMPTZ:
      return ColumnTypeEnum.DateTime;
    case T.NUMERIC:
    case T.MONEY:
      return ColumnTypeEnum.Numeric;
    case T.JSON:
    case T.JSONB:
      return ColumnTypeEnum.Json;
    case T.UUID:
      return ColumnTypeEnum.Uuid;
    case T.BPCHAR:
    case T.TEXT:
    case T.VARCHAR:
    case T.CHAR:
    case T.BIT:
    case T.VARBIT:
    case T.INET:
    case T.CIDR:
    case T.XML:
    case T.NAME:
      return ColumnTypeEnum.Text;
    case T.BYTEA:
      return ColumnTypeEnum.Bytes;
    case A.INT2:
    case A.INT4:
      return ColumnTypeEnum.Int32Array;
    case A.INT8:
    case A.OID:
      return ColumnTypeEnum.Int64Array;
    case A.FLOAT4:
      return ColumnTypeEnum.FloatArray;
    case A.FLOAT8:
      return ColumnTypeEnum.DoubleArray;
    case A.NUMERIC:
    case A.MONEY:
      return ColumnTypeEnum.NumericArray;
    case A.BOOL:
      return ColumnTypeEnum.BooleanArray;
    case A.CHAR:
      return ColumnTypeEnum.CharacterArray;
    case A.BPCHAR:
    case A.TEXT:
    case A.VARCHAR:
    case A.VARBIT:
    case A.BIT:
    case A.INET:
    case A.CIDR:
    case A.XML:
      return ColumnTypeEnum.TextArray;
    case A.DATE:
      return ColumnTypeEnum.DateArray;
    case A.TIME:
      return ColumnTypeEnum.TimeArray;
    case A.TIMESTAMP:
    case A.TIMESTAMPTZ:
      return ColumnTypeEnum.DateTimeArray;
    case A.JSON:
    case A.JSONB:
      return ColumnTypeEnum.JsonArray;
    case A.BYTEA:
      return ColumnTypeEnum.BytesArray;
    case A.UUID:
      return ColumnTypeEnum.UuidArray;
    default:
      // Tipos criados pela própria empresa (ENUMs do schema do tenant) viajam
      // como texto — é o que o adapter oficial faz.
      if (oid >= FIRST_NORMAL_OBJECT_ID) return ColumnTypeEnum.Text;
      throw new UnsupportedNativeDataType(oid);
  }
}

// ── Normalizações (idênticas às do adapter oficial do PostgreSQL) ──────────

const asIs = (v: string): string => v;
/** `2026-08-05 10:00:00` → `2026-08-05T10:00:00+00:00` (o Prisma exige o T). */
const normalizeTimestamp = (v: string): string => `${v.replace(' ', 'T')}+00:00`;
const normalizeTimestamptz = (v: string): string =>
  v.replace(' ', 'T').replace(/[+-]\d{2}(:\d{2})?$/, '+00:00');
const normalizeTimetz = (v: string): string => v.replace(/[+-]\d{2}(:\d{2})?$/, '');
/** `Kz 1.500,00` → sem o símbolo, como o Prisma espera um numeric. */
const normalizeMoney = (v: string): string => v.slice(1);

/**
 * Leitor de listas do PostgreSQL (`{a,b,"c,d"}`) — escrito aqui de propósito
 * para o pacote não trazer dependências: no telemóvel, cada dependência é peso
 * no APK e mais uma coisa que pode não existir para Android.
 */
export function parseArrayText(text: string, element: (v: string) => unknown): unknown[] {
  if (!text.startsWith('{')) return [];
  const out: unknown[] = [];
  let i = 1;
  let buf = '';
  let quoted = false;
  let sawContent = false;

  const push = (): void => {
    if (!sawContent && buf === '') return;
    out.push(!quoted && buf === 'NULL' ? null : element(buf));
    buf = '';
    quoted = false;
    sawContent = false;
  };

  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '\\') buf += text[++i];
      else if (c === '"') { quoted = false; sawContent = true; push(); }
      else buf += c;
      continue;
    }
    if (c === '"') { quoted = true; sawContent = true; continue; }
    if (c === ',') { push(); continue; }
    if (c === '}') { push(); break; }
    buf += c;
    sawContent = true;
  }
  return out;
}

const arrayOf =
  (element: (v: string) => unknown) =>
  (v: string): unknown[] =>
    parseArrayText(v, element);

const parseBytea = (v: string): Uint8Array => {
  const hex = v.slice(2); // salta o `\x`
  return Uint8Array.from({ length: hex.length / 2 }, (_, i) =>
    parseInt(hex.substring(i * 2, i * 2 + 2), 16),
  );
};

/**
 * Sobreposições aos leitores do PGlite.
 *
 * Só entram aqui os tipos em que o PGlite entrega algo DIFERENTE do que o
 * Prisma recebe da nuvem:
 *   • int8  — o PGlite dá número; o Prisma espera TEXTO (senão perde precisão);
 *   • json  — o PGlite já converte em objeto; o Prisma quer o texto cru;
 *   • datas — o PGlite dá `Date`; o Prisma quer texto normalizado em UTC;
 *   • listas — o PGlite converteria cada elemento com os leitores DELE.
 * Os restantes (bool, int4, float, bytea, uuid, texto) já coincidem.
 */
export const parsers: Record<number, (value: string) => unknown> = {
  [T.INT8]: asIs,
  [T.NUMERIC]: asIs,
  [T.MONEY]: normalizeMoney,
  [T.JSON]: asIs,
  [T.JSONB]: asIs,
  [T.DATE]: asIs,
  [T.TIME]: asIs,
  [T.TIMETZ]: normalizeTimetz,
  [T.TIMESTAMP]: normalizeTimestamp,
  [T.TIMESTAMPTZ]: normalizeTimestamptz,

  [A.INT2]: arrayOf(Number),
  [A.INT4]: arrayOf(Number),
  [A.INT8]: arrayOf(asIs),
  [A.OID]: arrayOf(asIs),
  [A.FLOAT4]: arrayOf(Number),
  [A.FLOAT8]: arrayOf(Number),
  [A.NUMERIC]: arrayOf(asIs),
  [A.MONEY]: arrayOf(normalizeMoney),
  [A.BOOL]: arrayOf((v) => v === 't'),
  [A.TEXT]: arrayOf(asIs),
  [A.VARCHAR]: arrayOf(asIs),
  [A.BPCHAR]: arrayOf(asIs),
  [A.CHAR]: arrayOf(asIs),
  [A.BIT]: arrayOf(asIs),
  [A.VARBIT]: arrayOf(asIs),
  [A.INET]: arrayOf(asIs),
  [A.CIDR]: arrayOf(asIs),
  [A.XML]: arrayOf(asIs),
  [A.UUID]: arrayOf(asIs),
  [A.JSON]: arrayOf(asIs),
  [A.JSONB]: arrayOf(asIs),
  [A.DATE]: arrayOf(asIs),
  [A.TIME]: arrayOf(asIs),
  [A.TIMESTAMP]: arrayOf(normalizeTimestamp),
  [A.TIMESTAMPTZ]: arrayOf(normalizeTimestamptz),
  [A.BYTEA]: arrayOf(parseBytea),
};

// ── Do lado de fora: os valores que a aplicação envia ──────────────────────

const pad = (n: number, z = 2): string => String(n).padStart(z, '0');

const formatDateTime = (d: Date): string =>
  `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
  (d.getUTCMilliseconds() ? `.${pad(d.getUTCMilliseconds(), 3)}` : '');

const formatDate = (d: Date): string =>
  `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const formatTime = (d: Date): string =>
  `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}` +
  (d.getUTCMilliseconds() ? `.${pad(d.getUTCMilliseconds(), 3)}` : '');

/**
 * Prepara um parâmetro para o PGlite.
 *
 * Tudo o que é data sai daqui já em TEXTO UTC: assim o valor não depende do
 * fuso do telemóvel — um posto em Luanda e a nuvem gravam o mesmo instante.
 */
export function mapArg(arg: unknown, argType: ArgType): unknown {
  if (arg === null || arg === undefined) return null;

  if (Array.isArray(arg) && argType.arity === 'list') {
    return arg.map((v) => mapArg(v, { ...argType, arity: 'scalar' }));
  }

  let value = arg;
  if (typeof value === 'string' && argType.scalarType === 'datetime') value = new Date(value);

  if (value instanceof Date) {
    switch (argType.dbType) {
      case 'TIME':
      case 'TIMETZ':
        return formatTime(value);
      case 'DATE':
        return formatDate(value);
      default:
        return formatDateTime(value);
    }
  }

  // O Prisma transporta binários em base64.
  if (typeof value === 'string' && argType.scalarType === 'bytes') {
    return Uint8Array.from(Buffer.from(value, 'base64'));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (typeof value === 'bigint') return value.toString();

  return value;
}
