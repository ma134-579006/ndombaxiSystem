import React from 'react';
import type { PublicWebcam, PublicWebcamsResult } from '../api/types';
import { distanceM, formatDistance } from './RouteCompass';
import { formatDate } from '../format';

/** Lista das câmaras públicas perto do cliente (a mais próxima primeiro). */
export function PublicCams({ result, from, onOpen, title = 'Câmaras públicas perto do cliente' }: { result: PublicWebcamsResult; from: { lat: number; lng: number }; onOpen(w: PublicWebcam): void; title?: string }) {
  return (
    <div className="pubcams">
      <div className="pubcams-head">
        <strong>{title}</strong>
        <span>{result.error ?? (result.items.length
          ? `${result.items.length} num raio de ${result.radiusKm} km${result.expanded ? ' (procura alargada: não havia mais perto)' : ''}`
          : `Nenhuma câmara pública num raio de ${result.radiusKm} km`)}</span>
      </div>

      {result.items.length ? (
        <div className="pubcams-list">
          {result.items.slice(0, 12).map((w) => (
            <button key={w.id} type="button" className="pubcam" onClick={() => onOpen(w)}>
              {w.image ? <img src={w.image} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span className="pubcam-ph" />}
              <span className="pubcam-t">{w.title}</span>
              <span className="pubcam-d">{formatDistance(distanceM(from, w))}{w.city ? ` · ${w.city}` : ''}</span>
            </button>
          ))}
        </div>
      ) : null}
      <PublicCamsAttribution sources={result.sources} />
    </div>
  );
}

/** Imagem / leitor de uma câmara pública (leitor da Windy, imagem direta ou link para a câmara). */
export function PublicCamView({ cam }: { cam: PublicWebcam }) {
  return (
    <div className="pubcam-view">
      {cam.player ? (
        <iframe src={cam.player} title={cam.title} allow="autoplay; fullscreen" referrerPolicy="no-referrer" />
      ) : cam.image ? (
        <img src={cam.image} alt={cam.title} referrerPolicy="no-referrer" />
      ) : (
        <div className="loading">Esta câmara abre no site do dono: use «Abrir a câmara».</div>
      )}
      <div className="pubcam-view-foot">
        <span>{[cam.city, cam.updatedAt ? `atualizada ${formatDate(cam.updatedAt)}` : null].filter(Boolean).join(' · ')}</span>
        <a href={cam.pageUrl} target="_blank" rel="noreferrer">{camLinkLabel(cam)}</a>
      </div>
    </div>
  );
}

/** Atribuição das fontes usadas (obrigatória para Windy e OpenStreetMap). */
export function PublicCamsAttribution({ sources }: { sources?: ('windy' | 'osm')[] }) {
  const s = sources?.length ? sources : ['osm'];
  return (
    <span className="pubcams-attr">
      Câmaras públicas:{' '}
      {s.includes('osm') ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap</a> : null}
      {s.includes('osm') && s.includes('windy') ? ' · ' : null}
      {s.includes('windy') ? <a href="https://www.windy.com/webcams" target="_blank" rel="noreferrer">Windy.com</a> : null}
    </span>
  );
}

/** Texto do link para a página da câmara, conforme a fonte. */
export const camLinkLabel = (w: { source?: string }) => (w.source === 'windy' ? 'Abrir em Windy.com' : 'Abrir a câmara');
