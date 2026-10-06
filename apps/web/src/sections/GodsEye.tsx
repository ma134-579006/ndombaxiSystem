import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { CameraMapPin, CameraRow, PublicWebcam, PublicWebcamsResult } from '../api/types';
import { LiveMap } from '../components/LiveMap';
import { PublicCams, PublicCamView } from '../components/PublicCams';
import { distanceM, formatDistance } from '../components/RouteCompass';
import { Modal } from '../components/ui';
import { CompanyCamView } from './Cameras';

type Center = { lat: number; lng: number; source: 'gps' | 'cams' | 'default'; accuracy?: number };
/** Centro de Luanda — usado só quando não há GPS nem câmaras com posição. */
const LUANDA: Center = { lat: -8.8383, lng: 13.2344, source: 'default' };
const RADII = [10, 25, 50, 100, 250];

/**
 * OLHO DE DEUS — mapa grande em satélite com as câmaras da EMPRESA (com
 * posição) e as câmaras PÚBLICAS (Windy Webcams) à volta. Aberto também ao
 * supervisor da loja: vê as câmaras da empresa por fotogramas via servidor.
 * Só fontes legítimas: câmaras da própria empresa e webcams publicadas pelos
 * donos como públicas — nunca câmaras privadas de terceiros.
 */
export function GodsEye() {
  const [center, setCenter] = useState<Center | null>(null);
  const [gpsMsg, setGpsMsg] = useState<string | null>(null);
  const [radius, setRadius] = useState(25);
  const [cams, setCams] = useState<CameraMapPin[] | null>(null);
  const [fullCams, setFullCams] = useState<CameraRow[]>([]);
  const [pub, setPub] = useState<PublicWebcamsResult | null>(null);
  const [camOpen, setCamOpen] = useState<CameraMapPin | null>(null);
  const [pubOpen, setPubOpen] = useState<PublicWebcam | null>(null);

  useEffect(() => {
    api.cameras.mapList().then(setCams).catch(() => setCams([]));
    api.cameras.list().then(setFullCams).catch(() => setFullCams([]));
  }, []);

  // Centro automático: GPS deste aparelho → câmaras da empresa → Luanda.
  const locate = () => {
    if (!navigator.geolocation) { setGpsMsg('Este aparelho não tem GPS.'); return; }
    setGpsMsg('A obter a sua localização…');
    navigator.geolocation.getCurrentPosition(
      (p) => { setCenter({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, source: 'gps' }); setGpsMsg(null); },
      () => setGpsMsg('Sem acesso ao GPS — ative a localização para centrar o mapa em si.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  };
  useEffect(() => { locate(); }, []);
  useEffect(() => {
    if (center?.source === 'gps' || !cams) return;
    if (cams.length) {
      const lat = cams.reduce((a, c) => a + c.lat, 0) / cams.length;
      const lng = cams.reduce((a, c) => a + c.lng, 0) / cams.length;
      setCenter((c) => (c?.source === 'gps' ? c : { lat, lng, source: 'cams' }));
    } else setCenter((c) => c ?? LUANDA);
  }, [cams, center?.source]);

  const pubKey = center ? `${center.lat.toFixed(2)},${center.lng.toFixed(2)},${radius}` : null;
  useEffect(() => {
    if (!pubKey) return;
    let alive = true;
    const [la, ln, r] = pubKey.split(',').map(Number);
    setPub(null);
    api.cameras.publicNearby(la, ln, r).then((x) => { if (alive) setPub(x); }).catch(() => { if (alive) setPub(null); });
    return () => { alive = false; };
  }, [pubKey]);

  const here = center ?? LUANDA;
  const zoom = radius <= 10 ? 13 : radius <= 25 ? 12 : radius <= 50 ? 11 : radius <= 100 ? 10 : 8;

  return (
    <>
      <div className="content-head">
        <h2>Olho de Deus</h2>
        <span className="spacer" />
        <label className="ge-radius">
          Raio
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADII.map((r) => <option key={r} value={r}>{r} km</option>)}
          </select>
        </label>
        <button type="button" className="btn ghost" onClick={locate}>Usar a minha localização</button>
      </div>
      <p className="ge-sub">
        Satélite com estradas e bairros, as câmaras da empresa e as câmaras públicas à volta.{' '}
        {here.source === 'gps' ? 'Centrado na sua localização.' : here.source === 'cams' ? 'Centrado nas câmaras da empresa.' : 'Centrado em Luanda.'}
      </p>
      {gpsMsg ? <div className="banner" style={{ marginBottom: 12 }}>{gpsMsg}</div> : null}

      <div className="card ge-map" style={{ padding: 0 }}>
        {center ? (
          <LiveMap key={`${here.source}-${zoom}`} lat={here.lat} lng={here.lng} accuracy={here.accuracy} live={here.source === 'gps'}
            height={560} initialLayer="sat" initialZoom={zoom}
            cameras={[
              ...(cams ?? []).map((c) => ({ id: c.id, name: c.name, lat: c.lat, lng: c.lng })),
              ...(pub?.items ?? []).map((w) => ({ id: `pub:${w.id}`, name: w.title, lat: w.lat, lng: w.lng, kind: 'public' as const })),
            ]}
            onCamera={(id) => {
              if (id.startsWith('pub:')) setPubOpen(pub?.items.find((w) => `pub:${w.id}` === id) ?? null);
              else setCamOpen(cams?.find((c) => c.id === id) ?? null);
            }} />
        ) : <div className="loading" style={{ height: 560 }}>A preparar o mapa…</div>}
      </div>

      <div className="pubcams ge-own">
        <div className="pubcams-head">
          <strong>Câmaras da empresa</strong>
          <span>{cams == null ? 'A carregar…' : cams.length ? `${cams.length} com posição no mapa` : 'Nenhuma com posição no mapa'}</span>
        </div>
        {cams && cams.length ? (
          <div className="ge-list">
            {cams.map((c) => (
              <button key={c.id} type="button" className="ge-item" onClick={() => setCamOpen(c)}>
                <span className="ge-dot" aria-hidden />
                <span className="pubcam-t">{c.name}</span>
                <span className="pubcam-d">{formatDistance(distanceM(here, c))}</span>
              </button>
            ))}
          </div>
        ) : cams ? (
          <p className="pubcams-off">Defina a posição de cada câmara em Câmaras › Configurar › «Posição no mapa» para a ver aqui.</p>
        ) : null}
      </div>

      {pub ? <PublicCams result={pub} from={here} onOpen={setPubOpen} title="Câmaras públicas à volta" /> : null}

      {camOpen ? (
        <Modal title={`Câmara · ${camOpen.name}`} onClose={() => setCamOpen(null)} wide>
          <CompanyCamView pin={camOpen} full={fullCams.find((c) => c.id === camOpen.id)} />
        </Modal>
      ) : null}
      {pubOpen ? (
        <Modal title={`Câmara pública · ${pubOpen.title}`} onClose={() => setPubOpen(null)} wide>
          <PublicCamView cam={pubOpen} />
        </Modal>
      ) : null}
    </>
  );
}
