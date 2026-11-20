import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { IntegrationsService } from '../integrations/integrations.service';

/** Chave da integração no Super Admin › Integrações. */
export const PUBLIC_WEBCAMS_KEY = 'PUBLIC_WEBCAMS';
/** `WINDY_WEBCAMS_URL` só serve para testes (servidor simulado). */
const WINDY_URL = process.env.WINDY_WEBCAMS_URL || 'https://api.windy.com/webcams/api/v3/webcams';
/**
 * OpenStreetMap (Overpass): webcams PÚBLICAS registadas no mapa (tags `webcam` /
 * `contact:webcam`) — SEM CHAVE, funciona sempre e automaticamente.
 * `OVERPASS_URL` só serve para testes.
 */
const OVERPASS_URLS = process.env.OVERPASS_URL
  ? [process.env.OVERPASS_URL]
  : ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
/**
 * Os servidores Overpass recusam/atrasam pedidos sem um User-Agent "com significado"
 * (nome da aplicação + endereço). Com o antigo `lps-vendas-api` a pesquisa dava sempre
 * "indisponível" (406/429/tempo esgotado).
 */
const OVERPASS_UA = 'LPS-Vendas/3.0 (+https://ndombaxisystem.com; camaras publicas)';
/** Acima disto a consulta "à volta de um ponto" esgota o tempo nos servidores públicos. */
const OSM_MAX_KM = 50;
/** A Windy aceita no máximo 250 km no filtro `nearby`. */
const MAX_RADIUS_KM = 250;
/** As imagens do plano gratuito da Windy expiram em 10 min — a cache fica abaixo disso. */
const CACHE_MS = 5 * 60 * 1000;
/** Só OpenStreetMap: as câmaras não mudam de sítio, o resultado vale 6 h. */
const OSM_CACHE_MS = 6 * 60 * 60 * 1000;
/** Com o OpenStreetMap em baixo, serve o último resultado bom até 7 dias. */
const STALE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PublicWebcam {
  id: string;
  title: string;
  lat: number;
  lng: number;
  city: string | null;
  /** Imagem actual (pré-visualização). */
  image: string | null;
  /** Página do leitor (dia / ao vivo) para embutir num iframe. */
  player: string | null;
  /** Página pública da câmara (Windy ou o site do dono). */
  pageUrl: string;
  updatedAt: string | null;
  /** De onde veio: Windy Webcams (com chave) ou OpenStreetMap (sem chave). */
  source?: 'windy' | 'osm';
}

export interface PublicWebcamsResult {
  configured: boolean;
  radiusKm: number;
  /** true = não havia câmaras no raio pedido e o raio foi alargado sozinho. */
  expanded?: boolean;
  items: PublicWebcam[];
  /** Mensagem para o utilizador quando a pesquisa falhou. */
  error?: string;
  /** Fontes consultadas nesta resposta. */
  sources?: ('windy' | 'osm')[];
  /** true = o serviço estava em baixo e esta é a última lista boa guardada. */
  stale?: boolean;
}

/**
 * Câmaras PÚBLICAS perto de um ponto (ex.: a morada do cliente no mapa).
 * Só webcams publicadas de propósito como públicas — nunca câmaras privadas
 * ou sem palavra-passe. Duas fontes, juntas e ordenadas pela distância:
 *  - OpenStreetMap: SEM CHAVE, sempre ativa (automático);
 *  - Windy Webcams: quando há chave em Super Admin › Integrações (PUBLIC_WEBCAMS).
 */
@Injectable()
export class PublicWebcamsService {
  private readonly logger = new Logger(PublicWebcamsService.name);
  private readonly cache = new Map<string, { at: number; value: PublicWebcamsResult }>();

  constructor(private readonly integrations: IntegrationsService, @Optional() private readonly prisma?: PrismaService) {}

  /** Última resposta boa guardada na base (zona ~1 km + raio). */
  private async stored(key: string): Promise<{ at: number; value: PublicWebcamsResult } | null> {
    if (!this.prisma) return null;
    const r = await this.prisma.publicWebcamCache.findUnique({ where: { key } }).catch(() => null);
    return r ? { at: r.at.getTime(), value: r.data as unknown as PublicWebcamsResult } : null;
  }

  private async store(key: string, value: PublicWebcamsResult): Promise<void> {
    if (!this.prisma) return;
    const data = value as unknown as object;
    await this.prisma.publicWebcamCache.upsert({ where: { key }, create: { key, data, at: new Date() }, update: { data, at: new Date() } }).catch(() => undefined);
  }

