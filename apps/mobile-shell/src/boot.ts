/**
 * Arranque do motor Offline-First dentro da app móvel.
 *
 * Este módulo é o ponto onde a app móvel liga a MESMA lógica offline do desktop
 * e da web ao armazenamento nativo do telemóvel. Cada frontend (Gestão/Caixa)
 * importa `bootOfflineEngine()` e recebe um motor pronto — sem saber que por
 * baixo está o SQLite do Android/iOS em vez do IndexedDB do navegador.
 *
 * Nota: os frontends web já funcionam offline com IndexedDB. Chamar isto é o
 * PASSO EXTRA que, quando a app é nativa, troca o IndexedDB pelo SQLite nativo
 * (mais robusto, cifrado pelo SO e com backup por ficheiro).
 */
import { Capacitor } from '@capacitor/core';
import { App } from '@capacitor/app';
import {
  SqliteAdapter, SyncEngine, NetMonitor, httpTransport,
  OfflineSessionStore,
} from '@nexus/offline-core';
import { openMobileDatabase } from './sqlite-bridge';
import { mobileDeviceSecret } from './device-secret';

export interface MobileEngine {
  engine: SyncEngine;
  session: OfflineSessionStore;
}

/**
 * @param opts.apiUrl     base da API
 * @param opts.entities   entidades a manter em cache local
 * @param opts.getAuthHeader / getTenantCode  ganchos de sessão do frontend
 */
export async function bootOfflineEngine(opts: {
  apiUrl: string;
  entities: string[];
  getAuthHeader: () => string | null;
  getTenantCode: () => string | null;
  onAuthExpired?: () => void;
}): Promise<MobileEngine | null> {
  // Só faz sentido em nativo. Na WebView de preview (browser), o frontend segue
  // com o seu IndexedDB habitual.
  if (!Capacitor.isNativePlatform()) return null;

  const bridge = await openMobileDatabase();
  const storage = new SqliteAdapter(bridge);
  await storage.open();

  const net = new NetMonitor({ healthUrl: `${opts.apiUrl}/health` });
  const engine = new SyncEngine({
    storage,
    net,
    transport: httpTransport({
      baseUrl: opts.apiUrl,
      getAuthHeader: opts.getAuthHeader,
      getTenantCode: opts.getTenantCode,
    }),
    entities: opts.entities,
    ...(opts.onAuthExpired ? { onAuthExpired: opts.onAuthExpired } : {}),
  });
  await engine.start();

  // ── LIFECYCLE NATIVO ────────────────────────────────────────────────────
  // A razão de a app "voltar congelada" depois de minimizada: no Android/iOS a
  // WebView suspende os temporizadores JS em segundo plano e os eventos `online`
  // / `visibilitychange` — os ÚNICOS gatilhos do NetMonitor — muitas vezes não
  // disparam ao regressar. Ligamos o ciclo de vida do Capacitor (não usado até
  // agora, apesar de `@capacitor/app` estar instalado) e, a cada regresso ao
  // primeiro plano, acordamos o motor à força. A sincronização retoma sozinha,
  // sem o utilizador tocar em nada. `wake()` é idempotente — disparar a dobrar
  // (appStateChange + resume) não faz mal.
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void engine.wake();
  });
  void App.addListener('resume', () => { void engine.wake(); });

  const session = new OfflineSessionStore(storage, mobileDeviceSecret);
  return { engine, session };
}
