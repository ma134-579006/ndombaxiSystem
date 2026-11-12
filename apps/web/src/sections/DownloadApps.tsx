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
/** Ícone da app LPS Loja: o mesmo da app instalada (logótipo LPS num saco de compras). */
const StoreAppIcon = () => (
  <img src={`${import.meta.env.BASE_URL}app-icon-loja.png`} alt="" width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
);
const DlIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 11l5 5 5-5M5 20h14" /></svg>
);

/** Ícone da app LPS Kwanza: o mesmo da app instalada (carrinho branco em azul). */
const KwanzaAppIcon = () => (
  <img src={`${import.meta.env.BASE_URL}app-icon-kwanza.png`} alt="" width={64} height={64} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
);
const Arrow = () => (
  <svg className="dl-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);

interface Group { id: string; title: string; brand: React.ReactNode; apps: PlatformMeta[] }

const GROUPS: Group[] = [
  {
    id: 'vendas', title: 'LPS Vendas', brand: <img src={`${import.meta.env.BASE_URL}app-icon-foreground.png`} alt="" />,
    apps: [
      { id: 'windows', label: 'Windows', tagline: 'Gestão e caixa no computador', defaultReq: 'Windows 10 ou 11 · 64-bit', icon: <WinIcon /> },
      { id: 'android', label: 'Android', tagline: 'Gestão e caixa no telemóvel', defaultReq: 'Android 6 ou superior', icon: <AndroidIcon /> },
      { id: 'ios', label: 'iPhone', tagline: 'Gestão e caixa no iPhone', defaultReq: 'iOS 13 ou superior', icon: <AppleIcon /> },
      { id: 'android-loja', label: 'LPS Loja', tagline: 'Loja online para os clientes', defaultReq: 'Android 6 ou superior', icon: <StoreAppIcon /> },
    ],
  },
  {
    id: 'kwanza', title: 'LPS Kwanza', brand: <img src={`${import.meta.env.BASE_URL}app-icon-kwanza.png`} alt="" />,
    apps: [
      { id: 'android-kwanza', label: 'Android', tagline: 'Marketplace de associados', defaultReq: 'Android 6 ou superior', icon: <KwanzaAppIcon /> },
      { id: 'windows-kwanza', label: 'Windows', tagline: 'Marketplace de associados', defaultReq: 'Windows 10 ou 11 · 64-bit', icon: <KwanzaAppIcon /> },
    ],
  },
];

function fmtSize(n: number | null): string | null {
  if (!n) return null;
  const mb = n / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(0)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-PT', { day: '2-digit', month: 'short', year: 'numeric' });
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
        <h2>Baixar aplicativos</h2>

        {GROUPS.map((g) => (
          <div className={`dl-group dl-g-${g.id}`} key={g.id} id={g.id === 'kwanza' ? 'baixar-kwanza' : undefined}>
            <div className="dl-group-h">
              <span className="dl-group-logo" aria-hidden="true">{g.brand}</span>
              <h3>{g.title}</h3>
              <span className="dl-group-n">{g.apps.length} apps</span>
            </div>
            <div className="dl-grid">
              {g.apps.map((p) => {
                const rel = releases?.[p.id] ?? null;
                const href = rel?.downloadUrl || rel?.downloadPageUrl || undefined;
                const size = rel ? fmtSize(rel.fileSize) : null;
                return (
                  <article className={`dl-card dl-${p.id}`} key={p.id}>
                    <div className="dl-head">
                      <div className="dl-icon" aria-hidden="true">{p.icon}</div>
                      <div className="dl-ht">
                        <h4>{p.label}</h4>
                        <p className="dl-tag">{p.tagline}</p>
                      </div>
                    </div>
                    <dl className="dl-facts">
                      <div><dt>Versão</dt><dd>{rel ? rel.version : '—'}</dd></div>
                      <div><dt>Tamanho</dt><dd>{size || '—'}</dd></div>
                      <div className="full"><dt>Requisitos</dt><dd>{rel?.requirements || p.defaultReq}</dd></div>
                      {rel ? <div className="full"><dt>Atualizado</dt><dd>{fmtDate(rel.releasedAt)}</dd></div> : null}
                    </dl>
                    {rel && (rel.notes.length > 0 || rel.fixes.length > 0) ? (
                      <details className="dl-changelog">
                        <summary>Novidades</summary>
                        <ul>
                          {rel.notes.map((n, i) => <li key={`n${i}`}>{n}</li>)}
                          {rel.fixes.map((f, i) => <li key={`f${i}`} className="fix">Correção: {f}</li>)}
                        </ul>
                      </details>
                    ) : null}
                    {rel && href ? (
                      <a className="dl-btn" href={href} target="_blank" rel="noreferrer" aria-label={`Baixar ${g.title} para ${p.label}`}>
                        <DlIcon /><span>Baixar</span><Arrow />
                      </a>
                    ) : (
                      <span className="dl-btn disabled" aria-disabled="true">{loaded ? 'Em breve' : 'A carregar…'}</span>
                    )}
                    {rel?.sha256 ? <p className="dl-hash" title="SHA-256">SHA-256 <code>{rel.sha256.slice(0, 16)}…</code></p> : null}
                  </article>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
