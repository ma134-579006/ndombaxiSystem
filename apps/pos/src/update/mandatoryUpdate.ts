/**
 * Atualização obrigatória — o lado da Caixa.
 *
 * A decisão (se tranca, se avisa, se ignora) NÃO está aqui: está em
 * `@nexus/update-core`, onde se pode provar. Aqui trata-se do que é próprio
 * desta aplicação: qual é a plataforma, que versão está instalada, e — o mais
 * importante — **esvaziar a fila de vendas antes de trancar seja o que for**.
 *
 * Regras de comportamento que se veem no código abaixo:
 *   • a verificação corre em segundo plano e nunca atrasa a abertura. Quem abre
 *     a caixa às 8h tem clientes à espera;
 *   • sem internet não acontece nada — nem erro, nem bloqueio;
 *   • no NAVEGADOR isto está desligado: o site atualiza-se sozinho ao recarregar
 *     (`autoUpdate.ts`), e trancar um separador do browser não faria sentido.
 */
import { decideUpdate, readyToBlock, type UpdateDecision } from '@nexus/update-core';
import { API_URL } from '../config';
import { syncController } from '../offline/sync';
import { listPendingSales } from '../offline/db';

/** Tempo até à 1.ª verificação. A app já está a ser usada; ninguém repara. */
const FIRST_CHECK_MS = 4_000;
/** Postos ficam ligados dias seguidos — daí voltar a perguntar. */
const EVERY_MS = 6 * 60 * 60 * 1000;
/** Curto: isto é de segundo plano, ninguém espera por uma verificação. */
const TIMEOUT_MS = 10_000;
/** Com pendentes por enviar, volta a olhar para a fila neste ritmo. */
const DRAIN_TICK_MS = 5_000;

export interface UpdateGateState {
  /** `null` = ainda não se sabe (ou não se aplica a esta plataforma). */
  decision: UpdateDecision | null;
  /** Tranca o ecrã: sem saída, sem cancelar, sem fechar. */
  blocking: boolean;
  /** A enviar o que faltava antes de trancar — mostra-se ao utilizador. */
  draining: boolean;
  /** Operações por enviar (o que falta salvar antes de trancar). */
  pending: number;
}

type Listener = (s: UpdateGateState) => void;

interface DesktopHost { platform?: string; version?(): Promise<string> }

function desktop(): DesktopHost | null {
  const w = window as unknown as { ndombaxi?: DesktopHost };
  return w.ndombaxi ?? null;
}

interface CapApp { getInfo?(): Promise<{ version?: string }> }
function capacitorApp(): CapApp | null {
  const w = window as unknown as { Capacitor?: { Plugins?: { App?: CapApp } } };
  return w.Capacitor?.Plugins?.App ?? null;
}

/**
 * Que plataforma é esta instalação — `null` quando a atualização obrigatória não
 * se aplica (navegador).
 */
/** Versão gravada no empacotamento da app móvel (ver `prepare-web.mjs`). */
function bakedVersion(): string | null {
  const w = window as unknown as { __NDOMBAXI_APP_VERSION__?: string };
  return typeof w.__NDOMBAXI_APP_VERSION__ === 'string' ? w.__NDOMBAXI_APP_VERSION__ : null;
}

export function platformOfThisApp(): 'windows' | 'android' | null {
  if (typeof window === 'undefined') return null;
  if (desktop()?.version) return 'windows';
  if (bakedVersion() || capacitorApp()?.getInfo) return 'android';
  return null;
}

/** A versão REALMENTE instalada. */
async function installedVersion(): Promise<string | null> {
  try {
    const d = desktop();
    if (d?.version) return await d.version();
    // No Android prefere-se a versão GRAVADA no empacotamento: não depende de
    // nenhum plugin responder a tempo. O plugin fica como reserva.
    const gravada = bakedVersion();
    if (gravada) return gravada;
    const capApp = capacitorApp();
    if (capApp?.getInfo) return (await capApp.getInfo()).version ?? null;
  } catch { /* o lado nativo não respondeu — trata-se como desconhecida */ }
  return null;
}

/**
 * Pergunta ao servidor OFICIAL qual é a versão publicada. Devolve `null` em
 * qualquer falha — e `null` significa, em `decideUpdate`, "não trancar".
 */
