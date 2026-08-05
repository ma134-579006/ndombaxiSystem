/**
 * O SERVIDOR DA LOJA — como um telemóvel encontra e usa o servidor do balcão.
 *
 * É esta peça que dá ao Android o sistema COMPLETO sem internet. Não é uma cópia
 * parcial nem um modo só-leitura: compras, stock, RH, relatórios — tudo — passam
 * a ser respondidos pela MESMA API, a correr no computador da loja, na mesma
 * sala. Um telemóvel sozinho nunca poderá fazer isto: os módulos do sistema
 * vivem numa API sobre PostgreSQL, e não se corre PostgreSQL num telemóvel.
 * Reescrever cada módulo contra SQLite seria refazer o produto inteiro — e num
 * sistema com certificação fiscal seria refazê-lo com o risco todo.
 *
 * As regras abaixo existem porque um endereço mal escolhido pode ser pior do que
 * não ter nenhum:
 *
 *  • Só endereços da REDE LOCAL. Se alguém colasse aqui um endereço público, o
 *    aparelho da loja passaria a mandar as vendas para uma máquina desconhecida.
 *  • Só `http` para a rede local (não há certificados válidos para `192.168.x.x`)
 *    e `https` para nomes próprios, se alguém os tiver.
 *  • O servidor da loja NUNCA é definitivo. Assim que deixa de responder — o
 *    empregado saiu da loja, o computador foi desligado — o aparelho volta à
 *    nuvem sozinho. Ficar preso a um endereço morto seria transformar um
 *    telemóvel que funcionava num telemóvel que não faz nada.
 */

/** Quantas falhas seguidas até desistir do servidor da loja (por agora). */
export const FALHAS_ATE_DESISTIR = 3;
/** Quanto tempo se fica na nuvem antes de voltar a tentar a loja. */
export const DESCANSO_MS = 2 * 60_000;

export interface ShopServerState {
  /** Endereço escolhido pelo responsável, ou `null` se nunca configurado. */
  url: string | null;
  /** Falhas de rede seguidas contra esse endereço. */
  failures: number;
  /** Até quando se deve usar a nuvem em vez da loja (epoch ms). */
  restingUntil: number | null;
}

export const ESTADO_INICIAL: ShopServerState = { url: null, failures: 0, restingUntil: null };

/**
 * Endereços que se aceitam como "servidor da loja".
 *
 * As gamas privadas são as do RFC 1918 mais o `localhost` — exatamente onde um
 * computador de loja vive. Um endereço público seria um aparelho a entregar as
 * vendas da empresa a uma máquina que ninguém controla.
 */
function ehEnderecoDaRedeLocal(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (m.slice(1).some((n) => Number(n) > 255)) return false;
  if (a === 10) return true;                       // 10.0.0.0/8
  if (a === 192 && b === 168) return true;         // 192.168.0.0/16
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  return false;
}

export interface EnderecoValido { ok: true; url: string }
export interface EnderecoInvalido { ok: false; motivo: string }

/**
 * Lê o que o utilizador escreveu (ou o que veio do código QR) e devolve um
 * endereço utilizável — ou a razão pela qual não serve, em português simples.
 */
export function normalizarEndereco(bruto: unknown): EnderecoValido | EnderecoInvalido {
  if (typeof bruto !== 'string' || !bruto.trim()) {
    return { ok: false, motivo: 'Escreva o endereço do servidor da loja.' };
  }
  let texto = bruto.trim();
  // Quem lê um endereço do ecrã do balcão escreve "192.168.1.50:3399".
  if (!/^https?:\/\//i.test(texto)) texto = `http://${texto}`;

  let u: URL;
  try {
    u = new URL(texto);
  } catch {
    return { ok: false, motivo: 'Esse endereço não é válido.' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, motivo: 'O endereço tem de começar por http.' };
  }
  const local = ehEnderecoDaRedeLocal(u.hostname);
  if (u.protocol === 'http:' && !local) {
    return {
      ok: false,
      motivo: 'Só se aceita o servidor da própria loja (endereço da rede local).',
    };
  }
  // Sem caminho, sem interrogação: é uma base, não uma página.
  return { ok: true, url: `${u.protocol}//${u.host}` };
}

/**
 * Qual o endereço a usar AGORA: o da loja ou o da nuvem.
 *
 * Repare-se no que isto faz de propósito: nunca devolve o servidor da loja
 * quando ele está "a descansar". Um aparelho que saiu da loja continua a
 * trabalhar pela nuvem em vez de bater num computador que já não alcança.
 */
export function escolherBase(
  estado: ShopServerState,
  nuvem: string,
  agora: number = Date.now(),
): { base: string; usandoLoja: boolean } {
  if (!estado.url) return { base: nuvem, usandoLoja: false };
  if (estado.restingUntil != null && agora < estado.restingUntil) {
    return { base: nuvem, usandoLoja: false };
  }
  return { base: estado.url, usandoLoja: true };
}

/**
 * Uma falha de REDE contra o servidor da loja (não uma recusa dele).
 *
 * A distinção é o que impede um engano grosseiro: se o servidor responde "senha
 * errada", ele está vivo e continua a ser o servidor certo. Só o silêncio conta.
 */
export function anotarFalha(estado: ShopServerState, agora: number = Date.now()): ShopServerState {
  const failures = estado.failures + 1;
  return {
    ...estado,
    failures,
    restingUntil: failures >= FALHAS_ATE_DESISTIR ? agora + DESCANSO_MS : estado.restingUntil,
  };
}

/** O servidor da loja respondeu: esquece o histórico de falhas. */
export function anotarSucesso(estado: ShopServerState): ShopServerState {
  if (estado.failures === 0 && estado.restingUntil == null) return estado;
  return { ...estado, failures: 0, restingUntil: null };
}

/** Deixar de usar o servidor da loja (o responsável desligou). */
export function esquecerLoja(): ShopServerState {
  return { ...ESTADO_INICIAL };
}
