import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * "Como chegar" dentro do sistema: a partir da posição DESTE aparelho (quem vai
 * entregar) traça o caminho por estrada até ao cliente e mostra uma BÚSSOLA que
 * aponta para onde seguir, com distância e tempo estimado.
 *
 * Caminho: serviço público OSRM (motor de rotas open source sobre o
 * OpenStreetMap — github.com/Project-OSRM/osrm-backend). Sem rede para ele, cai
 * numa linha reta ("em linha de ar") com a distância real — nunca fica sem nada.
 */

export interface LatLng { lat: number; lng: number }

const OSRM = 'https://router.project-osrm.org/route/v1/driving';
const R = 6371000;
const rad = (d: number) => (d * Math.PI) / 180;

export function distanceM(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rumo (0° = Norte, 90° = Este) de a para b. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const y = Math.sin(rad(b.lng - a.lng)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lng - a.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const POINTS = ['Norte', 'Nordeste', 'Este', 'Sudeste', 'Sul', 'Sudoeste', 'Oeste', 'Noroeste'];
export const compassPoint = (deg: number) => POINTS[Math.round(deg / 45) % 8];

export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toLocaleString('pt-PT', { maximumFractionDigits: m < 10000 ? 1 : 0 })} km`;
}
export function formatDuration(s: number): string {
  const min = Math.max(1, Math.round(s / 60));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

export interface NavState {
  active: boolean;
  start: LatLng | null;
  route: [number, number][] | null;
  distance: number | null;
  duration: number | null;
  /** 'road' = caminho por estrada (OSRM); 'air' = linha reta (sem serviço de rotas). */
  mode: 'road' | 'air' | null;
  heading: number | null;
  error: string | null;
  fitKey: number;
}

/** Posição deste aparelho + caminho até `dest` (recalcula quando anda > 60 m). */
/** Mensagem clara por plataforma quando o GPS falha (diz ONDE ligar). */
export function geoErrorMessage(code: number): string {
  const w = window as unknown as { ndombaxi?: { version?: unknown }; __NDOMBAXI_NATIVE__?: boolean; Capacitor?: unknown };
  const app = w.ndombaxi?.version ? 'windows' : w.__NDOMBAXI_NATIVE__ || w.Capacitor ? 'android' : 'web';
  if (code === 1) {
    return app === 'android'
      ? 'A localização está desligada para a app: Definições › Apps › LPS Vendas › Permissões › Localização › Permitir.'
      : app === 'windows'
        ? 'Ligue a localização do Windows: Definições › Privacidade e segurança › Localização (e "Permitir que as apps acedam à localização").'
        : 'O navegador bloqueou a localização: toque no cadeado ao lado do endereço › Localização › Permitir, e recarregue.';
  }
  return app === 'windows'
    ? 'O Windows não deu a posição: confirme que a localização do Windows está ligada.'
    : 'Não foi possível obter a posição: ligue o GPS/localização do aparelho.';
}

export function useNavigation(dest: LatLng | null) {
  const [s, setS] = useState<NavState>({ active: false, start: null, route: null, distance: null, duration: null, mode: null, heading: null, error: null, fitKey: 0 });
  const watch = useRef<number | null>(null);
  const lastRouted = useRef<LatLng | null>(null);
  const destRef = useRef(dest);
  destRef.current = dest;

  const route = useCallback(async (from: LatLng) => {
    const to = destRef.current;
    if (!to) return;
    lastRouted.current = from;
    try {
      const ctrl = new AbortController();
      const t = window.setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(`${OSRM}/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`, { signal: ctrl.signal });
      window.clearTimeout(t);
      const j = await r.json() as { code?: string; routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[] };
      const best = j.routes?.[0];
      if (j.code !== 'Ok' || !best) throw new Error('sem rota');
      setS((p) => ({ ...p, route: best.geometry.coordinates.map(([lo, la]) => [la, lo]), distance: best.distance, duration: best.duration, mode: 'road', error: null, fitKey: p.route ? p.fitKey : p.fitKey + 1 }));
    } catch {
      // Sem serviço de rotas: linha reta com a distância real e tempo estimado (30 km/h).
      const d = distanceM(from, to);
      setS((p) => ({ ...p, route: null, distance: d, duration: d / 8.3, mode: 'air', fitKey: p.mode ? p.fitKey : p.fitKey + 1 }));
    }
  }, []);

  const stop = useCallback(() => {
    if (watch.current != null) navigator.geolocation.clearWatch(watch.current);
    watch.current = null;
    lastRouted.current = null;
    setS((p) => ({ ...p, active: false, start: null, route: null, distance: null, duration: null, mode: null, error: null }));
  }, []);

  const start = useCallback(() => {
    if (!navigator.geolocation) { setS((p) => ({ ...p, error: 'Este aparelho não tem localização (GPS).' })); return; }
    // Nunca dois "watch" ao mesmo tempo (recomeçar depois de um erro).
    if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
    setS((p) => ({ ...p, active: true, error: null }));
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setS((p) => ({ ...p, start: here, heading: pos.coords.heading != null && !Number.isNaN(pos.coords.heading) && (pos.coords.speed ?? 0) > 1 ? pos.coords.heading : p.heading }));
        if (!lastRouted.current || distanceM(lastRouted.current, here) > 60) void route(here);
      },
      (e) => {
        if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null; }
        setS((p) => ({ ...p, active: false, error: geoErrorMessage(e.code) }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }, [route]);

  // Bússola do telemóvel (para onde está virado): roda a seta da direção.
  useEffect(() => {
    if (!s.active) return;
    const onOri = (e: DeviceOrientationEvent & { webkitCompassHeading?: number }) => {
      const h = typeof e.webkitCompassHeading === 'number' ? e.webkitCompassHeading
        : e.absolute && e.alpha != null ? (360 - e.alpha) % 360 : null;
      if (h != null) setS((p) => ({ ...p, heading: h }));
    };
    window.addEventListener('deviceorientationabsolute', onOri as EventListener);
    window.addEventListener('deviceorientation', onOri as EventListener);
    return () => {
      window.removeEventListener('deviceorientationabsolute', onOri as EventListener);
      window.removeEventListener('deviceorientation', onOri as EventListener);
    };
  }, [s.active]);

  useEffect(() => () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current); }, []);

  return { nav: s, start, stop };
}

/** Bússola: a seta aponta para o cliente (rodada pela direção do aparelho, se houver). */
export function Compass({ from, to, heading, distance, duration, mode }: {
  from: LatLng; to: LatLng; heading: number | null; distance: number | null; duration: number | null; mode: 'road' | 'air' | null;
}) {
  const b = bearingDeg(from, to);
  const turn = heading != null ? (b - heading + 360) % 360 : b;
  return (
    <div className="rc-compass" role="status" aria-live="polite">
      <div className="rc-dial" aria-hidden>
        <span className="rc-n" style={{ transform: `rotate(${heading != null ? -heading : 0}deg) translateY(-25px)` }}>N</span>
        <svg viewBox="0 0 40 40" width="40" height="40" style={{ transform: `rotate(${turn}deg)` }}>
          <path d="M20 3 L28 30 L20 24 L12 30 Z" fill="currentColor" />
        </svg>
      </div>
      <div className="rc-tx">
        <strong>Siga para {compassPoint(b)} <small>({Math.round(b)}°)</small></strong>
        <span>
          {distance != null ? formatDistance(distance) : '—'}
          {duration != null ? ` · ~${formatDuration(duration)}` : ''}
          {mode === 'air' ? ' · em linha reta (sem serviço de rotas)' : mode === 'road' ? ' · por estrada' : ''}
        </span>
      </div>
    </div>
  );
}
