import React, { useMemo, useState } from 'react';
import type { AppPlatform } from '../api/types';
import { RELEASE_MANIFEST, prefillFromManifest, stashPrefill } from './releaseManifest';
import { toast } from '../components/feedback';
import './downloadWizard.css';

/**
 * ASSISTENTE DE PUBLICAÇÃO — Super Admin.
 *
 * Página dedicada e animada que auto-preenche o formulário de "Gestão de
 * Downloads" a partir do MANIFESTO DE VERSÕES (releaseManifest.ts). O único
 * campo que depende do administrador é o LINK do ficheiro; tudo o resto — versão,
 * requisitos, novidades, correções, hash — vem do manifesto.
 *
 * Fluxo: escolher plataforma → (opcional) colar o link → "Preencher no Super
 * Admin". Guarda o pacote e chama `onDone()`, que devolve à secção Downloads já
 * com o formulário preenchido, pronto a rever e publicar.
 */

interface Meta { id: AppPlatform; label: string; tagline: string; icon: React.ReactNode }

const PLATFORMS: Meta[] = [
  {
    id: 'windows', label: 'Windows', tagline: 'Computador da loja e do escritório',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.6 10.4 4.5v7.1H3zM10.4 12.6v7.1L3 18.6v-6zM11.6 4.3 21 3v8.6h-9.4zM21 12.6V21l-9.4-1.3v-7.1z" /></svg>,
  },
  {
    id: 'android', label: 'Android', tagline: 'Vender e gerir pelo telemóvel',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 9h12v8a2 2 0 0 1-2 2h-1v3h-2v-3h-2v3H9v-3H8a2 2 0 0 1-2-2zM4 9.5A1.5 1.5 0 0 1 5.5 11v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 4 9.5m16 0A1.5 1.5 0 0 1 21.5 11v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 20 9.5M7.2 7.8A6 6 0 0 1 12 5.5c1.9 0 3.6.9 4.8 2.3z" /></svg>,
  },
  {
    id: 'ios', label: 'iPhone (iOS)', tagline: 'A mesma experiência, no iOS',
    icon: <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3c.1 1.2-.4 2.3-1.1 3.1-.8.9-2 1.5-3 1.4-.1-1.1.4-2.3 1.1-3C13.8 3.6 15.1 3 16 3M18.7 17c-.5 1.2-.8 1.7-1.4 2.7-1 1.5-2.3 3.3-4 3.3-1.5 0-1.9-1-4-1-2 0-2.5 1-4 1-1.6 0-2.9-1.7-3.8-3.1C-.7 15.6-.2 9 3.8 8.2c1.2-.2 2 .5 3.1.5 1 0 1.7-.7 3.1-.7 1.3 0 2.4.6 3.1.9-2.8 1.6-2.3 5.6.5 6.3z" /></svg>,
  },
];

interface Props {
  /** Redireciona de volta à secção Downloads (com o formulário preenchido). */
  onDone: () => void;
  /** Voltar sem preencher. */
  onCancel?: () => void;
}

export function DownloadWizard({ onDone, onCancel }: Props) {
  const [platform, setPlatform] = useState<AppPlatform>('windows');
  const [fileUrl, setFileUrl] = useState('');
  const entry = useMemo(() => RELEASE_MANIFEST[platform], [platform]);

  const fill = () => {
    stashPrefill(prefillFromManifest(platform, fileUrl));
    toast.success('Formulário preenchido pelo assistente. ✨ Reveja e publique.');
    onDone();
  };

  return (
    <div className="dw">
      {/* ── Cabeçalho animado ── */}
      <header className="dw-hero">
        <div className="dw-hero-glow" aria-hidden="true" />
        <div className="dw-badge">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 3v4M3 5h4M6 17v4M4 19h4M13 3l2.5 6.5L22 12l-6.5 2.5L13 21l-2.5-6.5L4 12l6.5-2.5L13 3Z" /></svg>
          Publicação assistida
        </div>
        <h2>Publicar uma nova versão em segundos</h2>
        <p>Escolha a plataforma e o assistente preenche <b>tudo</b> por si — versão,
          requisitos, novidades, correções e a impressão digital. Só o <b>link do
          ficheiro</b> depende de si.</p>
      </header>

      {/* ── Passo 1: plataforma ── */}
      <section className="dw-step">
        <div className="dw-step-h"><span className="dw-num">1</span> Escolha a plataforma</div>
        <div className="dw-platforms">
          {PLATFORMS.map((p, i) => (
            <button
              key={p.id}
              type="button"
              className={`dw-plat ${platform === p.id ? 'on' : ''}`}
              style={{ animationDelay: `${i * 70}ms` }}
              onClick={() => setPlatform(p.id)}
            >
              <span className="dw-plat-ic">{p.icon}</span>
              <span className="dw-plat-t">
                <b>{p.label}</b>
                <small>{p.tagline}</small>
              </span>
              <span className="dw-plat-v">v{RELEASE_MANIFEST[p.id].version}</span>
            </button>
          ))}
        </div>
      </section>

      {/* ── Passo 2: pré-visualização do que vai ser preenchido ── */}
      <section className="dw-step">
        <div className="dw-step-h"><span className="dw-num">2</span> O que vai ser preenchido</div>
        <div className="dw-preview" key={platform}>
          <div className="dw-facts">
            <div className="dw-fact"><span>Versão</span><b>{entry.version}</b></div>
            <div className="dw-fact"><span>Versão mínima</span><b>{entry.minSupported || '—'}</b></div>
            <div className="dw-fact dw-fact-wide"><span>Requisitos</span><b>{entry.requirements}</b></div>
            <div className="dw-fact"><span>Impressão digital</span><b>{entry.sha256 ? `${entry.sha256.slice(0, 12)}…` : 'a calcular / opcional'}</b></div>
          </div>
          <div className="dw-lists">
            <div className="dw-list">
              <div className="dw-list-h dw-list-new">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /><circle cx="12" cy="12" r="4" /></svg>
                Novidades
              </div>
              <ul>{entry.notes.map((n, i) => <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{n}</li>)}</ul>
            </div>
            <div className="dw-list">
              <div className="dw-list-h dw-list-fix">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m20 6-11 11-5-5" /></svg>
                Correções
              </div>
              <ul>{entry.fixes.map((f, i) => <li key={i} style={{ animationDelay: `${i * 60}ms` }}>{f}</li>)}</ul>
            </div>
          </div>
        </div>
      </section>

      {/* ── Passo 3: o único campo que depende de si ── */}
      <section className="dw-step">
        <div className="dw-step-h"><span className="dw-num">3</span> Cole o link do ficheiro <span className="dw-you">só isto depende de si</span></div>
        <div className="dw-link">
          <span className="dw-link-ic" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" /></svg>
          </span>
          <input
            value={fileUrl}
            onChange={(e) => setFileUrl(e.target.value)}
            placeholder="https://drive.google.com/…  ·  https://mega.nz/…  ·  GitHub Release…"
            inputMode="url"
            autoFocus
          />
        </div>
        <p className="dw-hint">Pode colar agora ou deixar para o passo seguinte — o assistente preenche o resto na mesma.</p>
      </section>

      {/* ── Ações ── */}
      <div className="dw-actions">
        <button type="button" className="btn primary dw-cta" onClick={fill}>
          Preencher no Super Admin
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
        {onCancel && <button type="button" className="btn ghost" onClick={onCancel}>Cancelar</button>}
      </div>
    </div>
  );
}
