/**
 * TURNOS DE CAIXA sem rede — a última peça para a Caixa ser autónoma.
 *
 * Faltava isto para a Caixa funcionar sozinha, no Windows e no Android, sem
 * servidor da loja e sem internet nenhuma. As vendas offline já iam para a
 * memória interna; o TURNO não. E sem turno o dinheiro não fecha.
 *
 * ## Porque é que isto é de dinheiro, e não de conforto
 *
 * O servidor emite a fatura mesmo sem turno aberto (o movimento de caixa é
 * best-effort, `invoice.service.ts`). Logo, se as vendas de um dia offline
 * subissem SEM a abertura do turno ter subido antes, elas entravam — mas o
 * dinheiro não era registado no turno, e o fecho nunca batia certo. O lojista
 * ficava com a gaveta cheia e um relatório a dizer que não vendeu nada.
 *
 * ## A ordem é a garantia
 *
 * ABERTURA → vendas → FECHO. Não é uma sugestão: é a mesma causalidade que o
 * servidor espera (`push.service.ts` ordena por `seq`). Aqui garante-se pela
 * ordem do envio — a abertura vai antes de a fila de vendas ser esvaziada, e o
 * fecho só depois de ela estar vazia.
 *
 * ## O que NÃO se faz aqui
 *
 * Não se calcula o fecho. O posto declara o que CONTOU na gaveta; quem apura o
 * esperado é o servidor, com a mesma agregação do fecho online. Recalcular aqui
 * seria ter duas contabilidades a discordar uma da outra.
 */
import { kvGet, kvSet } from './store';

const CHAVE_TURNO = 'turno.local';
const CHAVE_OPS = 'turno.porEnviar';
const CHAVE_SEQ = 'turno.seq';

/** O turno tal como este aparelho o conhece enquanto não há rede. */
export interface TurnoLocal {
  /** Chave de idempotência: a MESMA em todas as tentativas de envio. */
  opId: string;
  openedAt: string;
  openingFloat: number;
  operatorName: string | null;
  registerCode: string | null;
  /** `open` enquanto se vende; `closed` depois de contado. */
  status: 'open' | 'closed';
  closedAt?: string;
  countedCash?: number;
  notes?: string;
}

/** Uma operação de turno à espera de subir. */
export interface OpTurno {
  opId: string;
  seq: number;
  entity: 'cashSession';
  op: 'create' | 'update';
  localId: string;
  payload: Record<string, unknown>;
}

function uuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Sem `crypto.randomUUID` (WebViews antigas): não se pode ficar sem chave de
  // idempotência — sem ela, um reenvio criaria um segundo turno.
  const b = new Uint8Array(16);
  (c?.getRandomValues ? c.getRandomValues(b) : b.forEach((_, i) => { b[i] = Math.floor(Math.random() * 256); }));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Sequência monotónica deste aparelho. É ela que diz ao servidor o que aconteceu
 * primeiro — e é por isso que fica gravada na memória interna, e não em memória
 * volátil: se a app for morta a meio de um turno, a numeração tem de continuar
 * de onde ia, senão o fecho podia entrar antes da abertura.
 */
async function proximoSeq(): Promise<number> {
  const atual = (await kvGet<number>(CHAVE_SEQ)) ?? 0;
  const seguinte = atual + 1;
  await kvSet(CHAVE_SEQ, seguinte);
  return seguinte;
}

export async function turnoLocal(): Promise<TurnoLocal | null> {
  return (await kvGet<TurnoLocal>(CHAVE_TURNO)) ?? null;
}

/** Turno aberto NESTE aparelho (o que permite continuar a vender sem rede). */
export async function turnoAbertoLocal(): Promise<TurnoLocal | null> {
  const t = await turnoLocal();
  return t && t.status === 'open' ? t : null;
}

async function ops(): Promise<OpTurno[]> {
  return (await kvGet<OpTurno[]>(CHAVE_OPS)) ?? [];
}

async function guardarOps(lista: OpTurno[]): Promise<void> {
  await kvSet(CHAVE_OPS, lista);
}

/** Operações de turno à espera de subir, sempre por ordem de acontecimento. */
export async function opsDeTurnoPendentes(): Promise<OpTurno[]> {
  return (await ops()).sort((a, b) => a.seq - b.seq);
}

/** Quantas operações de turno faltam enviar (entra na contagem do que falta). */
export async function contarOpsDeTurno(): Promise<number> {
  return (await ops()).length;
}

/** O servidor aceitou (ou reconheceu como repetida): sai da fila. */
export async function opDeTurnoEnviada(opId: string): Promise<void> {
  await guardarOps((await ops()).filter((o) => o.opId !== opId));
}

/**
 * Abre o turno SEM rede. O turno passa a existir para este aparelho de
 * imediato — o operador vende já — e fica uma operação por subir.
 */
export async function abrirTurnoOffline(input: {
  openingFloat: number; operatorName?: string | null; registerCode?: string | null;
}): Promise<TurnoLocal> {
  const aberto = await turnoAbertoLocal();
  // Dois turnos abertos ao mesmo tempo neste posto seria dinheiro sem dono.
  if (aberto) return aberto;

  const turno: TurnoLocal = {
    opId: uuid(),
    openedAt: new Date().toISOString(),
    openingFloat: Number(input.openingFloat) || 0,
    operatorName: input.operatorName ?? null,
    registerCode: input.registerCode ?? null,
    status: 'open',
  };
  await kvSet(CHAVE_TURNO, turno);
  await guardarOps([...(await ops()), {
    opId: turno.opId,
    seq: await proximoSeq(),
    entity: 'cashSession',
    op: 'create',
    localId: turno.opId,
    payload: {
      openingFloat: turno.openingFloat,
      ...(turno.registerCode ? { registerCode: turno.registerCode } : {}),
    },
  }]);
  return turno;
}

/**
 * Fecha o turno SEM rede, declarando o que foi contado na gaveta.
 *
 * O fecho recebe uma chave PRÓPRIA: abertura e fecho são duas operações
 * distintas para o servidor, e partilhar a chave faria a segunda ser tomada por
 * repetição da primeira e descartada em silêncio.
 */
export async function fecharTurnoOffline(input: {
  countedCash: number; notes?: string;
}): Promise<TurnoLocal | null> {
  const t = await turnoAbertoLocal();
  if (!t) return null;

  const fechado: TurnoLocal = {
    ...t,
    status: 'closed',
    closedAt: new Date().toISOString(),
    countedCash: Number(input.countedCash) || 0,
    notes: input.notes,
  };
  await kvSet(CHAVE_TURNO, fechado);
  await guardarOps([...(await ops()), {
    opId: uuid(),
    seq: await proximoSeq(),
    entity: 'cashSession',
    op: 'update',
    localId: t.opId,
    payload: {
      countedCash: fechado.countedCash,
      ...(fechado.notes ? { notes: fechado.notes } : {}),
    },
  }]);
  return fechado;
}

/**
 * O turno local deixa de ser preciso: o servidor já é a autoridade outra vez.
 * Só se limpa quando NÃO há nada por enviar — apagar antes seria perder o fecho
 * que ainda não subiu.
 */
export async function limparTurnoLocalSeVazio(): Promise<void> {
  if ((await ops()).length > 0) return;
  const t = await turnoLocal();
  if (t && t.status === 'closed') await kvSet(CHAVE_TURNO, null);
}