  /**
   * "Inteligente": começa no raio pedido e, se não houver nenhuma câmara pública,
   * alarga sozinho (… 50, 100, 250 km) até encontrar as mais próximas do ponto.
   */
  async nearest(lat: number, lng: number, startKm = 10): Promise<PublicWebcamsResult> {
    const steps = [startKm, ...[10, 25, 50, 100, MAX_RADIUS_KM].filter((r) => r > startKm)];
    let last: PublicWebcamsResult | null = null;
    let anyOk = false;
    for (const r of steps) {
      last = await this.nearby(lat, lng, r);
      if (!last.error) anyOk = true;
      // Com câmaras, ou com o serviço em baixo (não adianta alargar), pára aqui.
      if (last.items.length || last.error) break;
    }
    let out = last!;
    // Ainda nada a 250 km: com a Windy procura numa área maior e devolve as mais próximas.
    if (!out.items.length) {
      const far = await this.farthest(lat, lng);
      if (far) { out = far; anyOk = true; }
    }
    // Uma fonte respondeu "sem câmaras" → não é "indisponível".
    if (!out.items.length && anyOk && out.error) out = { ...out, error: undefined };
    return out.radiusKm > startKm && out.items.length ? { ...out, expanded: true } : out;
  }

  /** Windy (com chave): caixa de ±12° e depois ±30° à volta do ponto, ordenada pela distância. */
  private async farthest(lat: number, lng: number): Promise<PublicWebcamsResult | null> {
    const cfg = await this.integrations.getActive(PUBLIC_WEBCAMS_KEY).catch(() => null);
    if (!cfg?.secret) return null;
    for (const deg of [12, 30]) {
      const n = Math.min(85, lat + deg), s = Math.max(-85, lat - deg), e = Math.min(180, lng + deg), w = Math.max(-180, lng - deg);
      const url = `${WINDY_URL}?bbox=${n.toFixed(3)},${e.toFixed(3)},${s.toFixed(3)},${w.toFixed(3)}&include=images,location,player,urls&limit=50&lang=pt`;
      try {
        const res = await fetch(url, { headers: { 'x-windy-api-key': cfg.secret, accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        const items = parseWindy(await res.json());
        if (!items.length) continue;
        items.sort((a, b) => distanceKm(lat, lng, a.lat, a.lng) - distanceKm(lat, lng, b.lat, b.lng));
        return { configured: true, radiusKm: Math.round(deg * 111), expanded: true, items, sources: ['windy'] };
      } catch { /* tenta a área seguinte */ }
    }
    return null;
  }

  async nearby(lat: number, lng: number, radiusKm = 25): Promise<PublicWebcamsResult> {
    const radius = Math.max(1, Math.min(MAX_RADIUS_KM, Math.round(radiusKm)));
    const cfg = await this.integrations.getActive(PUBLIC_WEBCAMS_KEY).catch(() => null);
    const windyKey = cfg?.secret ?? null;

    // ~1 km de precisão: clientes vizinhos partilham a mesma resposta.
    const key = `${lat.toFixed(2)},${lng.toFixed(2)},${radius},${windyKey ? 'w' : '-'}`;
    const ttl = windyKey ? CACHE_MS : OSM_CACHE_MS;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < ttl) return hit.value;
    const db = await this.stored(key);
    if (db && Date.now() - db.at < ttl) { this.cache.set(key, db); return db.value; }

    const [osm, windy] = await Promise.all([
      radius <= OSM_MAX_KM ? this.fromOsm(lat, lng, radius) : Promise.resolve(null),
      windyKey ? this.fromWindy(lat, lng, radius, windyKey) : Promise.resolve(null),
    ]);
    const parts = [osm, windy].filter((x): x is SourceResult => !!x);
    const items = parts.flatMap((p) => p.items);
    items.sort((a, b) => distanceKm(lat, lng, a.lat, a.lng) - distanceKm(lat, lng, b.lat, b.lng));
    const ok = parts.filter((p) => !p.error);
    const value: PublicWebcamsResult = {
      configured: true, radiusKm: radius, items,
      sources: ok.map((p) => p.source),
      // Só é erro quando NENHUMA fonte respondeu (a outra pode ter câmaras).
      ...(ok.length === 0 ? { error: parts.map((p) => p.error).filter(Boolean)[0] } : {}),
    };
    // Guarda também "sem câmaras" (evita repetir as pesquisas ao alargar o raio).
    if (!value.error) {
      this.cache.set(key, { at: Date.now(), value });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
      await this.store(key, value);
      return value;
    }
    // Serviço em baixo: a última lista boa (até 7 dias) em vez de "indisponível".
    if (db && Date.now() - db.at < STALE_MS) return { ...db.value, stale: true };
    return value;
  }

  private async fromWindy(lat: number, lng: number, radius: number, secret: string): Promise<SourceResult> {
    const url =
      `${WINDY_URL}?nearby=${lat.toFixed(5)},${lng.toFixed(5)},${radius}` +
      '&include=images,location,player,urls&limit=50&lang=pt';
    try {
      const res = await fetch(url, {
        headers: { 'x-windy-api-key': secret, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) return { source: 'windy', items: [], error: 'Chave da Windy Webcams inválida.' };
      if (!res.ok) return { source: 'windy', items: [], error: `Serviço de câmaras públicas respondeu ${res.status}.` };
      return { source: 'windy', items: parseWindy(await res.json()) };
    } catch (e) {
      this.logger.warn(`Windy Webcams indisponível: ${(e as Error).message}`);
      return { source: 'windy', items: [], error: 'Serviço de câmaras públicas indisponível.' };
    }
  }

  private async fromOsm(lat: number, lng: number, radius: number): Promise<SourceResult> {
    const m = Math.round(radius * 1000);
    const at = `around:${m},${lat.toFixed(5)},${lng.toFixed(5)}`;
    const q = `[out:json][timeout:25];(nwr(${at})["contact:webcam"];nwr(${at})["webcam"];);out center 60;`;
    // Vários servidores em paralelo: fica a primeira resposta válida (os outros são cancelados).
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 28_000); // o overpass-api.de chega a demorar ~26 s
    try {
      const body = await Promise.any(OVERPASS_URLS.map(async (url) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': OVERPASS_UA },
          body: `data=${encodeURIComponent(q)}`,
          signal: ctl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return (await res.json()) as unknown;
      }));
      ctl.abort();
      return { source: 'osm', items: parseOverpass(body) };
    } catch (e) {
      this.logger.warn(`OpenStreetMap (Overpass) indisponível: ${(e as Error).message}`);
      return { source: 'osm', items: [], error: 'Serviço de câmaras públicas indisponível.' };
    } finally {
      clearTimeout(timer);
    }
  }
}

interface SourceResult { source: 'windy' | 'osm'; items: PublicWebcam[]; error?: string }

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? (v as Obj) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

/** Converte a resposta v3 da Windy, ignorando entradas sem posição. */
export function parseWindy(body: unknown): PublicWebcam[] {
  const list = obj(body).webcams;
  if (!Array.isArray(list)) return [];
  const out: PublicWebcam[] = [];
  for (const raw of list) {
    const w = obj(raw);
    const id = num(w.webcamId) ?? num(w.id);
    const loc = obj(w.location);
    const lat = num(loc.latitude);
    const lng = num(loc.longitude);
    if (id == null || lat == null || lng == null) continue;
    if (str(w.status) && w.status !== 'active') continue;
    const current = obj(obj(w.images).current);
    const player = obj(w.player);
    const urls = obj(w.urls);
    const pick = (v: unknown) => str(v) ?? str(obj(v).embed) ?? str(obj(v).link);
    out.push({
      id: String(id),
      title: str(w.title) ?? 'Câmara pública',
      lat,
      lng,
      city: str(loc.city),
      image: str(current.preview) ?? str(current.thumbnail) ?? str(current.icon),
      player: pick(player.live) ?? pick(player.day) ?? pick(player.month) ?? null,
      pageUrl: str(obj(urls.detail).provider) ?? str(urls.detail) ?? `https://www.windy.com/webcams/${id}`,
      updatedAt: str(w.lastUpdatedOn),
      source: 'windy',
    });
  }
  return out;
}

/**
 * Converte a resposta do Overpass: elementos com a tag `contact:webcam`/`webcam`
 * (o link público da webcam). Imagem direta só se o link for https e for uma
 * imagem (um http seria bloqueado num site https); senão abre a página.
 */
export function parseOverpass(body: unknown): PublicWebcam[] {
  const list = obj(body).elements;
  if (!Array.isArray(list)) return [];
  const out: PublicWebcam[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const e = obj(raw);
    const tags = obj(e.tags);
    const link = str(tags['contact:webcam']) ?? str(tags.webcam);
    if (!link || !/^https?:\/\//i.test(link.trim())) continue;
    const center = obj(e.center);
    const lat = num(e.lat) ?? num(center.lat);
    const lng = num(e.lon) ?? num(center.lon);
    if (lat == null || lng == null) continue;
    const url = link.trim();
    if (seen.has(url)) continue;
    seen.add(url);
    const isImg = /^https:\/\/\S+\.(jpe?g|png|gif|webp)(\?\S*)?$/i.test(url);
    out.push({
      id: `osm-${str(e.type) ?? 'node'}-${String(e.id)}`,
      title: str(tags.name) ?? str(tags.description) ?? 'Câmara pública',
      lat, lng,
      city: str(tags['addr:city']),
      image: isImg ? url : null,
      player: null,
      pageUrl: url,
      updatedAt: null,
      source: 'osm',
    });
  }
  return out;
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