async function fetchOfficialRelease(platform: string): Promise<unknown> {
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${API_URL}/downloads/latest?platform=${platform}`, {
        signal: ctrl.signal, cache: 'no-store', headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      return await res.json();
    } finally {
      window.clearTimeout(t);
    }
  } catch {
    return null; // sem rede, DNS em baixo, servidor a dormir
  }
}

class MandatoryUpdate {
  private state: UpdateGateState = { decision: null, blocking: false, draining: false, pending: 0 };
  private listeners = new Set<Listener>();
  private started = false;
  private drainTimer: number | null = null;

  getState(): UpdateGateState { return this.state; }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => { this.listeners.delete(fn); };
  }

  private emit(patch: Partial<UpdateGateState>): void {
    this.state = { ...this.state, ...patch };
    for (const fn of this.listeners) fn(this.state);
  }

  /**
   * `tentativas` existe por causa da ordem de arranque: isto corre no momento em
   * que o bundle é carregado, e no Android os plugins do Capacitor podem ainda
   * não estar registados nesse instante. Desistir à primeira deixava a app
   * NUNCA verificar a versão — uma atualização de segurança obrigatória não
   * chegaria a esses aparelhos, e ninguém daria por isso.
   */
  start(tentativas = 10): void {
    if (this.started || typeof window === 'undefined') return;
    const platform = platformOfThisApp();
    if (!platform) {
      // Navegador: não se aplica (o site atualiza-se ao recarregar). App cujo
      // lado nativo ainda não respondeu: volta a olhar daqui a um segundo.
      if (tentativas > 0) window.setTimeout(() => this.start(tentativas - 1), 1_000);
      return;
    }
    this.started = true;

    const run = () => { void this.check(platform); };
    window.setTimeout(run, FIRST_CHECK_MS);
    window.setInterval(run, EVERY_MS);
    // A internet voltou depois de dias offline: é exatamente a altura de olhar.
    window.addEventListener('online', run);
    window.addEventListener('focus', run);
  }

  private async check(platform: string): Promise<void> {
    const current = await installedVersion();
    const raw = await fetchOfficialRelease(platform);
    const decision = decideUpdate(current, raw, { platform });
    this.emit({ decision });
    if (decision.state === 'mandatory') this.beginDrain();
  }

  /**
   * A parte que evita perder dias de trabalho: antes de trancar, esvaziar a fila.
   *
   * Enquanto houver pendentes **não se tranca**. Com rede, empurra-se a fila;
   * sem rede, a Caixa continua a vender normalmente e volta-se a olhar quando a
   * ligação regressar. Só com a fila a zero é que o ecrã fecha.
   */
  private beginDrain(): void {
    if (this.drainTimer !== null) return;
    const tick = async () => {
      const s = syncController.getState();
      // Conta-se a fila DIRETAMENTE, e não pelo `pending` do motor: ele só é
      // atualizado depois de o motor arrancar, o que acontece já dentro da
      // sessão. Sem isto, uma Caixa parada no ecrã de login — com vendas de
      // ontem ainda por enviar — seria dada como vazia e trancada por cima delas.
      //
      // Só se contam as que ESTÃO POR ENVIAR. As marcadas com erro foram
      // recusadas pelo servidor e esperam por uma pessoa; nunca desapareceriam
      // sozinhas e adiariam para sempre uma atualização de segurança. Não se
      // perdem: ficam na base do aparelho e continuam lá na versão nova.
      const fila = await listPendingSales().catch(() => []);
      const pending = fila.filter((v) => v.status === 'PENDING').length;
      this.emit({ pending });
      const verdict = readyToBlock({ pending, online: s.online, syncing: s.syncing });
      if (verdict.canBlock) {
        if (this.drainTimer !== null) { window.clearInterval(this.drainTimer); this.drainTimer = null; }
        this.emit({ blocking: true, draining: false });
        return;
      }
      this.emit({ draining: verdict.syncFirst || s.syncing });
      if (verdict.syncFirst) void syncController.flush();
    };
    void tick();
    if (!this.state.blocking) this.drainTimer = window.setInterval(() => { void tick(); }, DRAIN_TICK_MS);
  }
}

export const mandatoryUpdate = new MandatoryUpdate();
