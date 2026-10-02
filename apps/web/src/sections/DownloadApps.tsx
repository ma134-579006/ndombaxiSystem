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

const WinIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path fill="currentColor" d="M2.5 4.9 10.2 3.8v7.5H2.5zM11.3 3.65 21.5 2.2v9.1H11.3zM2.5 12.4h7.7v7.5l-7.7-1.1zM11.3 12.4h10.2v9.4l-10.2-1.4z" />
  </svg>
);
const AndroidIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path fill="currentColor" d="M17.6 9.5a.9.9 0 1 1 1.8 0v5.6a.9.9 0 1 1-1.8 0zM4.6 9.5a.9.9 0 1 1 1.8 0v5.6a.9.9 0 1 1-1.8 0z" />
    <path fill="currentColor" d="M7 8.9h10v8.1a1.2 1.2 0 0 1-1.2 1.2h-.9v2.6a1.1 1.1 0 0 1-2.2 0v-2.6h-1.4v2.6a1.1 1.1 0 0 1-2.2 0v-2.6h-.9A1.2 1.2 0 0 1 7 17z" />
    <path fill="currentColor" d="M7.1 8.3a5 5 0 0 1 9.8 0zM15.6 2.9l1-1.5a.4.4 0 1 0-.7-.4l-1 1.5a5.6 5.6 0 0 0-5.8 0l-1-1.5a.4.4 0 1 0-.7.4l1 1.5" />
    <circle cx="9.7" cy="6.1" r=".7" fill="#fff" /><circle cx="14.3" cy="6.1" r=".7" fill="#fff" />
  </svg>
);
const AppleIcon = () => (
  <svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true">
    <path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
  </svg>
);
const DlIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
);

const PLATFORMS: PlatformMeta[] = [
  { id: 'windows', label: 'Windows', tagline: 'Para o computador da loja e do escritório.', defaultReq: 'Windows 10 ou 11 · 64-bit', icon: <WinIcon /> },
  { id: 'android', label: 'Android', tagline: 'Venda e faça a gestão a partir do telemóvel.', defaultReq: 'Android 6 ou superior', icon: <AndroidIcon /> },
  { id: 'ios', label: 'iPhone', tagline: 'A mesma experiência, no seu iOS.', defaultReq: 'iOS 13 ou superior', icon: <AppleIcon /> },
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
        <h2>Leve o LPS Vendas consigo</h2>
        <p className="lead">
          A mesma aplicação do site, agora instalada no seu equipamento — a funcionar mesmo
          sem internet e a sincronizar sozinha quando a ligação voltar.
        </p>

        <div className="dl-trust">
          <span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg> Funciona sem internet</span>
          <span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5" /></svg> Sincroniza sozinha</span>
          <span><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /></svg> Instalador oficial verificado</span>
        </div>

        <div className="dl-grid">
          {PLATFORMS.map((p) => {
            const rel = releases?.[p.id] ?? null;
            const available = Boolean(rel);
            // A app encaminha sempre para a página oficial; aqui o botão leva ao
            // link definido pelo Super Admin (que pode ser a própria página).
            const href = rel?.downloadPageUrl || undefined;

            return (
              <article className={`dl-card dl-${p.id} ${available ? '' : 'soon'}`} key={p.id}>
                <div className="dl-head">
                  <div className="dl-icon" aria-hidden="true">{p.icon}</div>
                  <div className="dl-ht">
                    <h3>{p.label}</h3>
                    <p className="dl-tag">{p.tagline}</p>
                  </div>
                  <span className={`dl-badge${available ? '' : ' soon'}`}>{available ? `v${rel!.version}` : 'Em breve'}</span>
                </div>

                <div className="dl-facts">
                  <div className="full"><span>Requisitos</span><b>{rel?.requirements || p.defaultReq}</b></div>
                  {available && (
                    <>
                      <div><span>Atualizado</span><b>{fmtDate(rel!.releasedAt)}</b></div>
                      <div><span>Tamanho</span><b>{fmtSize(rel!.fileSize) || '—'}</b></div>
                    </>
                  )}
                </div>

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
                    <DlIcon /> Baixar para {p.label}
                  </a>
                ) : (
                  <span className="dl-btn disabled" aria-disabled="true">
                    {loaded ? 'Disponível em breve' : 'A carregar…'}
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
