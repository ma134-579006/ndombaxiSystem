import React, { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { AppPlatform, PublicRelease } from '../api/types';
import './downloadApps.css';

/**
 * Secção "Baixar Aplicativo" da página inicial.
 *
 * Mostra a versão mais recente de cada plataforma, alimentada por
 * `/downloads/public` (o Super Admin publica; aqui só se lê). Segue a estética
 * sóbria de Apple/Microsoft/Stripe pedida no briefing — sem nada infantil, e
 * ADITIVA: não mexe em nada do que já existe na landing.
 *
 * Quando uma plataforma ainda não tem versão publicada, o cartão mostra
 * "Em breve" em vez de um botão morto — honesto e sem link partido.
 */

interface PlatformMeta {
  id: AppPlatform;
  label: string;
  tagline: string;
  defaultReq: string;
  icon: React.ReactNode;
}

const PLATFORMS: PlatformMeta[] = [
  {
    id: 'windows', label: 'Windows', tagline: 'Para o computador da loja e do escritório.',
    defaultReq: 'Windows 10 ou 11 · 64-bit',
    icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M3 5.6 10.4 4.5v7.1H3zM10.4 12.6v7.1L3 18.6v-6zM11.6 4.3 21 3v8.6h-9.4zM21 12.6V21l-9.4-1.3v-7.1z"/></svg>,
  },
  {
    id: 'android', label: 'Android', tagline: 'Venda e faça a gestão a partir do telemóvel.',
    defaultReq: 'Android 6 ou superior',
    icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M6 9h12v8a2 2 0 0 1-2 2h-1v3h-2v-3h-2v3H9v-3H8a2 2 0 0 1-2-2zM4 9.5A1.5 1.5 0 0 1 5.5 11v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 4 9.5m16 0A1.5 1.5 0 0 1 21.5 11v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 20 9.5M7.2 7.8A6 6 0 0 1 12 5.5c1.9 0 3.6.9 4.8 2.3z"/></svg>,
  },
  {
    id: 'ios', label: 'iPhone', tagline: 'A mesma experiência, no seu iOS.',
    defaultReq: 'iOS 13 ou superior',
    icon: <svg viewBox="0 0 24 24" width="30" height="30" fill="currentColor"><path d="M16 3c.1 1.2-.4 2.3-1.1 3.1-.8.9-2 1.5-3 1.4-.1-1.1.4-2.3 1.1-3C13.8 3.6 15.1 3 16 3M18.7 17c-.5 1.2-.8 1.7-1.4 2.7-1 1.5-2.3 3.3-4 3.3-1.5 0-1.9-1-4-1-2 0-2.5 1-4 1-1.6 0-2.9-1.7-3.8-3.1C-.7 15.6-.2 9 3.8 8.2c1.2-.2 2 .5 3.1.5 1 0 1.7-.7 3.1-.7 1.3 0 2.4.6 3.1.9-2.8 1.6-2.3 5.6.5 6.3z"/></svg>,
  },
];

function fmtSize(n: number | null): string | null {
  if (!n) return null;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}

export function DownloadApps() {
  const [releases, setReleases] = useState<Record<AppPlatform, PublicRelease | null> | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.publicDownloads()
      .then(setReleases)
      .catch(() => setReleases(null))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <section className="lp-section dl-section" id="baixar">
      <div className="wrap">
        <h2>Leve o Ndombaxi consigo</h2>
        <p className="lead">
          A mesma aplicação do site, agora instalada no seu equipamento — a funcionar mesmo
          sem internet e a sincronizar sozinha quando a ligação voltar.
        </p>

        <div className="dl-grid">
          {PLATFORMS.map((p) => {
            const rel = releases?.[p.id] ?? null;
            const available = Boolean(rel);
            // A app encaminha sempre para a página oficial; aqui o botão leva ao
            // link definido pelo Super Admin (que pode ser a própria página).
            const href = rel?.downloadPageUrl || undefined;

            return (
              <article className={`dl-card ${available ? '' : 'soon'}`} key={p.id}>
                <div className="dl-icon" aria-hidden="true">{p.icon}</div>
                <h3>{p.label}</h3>
                <p className="dl-tag">{p.tagline}</p>

                <ul className="dl-meta">
                  <li><span>Requisitos</span><b>{rel?.requirements || p.defaultReq}</b></li>
                  {available && (
                    <>
                      <li><span>Versão</span><b>{rel!.version}</b></li>
                      <li><span>Atualizado</span><b>{fmtDate(rel!.releasedAt)}</b></li>
                      {fmtSize(rel!.fileSize) && <li><span>Tamanho</span><b>{fmtSize(rel!.fileSize)}</b></li>}
                    </>
                  )}
                </ul>

                {available && (rel!.notes.length > 0 || rel!.fixes.length > 0) && (
                  <details className="dl-changelog">
                    <summary>Novidades desta versão</summary>
                    <ul>
                      {rel!.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
                      {rel!.fixes.map((f, i) => <li key={`f${i}`} className="fix">Correção: {f}</li>)}
                    </ul>
                  </details>
                )}

                {available ? (
                  <a className="dl-btn" href={href} target="_blank" rel="noreferrer">
                    Baixar para {p.label}
                  </a>
                ) : (
                  <span className="dl-btn disabled" aria-disabled="true">
                    {loaded ? 'Em breve' : 'A carregar…'}
                  </span>
                )}

                {available && rel!.sha256 && (
                  <p className="dl-hash" title="Impressão digital para confirmar a integridade do ficheiro">
                    SHA-256 <code>{rel!.sha256.slice(0, 16)}…</code>
                  </p>
                )}
              </article>
            );
          })}
        </div>

        <p className="dl-foot">
          Por sua segurança, o download passa sempre pela página oficial — é onde confirma a
          versão e a impressão digital do ficheiro.
        </p>
      </div>
    </section>
  );
}
