/**
 * Atualização obrigatória — o lado do Gestor.
 *
 * Gémeo do ficheiro com o mesmo nome na Caixa. A decisão (trancar, avisar,
 * ignorar) vive em `@nexus/update-core`, onde se prova; aqui trata-se do que é
 * próprio desta aplicação: a plataforma, a versão instalada e **esvaziar o que
 * está por enviar antes de trancar**.
 *
 * A diferença face à Caixa é o motor de sincronização: o Gestor usa o
 * `SyncEngine` do `@nexus/offline-core`, a Caixa tem a sua própria fila de
 * vendas. A regra de quando se pode trancar é a mesma nos dois.
 *
 * No NAVEGADOR isto está desligado: o site atualiza-se sozinho ao recarregar
 * (`autoUpdate.ts`) e trancar um separador não faria sentido.
 */
import { decideUpdate, readyToBlock, type UpdateDecision } from '@nexus/update-core';
import { API_URL } from '../config';
import { getOfflineEngine, getSyncStatus } from '../offline/boot';

const FIRST_CHECK_MS = 4_000;
const EVERY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 10_000;
const DRAIN_TICK_MS = 5_000;

export interface UpdateGateState {
  decision: UpdateDecision | null;
  blocking: boolean;
  draining: boolean;
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
  } catch { /* o lado nativo não respondeu */ }
  return null;
}

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
    return null;
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
      if (tentativas > 0) window.setTimeout(() => this.start(tentativas - 1), 1_000);
      return;
    }
    this.started = true;
    const run = () => { void this.check(platform); };
    window.setTimeout(run, FIRST_CHECK_MS);
    window.setInterval(run, EVERY_MS);
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
   * Esvaziar antes de trancar. Enquanto houver operações por subir não se
   * tranca: com rede, empurra-se; sem rede, o Gestor continua a trabalhar e
   * volta-se a olhar quando a ligação regressar.
   */
  private beginDrain(): void {
    if (this.drainTimer !== null) return;
    const tick = () => {
      const st = getSyncStatus();
      // Sem motor offline a correr não há fila local — nada a salvar.
      //
      // Conta-se `pending` (sobe sozinho) e NÃO `blocked`. As operações
      // bloqueadas esperam por uma decisão humana e podiam nunca desaparecer —
      // adiariam para sempre uma atualização de segurança. Não se perdem: ficam
      // na base local do aparelho, que sobrevive à atualização, e continuam lá
      // para serem resolvidas na versão nova.
      const pending = st ? st.pending : 0;
      const online = st ? st.link === 'ONLINE' : true;
      const syncing = st ? st.syncing : false;
      this.emit({ pending });
      const verdict = readyToBlock({ pending, online, syncing });
      if (verdict.canBlock) {
        if (this.drainTimer !== null) { window.clearInterval(this.drainTimer); this.drainTimer = null; }
        this.emit({ blocking: true, draining: false });
        return;
      }
      this.emit({ draining: verdict.syncFirst || syncing });
      if (verdict.syncFirst) void getOfflineEngine()?.sync();
    };
    tick();
    if (!this.state.blocking) this.drainTimer = window.setInterval(tick, DRAIN_TICK_MS);
  }
}

export const mandatoryUpdate = new MandatoryUpdate();
