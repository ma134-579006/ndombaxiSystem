import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
  { name: 'esri', url: (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/${z}/${y}/${x}?blankTile=false`, attr: '© Esri · © OpenStreetMap' },
];

/** SATÉLITE (Esri World Imagery, sem chave) + camadas de nomes: estradas e bairros/localidades. */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const SATELLITE = (z: number, x: number, y: number) => `${ESRI}/World_Imagery/MapServer/tile/${z}/${y}/${x}?blankTile=false`;
const SAT_LABELS = [
  (z: number, x: number, y: number) => `${ESRI}/Reference/World_Transportation/MapServer/tile/${z}/${y}/${x}?blankTile=false`,
  (z: number, x: number, y: number) => `${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/${z}/${y}/${x}?blankTile=false`,
];

/** Câmara da empresa com posição no mapa. */
/** `public` = câmara pública (Windy Webcams) perto do cliente; sem `kind` = câmara da empresa. */
export interface MapCamera { id: string; name: string; lat: number; lng: number; kind?: 'public' }
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
  /** Ponto de partida (quem entrega / este aparelho) — marcador azul "Você". */
  start?: { lat: number; lng: number } | null;
  /** Caminho a desenhar (lat, lng) da origem até ao cliente. */
  route?: [number, number][] | null;
  /** Ao mudar, o mapa enquadra origem + cliente (ex.: depois de traçar o caminho). */
  fitKey?: number;
  /** Câmaras da empresa com posição — tocar abre a imagem ao vivo. */
  cameras?: MapCamera[];
  onCamera?(id: string): void;
  /** Zoom e camada iniciais (por omissão 17 e mapa de ruas). */
  initialZoom?: number;
  initialLayer?: 'map' | 'sat';
}

type TileUrl = (z: number, x: number, y: number) => string;
/** Quantos níveis de zoom se pode subir à procura de imagem. */
const MAX_UP = 5;

/**
 * Mosaico com RESERVA: quando o servidor não tem imagem neste zoom (comum no
 * satélite e no mapa Esri em Angola: "Map data not yet available"), mostra o
 * mosaico do zoom de cima ampliado — o mapa nunca fica "indisponível" ao
 * aproximar. `onFirstError` devolve true quando o erro foi tratado de outra
 * forma (troca de fornecedor).
 */
function Tile({ url, z, x, y, left, top, label, onOk, onFirstError }: {
  url: TileUrl; z: number; x: number; y: number; left: number; top: number; label?: boolean;
  onOk?(): void; onFirstError?(): boolean;
}) {
  const [up, setUp] = useState(0);
  const [gone, setGone] = useState(false);
  if (gone) return null;
  const fail = () => {
    if (up === 0 && onFirstError?.()) return;
    // As camadas de nomes são transparentes: sem imagem, simplesmente não aparecem.
    if (label || up >= MAX_UP || z - up - 1 < MIN_Z) setGone(true);
    else setUp(up + 1);
  };
  const cls = label ? 'lbl' : undefined;
  if (up === 0) {
    return <img src={url(z, x, y)} alt="" draggable={false} width={TILE} height={TILE} className={cls}
      referrerPolicy="strict-origin-when-cross-origin" onLoad={onOk} onError={fail} style={{ left, top }} />;
  }
  const k = 2 ** up;
  return (
    <div className="lmap-up" style={{ left, top }}>
      <img src={url(z - up, Math.floor(x / k), Math.floor(y / k))} alt="" draggable={false} className={cls}
        referrerPolicy="strict-origin-when-cross-origin" onError={fail}
        style={{ width: TILE * k, height: TILE * k, left: -(x % k) * TILE, top: -(y % k) * TILE }} />
    </div>
  );
}

export function LiveMap({ lat, lng, accuracy, trail = [], live, height = 380, start, route, fitKey, cameras = [], onCamera, initialZoom = 17, initialLayer = 'map' }: LiveMapProps) {
  // Camada: mapa de ruas ou SATÉLITE (com estradas e nomes de bairros por cima).
  const [layer, setLayer] = useState<'map' | 'sat'>(initialLayer);
  // Maximizado: o mapa ocupa o ecrã todo (sem a Fullscreen API, que falha nas apps).
  const [max, setMax] = useState(false);
  useEffect(() => {
    if (!max) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMax(false); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [max]);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: height });
  const [zoom, setZoom] = useState(initialZoom);
  // Centro do mapa; `follow` = acompanha o cliente (desliga quando se arrasta).
  const [center, setCenter] = useState<{ lat: number; lng: number }>({ lat, lng });
  const [follow, setFollow] = useState(true);
  const [light, setLight] = useState(isLightTheme);
  // Fornecedor atual; ao falhar um mosaico passa ao seguinte. `failed` = nenhum serviu.
  const [prov, setProv] = useState(0);
  const [failed, setFailed] = useState(false);
  const loadedOk = useRef(false);
  /** true = tratado (trocou de fornecedor); false = o mosaico usa o zoom de cima. */
  const onTileError = (): boolean => {
    if (loadedOk.current) return false; // fornecedor a funcionar: só falta este mosaico
    if (prov + 1 < PROVIDERS.length) setProv(prov + 1);
    else setFailed(true);
    return true;
  };
  const drag = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);

  useEffect(() => { if (follow) setCenter({ lat, lng }); }, [lat, lng, follow]);

  // Enquadra origem + cliente (zoom máximo que mostra os dois com margem).
  useEffect(() => {
    if (!fitKey || !start) return;
    const pts: [number, number][] = [[lat, lng], [start.lat, start.lng], ...(route ?? [])];
    const las = pts.map((q) => q[0]), los = pts.map((q) => q[1]);
    const box = { n: Math.max(...las), s: Math.min(...las), e: Math.max(...los), w: Math.min(...los) };
    let z = MAX_Z;
    for (; z > MIN_Z; z--) {
      const a = project(box.n, box.w, z), b = project(box.s, box.e, z);
      // Margem generosa: os controlos (direita) e a bússola (em baixo) não tapam os pontos.
      if (Math.abs(b.x - a.x) < size.w - 160 && Math.abs(b.y - a.y) < size.h - 220) break;
    }
    setFollow(false);
    setZoom(z);
    // Centro ligeiramente abaixo do meio do caminho → os pontos sobem, longe da bússola.
    const mid = project((box.n + box.s) / 2, (box.e + box.w) / 2, z);
    const scale = TILE * 2 ** z, y = mid.y + 45;
    setCenter({ lat: (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / scale))) * 180) / Math.PI, lng: (box.e + box.w) / 2 });
  }, [fitKey]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [max]);

  const c = project(center.lat, center.lng, zoom);
  const origin = { x: c.x - size.w / 2, y: c.y - size.h / 2 };
  const n = 2 ** zoom;

  const tiles = useMemo(() => {
    const out: { key: string; url: TileUrl; x: number; y: number; left: number; top: number; label?: boolean }[] = [];
    const x0 = Math.floor(origin.x / TILE), x1 = Math.floor((origin.x + size.w) / TILE);
    const y0 = Math.max(0, Math.floor(origin.y / TILE)), y1 = Math.min(n - 1, Math.floor((origin.y + size.h) / TILE));
    const p = PROVIDERS[prov];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const wx = ((tx % n) + n) % n; // dá a volta ao mundo na horizontal
        const left = tx * TILE - origin.x, top = ty * TILE - origin.y;
        if (layer === 'sat') {
          out.push({ key: `${zoom}/${tx}/${ty}/sat`, url: SATELLITE, x: wx, y: ty, left, top });
          SAT_LABELS.forEach((f, i) => out.push({ key: `${zoom}/${tx}/${ty}/lbl${i}`, url: f, x: wx, y: ty, left, top, label: true }));
        } else {
          out.push({ key: `${zoom}/${tx}/${ty}/${p.name}`, url: (z, x, y) => p.url(z, x, y, 'abc'[(x + y) % 3]), x: wx, y: ty, left, top });
        }
      }
    }
    return out;
  }, [origin.x, origin.y, size.w, size.h, zoom, n, prov, layer]);

  const p = project(lat, lng, zoom);
  const marker = { left: p.x - origin.x, top: p.y - origin.y };
  const accPx = accuracy && accuracy > 0 ? Math.min(2000, accuracy / metersPerPixel(lat, zoom)) : 0;
  const path = trail.length > 1
    ? trail.map(([la, lo]) => { const q = project(la, lo, zoom); return `${(q.x - origin.x).toFixed(1)},${(q.y - origin.y).toFixed(1)}`; }).join(' ')
    : '';

  const toPx = (la: number, lo: number) => { const q = project(la, lo, zoom); return { x: q.x - origin.x, y: q.y - origin.y }; };
  const routePts = route && route.length > 1 ? route.map(([la, lo]) => { const q = toPx(la, lo); return `${q.x.toFixed(1)},${q.y.toFixed(1)}`; }).join(' ') : '';
  const from = start ? toPx(start.lat, start.lng) : null;

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

  const map = (
    <div className={`lmap${light || layer === 'sat' ? '' : ' dark'}${layer === 'sat' ? ' sat' : ''}${max ? ' max' : ''}`} ref={box} style={max ? undefined : { height }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onWheel={(e) => zoomBy(e.deltaY < 0 ? 1 : -1)}
      onDoubleClick={() => zoomBy(1)}
      role="application" aria-label="Mapa com a localização do cliente">
      <div className="lmap-tiles" aria-hidden>
        {tiles.map((t) => (
          <Tile key={t.key} url={t.url} z={zoom} x={t.x} y={t.y} left={t.left} top={t.top} label={t.label}
            onOk={() => { loadedOk.current = true; }}
            onFirstError={layer === 'map' ? onTileError : undefined} />
        ))}
      </div>
      <svg className="lmap-overlay" width={size.w} height={size.h} aria-hidden>
        {path ? <polyline points={path} className="lmap-trail" /> : null}
        {routePts ? <polyline points={routePts} className="lmap-route-casing" /> : null}
        {routePts ? <polyline points={routePts} className="lmap-route" /> : null}
        {!routePts && from ? <line x1={from.x} y1={from.y} x2={marker.left} y2={marker.top} className="lmap-route lmap-route-air" /> : null}
        {accPx > 6 ? <circle cx={marker.left} cy={marker.top} r={accPx} className="lmap-acc" /> : null}
      </svg>
      <div className={`lmap-pin${live ? ' live' : ''}`} style={{ left: marker.left, top: marker.top }} aria-hidden>
        <span className="lmap-pulse" />
        <span className="lmap-dot" />
      </div>
      {from ? (
        <div className="lmap-me" style={{ left: from.x, top: from.y }} aria-hidden title="Você"><span /></div>
      ) : null}
      {cameras.map((cam) => {
        const q = toPx(cam.lat, cam.lng);
        return (
          <button key={cam.id} type="button" className={`lmap-cam${cam.kind === 'public' ? ' pub' : ''}`} style={{ left: q.x, top: q.y }}
            title={`${cam.kind === 'public' ? 'Câmara pública' : 'Câmara'}: ${cam.name}`}
            aria-label={`Ver câmara ${cam.name}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => onCamera?.(cam.id)}>
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>
          </button>
        );
      })}
      <div className="lmap-ctrl" style={failed ? { display: 'none' } : undefined} onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className={layer === 'sat' ? 'on' : ''} onClick={() => setLayer(layer === 'sat' ? 'map' : 'sat')}
          aria-label={layer === 'sat' ? 'Ver mapa de ruas' : 'Ver satélite'} title={layer === 'sat' ? 'Mapa de ruas' : 'Satélite'}>
          {layer === 'sat'
            ? <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 6v16l7-4 8 4 7-4V2l-7 4-8-4-7 4z" /><path d="M8 2v16M16 6v16" /></svg>
            : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20" /></svg>}
        </button>
        <button type="button" onClick={() => zoomBy(1)} aria-label="Aproximar">+</button>
        <button type="button" onClick={() => zoomBy(-1)} aria-label="Afastar">−</button>
        <button type="button" className={follow ? 'on' : ''} onClick={recenter} aria-label="Centrar no cliente" title="Centrar no cliente">◎</button>
        <button type="button" className={max ? 'on' : ''} onClick={() => setMax(!max)}
          aria-label={max ? 'Sair de ecrã inteiro' : 'Maximizar mapa'} title={max ? 'Sair de ecrã inteiro (Esc)' : 'Maximizar mapa'}>
          {max
            ? <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></svg>
            : <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></svg>}
        </button>
      </div>
      {failed ? (
        // Última reserva: o mapa do Google (iframe) — o marcador é o do próprio Google.
        <iframe className="lmap-fail" title="Mapa (Google)" loading="lazy" referrerPolicy="no-referrer-when-downgrade"
          src={`https://www.google.com/maps?q=${lat},${lng}&z=${zoom}&output=embed`} />
      ) : null}
      {failed ? null : <div className="lmap-attr">{layer === 'sat' ? '© Esri · Maxar · Earthstar' : PROVIDERS[prov].attr}</div>}
    </div>
  );
  // Maximizado vai para o <body>: um modal com transform não o prende.
  return max ? createPortal(map, document.body) : map;
}
