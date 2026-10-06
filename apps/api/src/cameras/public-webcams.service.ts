import { Injectable, Logger } from '@nestjs/common';
import { IntegrationsService } from '../integrations/integrations.service';

/** Chave da integração no Super Admin › Integrações. */
export const PUBLIC_WEBCAMS_KEY = 'PUBLIC_WEBCAMS';
/** `WINDY_WEBCAMS_URL` só serve para testes (servidor simulado). */
const WINDY_URL = process.env.WINDY_WEBCAMS_URL || 'https://api.windy.com/webcams/api/v3/webcams';
/** A Windy aceita no máximo 250 km no filtro `nearby`. */
const MAX_RADIUS_KM = 250;
/** As imagens do plano gratuito expiram em 10 min — a cache fica abaixo disso. */
const CACHE_MS = 5 * 60 * 1000;

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
  /** Página pública da câmara na Windy (atribuição obrigatória). */
  pageUrl: string;
  updatedAt: string | null;
}

export interface PublicWebcamsResult {
  configured: boolean;
  radiusKm: number;
  items: PublicWebcam[];
  /** Mensagem para o utilizador quando a pesquisa falhou. */
  error?: string;
}

/**
 * Câmaras PÚBLICAS perto de um ponto (ex.: a morada do cliente no mapa).
 * Usa apenas webcams que os donos publicaram de propósito na Windy Webcams
 * — nunca câmaras privadas ou sem palavra-passe. A chave da API é guardada
 * encriptada em Super Admin › Integrações (PUBLIC_WEBCAMS).
 */
@Injectable()
export class PublicWebcamsService {
  private readonly logger = new Logger(PublicWebcamsService.name);
  private readonly cache = new Map<string, { at: number; value: PublicWebcamsResult }>();

  constructor(private readonly integrations: IntegrationsService) {}

  async nearby(lat: number, lng: number, radiusKm = 25): Promise<PublicWebcamsResult> {
    const radius = Math.max(1, Math.min(MAX_RADIUS_KM, Math.round(radiusKm)));
    const cfg = await this.integrations.getActive(PUBLIC_WEBCAMS_KEY);
    if (!cfg?.secret) return { configured: false, radiusKm: radius, items: [] };

    // ~1 km de precisão: clientes vizinhos partilham a mesma resposta.
    const key = `${lat.toFixed(2)},${lng.toFixed(2)},${radius}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;

    const url =
      `${WINDY_URL}?nearby=${lat.toFixed(5)},${lng.toFixed(5)},${radius}` +
      '&include=images,location,player,urls&limit=50&lang=pt';
    let value: PublicWebcamsResult;
    try {
      const res = await fetch(url, {
        headers: { 'x-windy-api-key': cfg.secret, accept: 'application/json' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.status === 401 || res.status === 403) {
        value = { configured: true, radiusKm: radius, items: [], error: 'Chave da Windy Webcams inválida.' };
      } else if (!res.ok) {
        value = { configured: true, radiusKm: radius, items: [], error: `Serviço de câmaras públicas respondeu ${res.status}.` };
      } else {
        const items = parseWindy(await res.json());
        items.sort((a, b) => distanceKm(lat, lng, a.lat, a.lng) - distanceKm(lat, lng, b.lat, b.lng));
        value = { configured: true, radiusKm: radius, items };
      }
    } catch (e) {
      this.logger.warn(`Windy Webcams indisponível: ${(e as Error).message}`);
      return { configured: true, radiusKm: radius, items: [], error: 'Serviço de câmaras públicas indisponível.' };
    }
    if (!value.error) {
      this.cache.set(key, { at: Date.now(), value });
      if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value as string);
    }
    return value;
  }
}

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
    });
  }
  return out;
}

function distanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLng - aLng) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
