import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client';
import type { LocatedClient, PublicWebcam, PublicWebcamsResult } from '../api/types';
import { LiveMap } from '../components/LiveMap';
import { distanceM, formatDistance } from '../components/RouteCompass';
import { Modal } from '../components/ui';
import { PublicCamView, PublicCamsAttribution, camLinkLabel } from '../components/PublicCams';
import { formatDate } from '../format';

type Target = { lat: number; lng: number; label: string; sub: string; accuracy?: number; live?: boolean };

function sinceLabel(iso: string | null): string {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 48 ? `há ${h} h` : `em ${formatDate(iso)}`;
}

/**
 * OLHO DE DEUS — onde está o CLIENTE e o que se vê à volta dele.
 *
 * Escolhe-se um cliente com GPS (encomendas recentes; por omissão o mais
 * recente) e o sistema procura sozinho as câmaras PÚBLICAS mais próximas da
 * posição dele: começa em 10 km e, se não houver nenhuma, alarga o raio até as
 * encontrar. A mais próxima abre logo em vídeo; as outras ficam ao lado.
 * Só fontes legítimas: webcams publicadas como públicas (OpenStreetMap, sem chave;
 * Windy Webcams quando há chave).
 */
export function GodsEye() {
  const [clients, setClients] = useState<LocatedClient[] | null>(null);
  const [sel, setSel] = useState<string>(''); // orderId | 'me'
  const [me, setMe] = useState<Target | null>(null);
  const [meErr, setMeErr] = useState<string | null>(null);
  const [pub, setPub] = useState<PublicWebcamsResult | null>(null);
  const [loadingPub, setLoadingPub] = useState(false);
  const [playing, setPlaying] = useState<PublicWebcam | null>(null);
  const [zoomCam, setZoomCam] = useState<PublicWebcam | null>(null);

  useEffect(() => {
    api.orders.located().then((r) => { setClients(r); if (r.length) setSel((s) => s || r[0].orderId); else setSel((s) => s || 'me'); })
      .catch(() => { setClients([]); setSel((s) => s || 'me'); });
  }, []);

  // "A minha localização" (sem clientes com GPS, ou escolhido à mão).
  useEffect(() => {
    if (sel !== 'me' || me) return;
    if (!navigator.geolocation) { setMeErr('Este aparelho não tem GPS.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => setMe({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, label: 'A minha localização', sub: 'GPS deste aparelho', live: true }),
      () => setMeErr('Sem acesso ao GPS deste aparelho.'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 },
    );
  }, [sel, me]);

  const target: Target | null = useMemo(() => {
    if (sel === 'me') return me;
    const c = clients?.find((x) => x.orderId === sel);
    return c ? { lat: c.lat, lng: c.lng, label: c.customerName || 'Cliente', sub: `${c.orderNumber}${c.address ? ` · ${c.address}` : ''} · posição ${sinceLabel(c.updatedAt)}` } : null;
  }, [sel, me, clients]);

  // Câmaras públicas mais próximas do alvo (raio automático) → a 1.ª abre logo.
  const key = target ? `${target.lat.toFixed(3)},${target.lng.toFixed(3)}` : null;
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const [la, ln] = key.split(',').map(Number);
    setPub(null); setPlaying(null); setLoadingPub(true);
    api.cameras.publicNearby(la, ln, 10, true)
      // abre logo a mais próxima COM VÍDEO (sem vídeo em nenhuma: a mais próxima, em imagem)
      .then((r) => { if (!alive) return; setPub(r); setPlaying(r.items.find((w) => w.player) ?? r.items[0] ?? null); })
      .catch(() => { if (alive) setPub(null); })
      .finally(() => { if (alive) setLoadingPub(false); });
    return () => { alive = false; };
  }, [key]);

  const nearest = pub?.items[0];
  const zoom = !nearest || !target ? 15 : (() => {
    const d = distanceM(target, nearest) / 1000;
    // zoom em que a câmara mais próxima cabe no mapa (com margem)
    return d < 0.5 ? 16 : d < 1.2 ? 15 : d < 2.5 ? 14 : d < 5 ? 13 : d < 10 ? 12 : d < 20 ? 11 : d < 40 ? 10 : d < 80 ? 9 : 8;
  })();

  return (
    <>
      <div className="content-head">
        <h2>Olho de Deus</h2>
        <span className="spacer" />
        <label className="ge-radius">
          Cliente
          <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Escolher cliente">
            {(clients ?? []).map((c) => (
              <option key={c.orderId} value={c.orderId}>{c.customerName || 'Cliente'} · {c.orderNumber}</option>
            ))}
            <option value="me">A minha localização</option>
          </select>
        </label>
      </div>
      <p className="ge-sub">
        Câmaras públicas mais próximas da localização do cliente (GPS), procuradas automaticamente.
      </p>
      {clients && clients.length === 0 ? (
        <div className="banner" style={{ marginBottom: 12 }}>Ainda não há clientes com localização GPS. A mostrar a sua localização.</div>
      ) : null}
      {sel === 'me' && meErr ? <div className="banner danger" style={{ marginBottom: 12 }}>{meErr}</div> : null}

      {target ? (
        <div className="ge-target">
          <span className="ge-pin" aria-hidden />
          <div><b>{target.label}</b><span>{target.sub}</span></div>
          {nearest ? <em>Câmara mais próxima: {formatDistance(distanceM(target, nearest))}</em> : null}
        </div>
      ) : null}

      <div className="ge-layout">
        <div className="card ge-map" style={{ padding: 0 }}>
          {target ? (
            <LiveMap key={`${key}-${zoom}`} lat={target.lat} lng={target.lng} accuracy={target.accuracy} live={target.live}
              height={520} initialLayer="sat" initialZoom={zoom}
              cameras={(pub?.items ?? []).map((w) => ({ id: w.id, name: w.title, lat: w.lat, lng: w.lng, kind: 'public' as const }))}
              onCamera={(id) => setPlaying(pub?.items.find((w) => w.id === id) ?? null)} />
          ) : <div className="loading" style={{ height: 520 }}>{clients == null ? 'A carregar clientes…' : 'A obter a localização…'}</div>}
        </div>

        <div className="card ge-watch">
          <div className="ge-watch-head">
            <strong>{playing ? playing.title : 'Vídeo da câmara pública'}</strong>
            {playing && target ? <span>{formatDistance(distanceM(target, playing))} do cliente{playing.city ? ` · ${playing.city}` : ''}</span> : null}
          </div>
          {loadingPub ? <div className="ge-player-empty">A procurar câmaras públicas perto do cliente…</div>
            : !pub ? <div className="ge-player-empty">Sem resposta do serviço de câmaras públicas.</div>
            : pub.error ? <div className="ge-player-empty">{pub.error}</div>
            : !playing ? <div className="ge-player-empty">Nenhuma câmara pública até {pub.radiusKm} km deste cliente.</div>
            : playing.player ? (
              <iframe key={playing.id} className="ge-player" src={playing.player} title={playing.title} allow="autoplay; fullscreen" referrerPolicy="no-referrer" />
            ) : playing.image ? <img className="ge-player" src={playing.image} alt={playing.title} referrerPolicy="no-referrer" />
            : (
              <div className="ge-player-empty">
                Esta câmara abre no site do dono.
                <a className="btn sm" href={playing.pageUrl} target="_blank" rel="noreferrer">Abrir a câmara</a>
              </div>
            )}
          {playing ? (
            <div className="ge-watch-foot">
              <button type="button" className="btn ghost sm" onClick={() => setZoomCam(playing)}>Ampliar</button>
              <a href={playing.pageUrl} target="_blank" rel="noreferrer">{camLinkLabel(playing)}</a>
            </div>
          ) : null}

          {pub?.items.length ? (
            <>
              <div className="ge-list-title">
                {pub.items.length} câmara(s) até {pub.radiusKm} km{pub.expanded ? ' — procura alargada automaticamente' : ''}
              </div>
              <div className="ge-cams">
                {pub.items.slice(0, 12).map((w) => (
                  <button key={w.id} type="button" className={`ge-cam${playing?.id === w.id ? ' on' : ''}`} onClick={() => setPlaying(w)}>
                    {w.image ? <img src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="pubcam-ph" />}
                    <span className="pubcam-t">{w.title}</span>
                    <span className="pubcam-d">{target ? formatDistance(distanceM(target, w)) : ''}{w.city ? ` · ${w.city}` : ''}</span>
                  </button>
                ))}
              </div>
              <PublicCamsAttribution sources={pub.sources} />
            </>
          ) : null}
        </div>
      </div>

      {zoomCam ? (
        <Modal title={`Câmara pública · ${zoomCam.title}`} onClose={() => setZoomCam(null)} wide>
          <PublicCamView cam={zoomCam} />
        </Modal>
      ) : null}
    </>
  );
}
