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
        <span>{!result.configured ? 'Serviço não ativado' : result.error ?? (result.items.length
          ? `${result.items.length} num raio de ${result.radiusKm} km${result.expanded ? ' (procura alargada: não havia mais perto)' : ''}`
          : `Nenhuma câmara pública num raio de ${result.radiusKm} km`)}</span>
      </div>
      {!result.configured ? (
        <p className="pubcams-off">
          As câmaras públicas (Windy Webcams) ainda não estão ativas nesta plataforma. O administrador da plataforma
          ativa-as em <b>Super Admin › Integrações › Câmaras públicas</b> com a chave gratuita da Windy.
        </p>
      ) : null}
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
      {result.configured ? <a className="pubcams-attr" href="https://www.windy.com/webcams" target="_blank" rel="noreferrer">Webcams fornecidas por Windy.com</a> : null}
    </div>
  );
}

/** Imagem / leitor de uma câmara pública (página oficial da Windy embutida). */
export function PublicCamView({ cam }: { cam: PublicWebcam }) {
  return (
    <div className="pubcam-view">
      {cam.player ? (
        <iframe src={cam.player} title={cam.title} allow="autoplay; fullscreen" referrerPolicy="no-referrer" />
      ) : cam.image ? (
        <img src={cam.image} alt={cam.title} referrerPolicy="no-referrer" />
      ) : (
        <div className="loading">Esta câmara não tem imagem disponível agora.</div>
      )}
      <div className="pubcam-view-foot">
        <span>{[cam.city, cam.updatedAt ? `atualizada ${formatDate(cam.updatedAt)}` : null].filter(Boolean).join(' · ')}</span>
        <a href={cam.pageUrl} target="_blank" rel="noreferrer">Abrir em Windy.com</a>
      </div>
    </div>
  );
}

