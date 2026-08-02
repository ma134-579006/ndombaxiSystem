import React, { useEffect } from 'react';
import { LOGO_SRC, SYSTEM_NAME } from '../brand';
import { DownloadApps } from '../sections/DownloadApps';
import '../landing.css';
import './downloadsPage.css';

/**
 * PÁGINA OFICIAL DE DOWNLOADS — `/baixar`.
 *
 * Página pública e autónoma (não precisa de sessão) para onde a app e o site
 * encaminham quem quer instalar. É a "página de downloads" que o botão da barra
 * de topo e os cartões de cada plataforma abrem. Reutiliza a mesma secção
 * "Baixar Aplicativo" da landing (versão, requisitos, hash e novidades vindos de
 * `/downloads/public`, publicados pelo Super Admin), com um cabeçalho próprio.
 */
export function DownloadsPage() {
  useEffect(() => { document.title = `Baixar — ${SYSTEM_NAME}`; }, []);
  const year = new Date().getFullYear();

  return (
    <div
      className="lp dlp"
      style={{ ['--lp-primary' as string]: '#2430e8', ['--lp-accent' as string]: '#22d3ee' }}
    >
      <nav className="lp-nav">
        <img className="logo" src={LOGO_SRC} alt={SYSTEM_NAME} />
        <span className="nm">{SYSTEM_NAME}</span>
        <span className="spacer" />
        <a className="dl-nav-btn" href="/" role="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
          <span>Voltar ao site</span>
        </a>
      </nav>

      <DownloadApps />

      <footer className="dlp-foot">© {year} {SYSTEM_NAME} · Descarregue sempre a partir desta página oficial.</footer>
    </div>
  );
}
