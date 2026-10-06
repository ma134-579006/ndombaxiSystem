import React, { useEffect, useMemo, useRef, useState } from 'react';
import { THEMES } from '../theme';

/**
 * Mapa próprio, sem iframe nem biblioteca externa: desenha os mosaicos (tiles)
 * do OpenStreetMap como imagens e põe por cima o marcador, o círculo de
 * precisão GPS e o trajeto. Se um fornecedor falhar, passa sozinho ao seguinte
 * (OpenStreetMap → Esri); sem nenhum, mostra o mapa do Google incorporado.
 * (O CARTO deixou de servir mosaicos sem chave de API: "API KEY REQUIRED".)
 *
 * Porquê: o mapa era um iframe do Google Maps. Nas APLICAÇÕES (Windows/Android)
 * a política de segurança só permite iframes do Google Sign-In — o mapa ficava
 * BRANCO. Imagens https já são permitidas em todo o lado, por isso este mapa
 * funciona igual no site, no Windows e no Android, e segue o tema (claro/escuro).
 */

const TILE = 256;

/** Fornecedores de mosaicos SEM chave, por ordem de preferência. */
const PROVIDERS: { name: string; url: (z: number, x: number, y: number, sub: string) => string; attr: string }[] = [
  { name: 'osm', url: (z, x, y) => `https://tile.openstreetmap.org/${z}/${x}/${y}.png`, attr: '© OpenStreetMap' },
  { name: 'esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}`, attr: '© Esri · © OpenStreetMap' },
];
const MIN_Z = 3;
const MAX_Z = 19;

/** Coordenadas → píxel "do mundo" no zoom z (projeção Web Mercator). */
function project(lat: number, lng: number, z: number): { x: number; y: number } {
  const scale = TILE * 2 ** z;
  const s = Math.sin((Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale,
  };
}

/** Metros por píxel à latitude dada (para o círculo de precisão). */
function metersPerPixel(lat: number, z: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

function isLightTheme(): boolean {
  const id = document.documentElement.getAttribute('data-theme') ?? '';
  return !!THEMES.find((t) => t.id === id)?.light;
}

export interface LiveMapProps {
  lat: number;
  lng: number;
  /** Precisão do GPS em metros (círculo à volta do marcador). */
  accuracy?: number | null;
  /** Posições anteriores (mais antiga → mais recente) para desenhar o trajeto. */
  trail?: [number, number][];
  /** Verde a pulsar quando a posição é recente. */
  live?: boolean;
  height?: number;
}

export function LiveMap({ lat, lng, accuracy, trail = [], live, height = 380 }: LiveMapProps) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: height });
  const [zoom, setZoom] = useState(17);
  // Centro do mapa; `follow` = acompanha o cliente (desliga quando se arrasta).
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat, lng });
  const [follow, setFollow] = useState(true);
  const [light, setLight] = useState(isLightTheme);
  // Fornecedor atual; ao falhar um mosaico passa ao seguinte. `failed` = nenhum serviu.
  const [prov, setProv] = useState(0);
  const [failed, setFailed] = useState(false);
  const loadedOk = useRef(false);
  const onTileError = () => {
    if (loadedOk.current) return; // um mosaico solto a falhar não troca de fornecedor
    if (prov + 1 < PROVIDERS.length) setProv(prov + 1);
    else setFailed(true);
  };
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => { if (follow) setCenter({ lat, lng }); }, [lat, lng, follow]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    // Muda de tema sem recarregar a página → troca os mosaicos.
    const mo = new MutationObserver(() => setLight(isLightTheme()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, []);

  const c = project(center.lat, center.lng, zoom);
  const origin = { x: c.x - size.w / 2, y: c.y - size.h / 2 };
  const n = 2 ** zoom;

  const tiles = useMemo(() => {
    const out: { key: string; src: string; left: number; top: number }[] = [];
    const x0 = Math.floor(origin.x / TILE), x1 = Math.floor((origin.x + size.w) / TILE);
    const y0 = Math.max(0, Math.floor(origin.y / TILE)), y1 = Math.min(n - 1, Math.floor((origin.y + size.h) / TILE));
    const p = PROVIDERS[prov];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n; // dá a volta ao mundo na horizontal
        const sub = 'abc'[(wx + ty) % 3];
        out.push({
          key: `${zoom}/${tx}/${ty}/${p.name}`,
          src: p.url(zoom, wx, ty, sub),
          left: tx * TILE - origin.x,
          top: ty * TILE - origin.y,
        });
      }
    }
    return out;
  }, [origin.x, origin.y, size.w, size.h, zoom, n, prov]);

  const p = project(lat, lng, zoom);
  const marker = { left: p.x - origin.x, top: p.y - origin.y };
  const accPx = accuracy && accuracy > 0 ? Math.min(2000, accuracy / metersPerPixel(lat, zoom)) : 0;
  const path = trail.length > 1
    ? trail.map(([la, lo]) => { const q = project(la, lo, zoom); return `${(q.x - origin.x).toFixed(1)},${(q.y - origin.y).toFixed(1)}`; }).join(' ')
    : '';

  const zoomBy = (d: number) => setZoom((z) => Math.max(MIN_Z, Math.min(MAX_Z, z + d)));
  const recenter = () => { setFollow(true); setCenter({ lat, lng }); };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, cx: c.x, cy: c.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const nx = d.cx - (e.clientX - d.x), ny = d.cy - (e.clientY - d.y);
    if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 3) setFollow(false);
    // píxel do mundo → coordenadas (inverso da projeção)
    const scale = TILE * n;
    const lo = (nx / scale) * 360 - 180;
    const la = (Math.atan(Math.sinh(Math.PI * (1 - (2 * ny) / scale))) * 180) / Math.PI;
    setCenter({ lat: la, lng: lo });
  };
  const onPointerUp = () => { drag.current = null; };

  return (
    <div className={`lmap${light ? '' : ' dark'}`} ref={box} style={{ height }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onWheel={(e) => zoomBy(e.deltaY < 0 ? 1 : -1)}
      onDoubleClick={() => zoomBy(1)}
      role="application" aria-label="Mapa com a localização do cliente">
      <div className="lmap-tiles" aria-hidden>
        {tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" draggable={false} width={TILE} height={TILE}
            referrerPolicy="strict-origin-when-cross-origin"
            onLoad={() => { loadedOk.current = true; }} onError={onTileError}
            style={{ left: t.left, top: t.top }} />
        ))}
      </div>
      <svg className="lmap-overlay" width={size.w} height={size.h} aria-hidden>
        {path ? <polyline points={path} className="lmap-trail" /> : null}
        {accPx > 6 ? <circle cx={marker.left} cy={marker.top} r={accPx} className="lmap-acc" /> : null}
      </svg>
      <div className={`lmap-pin${live ? ' live' : ''}`} style={{ left: marker.left, top: marker.top }} aria-hidden>
        <span className="lmap-pulse" />
        <span className="lmap-dot" />
      </div>
      <div className="lmap-ctrl" style={failed ? { display: 'none' } : undefined} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Aproximar">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Afastar">−</button>
        <button type="button" className={follow ? 'on' : ''} onClick={recenter} aria-label="Centrar no cliente" title="Centrar no cliente">◎</button>
      </div>
      {failed ? (
        // Última reserva: o mapa do Google (iframe) — o marcador é o do próprio Google.
        <iframe className="lmap-fail" title="Mapa (Google)" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`} />
      ) : null}
      {failed ? null : <div className="lmap-attr">{PROVIDERS[prov].attr}</div>}
    </div>
  );
}
