import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { GOOGLE_CLIENT_ID } from '../config';
import { loadGsi } from '../components/GoogleSignInButton';
import { nativeGoogleAvailable, nativeGoogleSignIn } from '../offline/nativeGoogle';
import { desktopGoogleAvailable, desktopGoogleSignIn } from '../offline/desktopGoogle';
import './vendus-auth.css';

/** App instalada (Windows/Android) — o OAuth do Google/Facebook não corre em WebView. */
export function appKind(): { native: boolean; desktop: boolean; mobile: boolean } {
  const nw = window as unknown as { ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean; Capacitor?: { isNativePlatform?: () => boolean } };
  const desktop = window.location.protocol === 'ndombaxi:' || typeof nw.ndombaxi !== 'undefined';
  const native = desktop || nw.__NDOMBAXI_NATIVE__ === true || !!nw.Capacitor?.isNativePlatform?.();
  return { native, desktop, mobile: native && !desktop };
}

export interface AuthSocialBtn { enabled?: boolean; label?: string; bg?: string; color?: string; border?: string }
/** Aparência do login (Super Admin → Login & Registo), igual à do painel. */
export interface AuthLook { primary?: string; pageBg?: string; linkColor?: string; sideFrom?: string; sideTo?: string; google?: AuthSocialBtn; facebook?: AuthSocialBtn }
export interface AuthPublic { look: AuthLook; trialDays: number; facebookAppId: string | null; plans: unknown[] }
let cache: AuthPublic | null = null;
let inflight: Promise<AuthPublic> | null = null;

/** Configuração pública do login/registo (Super Admin → Login & Registo). */
export function useAuthPublic(): AuthPublic | null {
  const [v, setV] = useState<AuthPublic | null>(cache);
  useEffect(() => {
    if (cache) return;
    inflight ??= api.publicLanding().then((l) => {
      cache = {
        look: (l.config?.authConfig ?? {}) as AuthLook,
        trialDays: l.config?.trialDays ?? 14,
        facebookAppId: l.facebookAppId ?? null,
        plans: l.plans ?? [],
      };
      return cache;
    }).catch(() => { inflight = null; return { look: {}, trialDays: 14, facebookAppId: null, plans: [] }; });
    let live = true;
    void inflight.then((x) => { if (live) setV(x); });
    return () => { live = false; };
  }, []);
  return v;
}

/** Variáveis CSS a partir das cores do Super Admin. */
export function lookVars(look: AuthLook | undefined): React.CSSProperties {
  const s: Record<string, string> = {};
  if (look?.primary) s['--va-primary'] = look.primary;
  if (look?.pageBg) s['--va-page'] = look.pageBg;
  if (look?.linkColor) s['--va-link'] = look.linkColor;
  if (look?.sideFrom) s['--va-side-from'] = look.sideFrom;
  if (look?.sideTo) s['--va-side-to'] = look.sideTo;
  return s as React.CSSProperties;
}

/** Estilo de um botão social (cores do Super Admin sobrepõem as do Vendus). */
export function btnStyle(b: AuthLook['google'], pill = false): React.CSSProperties {
  const s: React.CSSProperties = {};
  if (b?.bg) s.background = b.bg;
  if (b?.color) s.color = b.color;
  // O botão em pílula do login não tem borda (como no Vendus): a cor da borda
  // configurada desenha-se por dentro, sem mudar a altura.
  if (b?.border) { if (pill) s.boxShadow = `inset 0 0 0 1px ${b.border}`; else s.borderColor = b.border; }
  return s;
}

export function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.3-.4-3.5z" /><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.6 16 18.9 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.9 6.1 29.7 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.6 0 10.7-2.1 14.6-5.6l-6.7-5.7C29.8 34.6 27 36 24 36c-5.2 0-9.6-3.3-11.2-8l-6.6 5.1C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.2 4.2-4.1 5.6l6.7 5.7C41.7 35.4 44 30.1 44 24c0-1.3-.1-2.3-.4-3.5z" /></svg>
  );
}
/** "f" branco em quadrado arredondado (botão azul do login). */
export function FacebookSquare() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden><rect width="24" height="24" rx="3" fill="#fff" /><path fill="#4267B2" d="M16.6 24v-9.3h3.1l.5-3.6h-3.6V8.8c0-1 .3-1.8 1.8-1.8h1.9V3.8c-.3 0-1.5-.1-2.8-.1-2.8 0-4.6 1.7-4.6 4.8v2.6H9.8v3.6h3.1V24h3.7z" /></svg>
  );
}
/** Círculo azul do Facebook (botões do registo). */
export function FacebookCircle() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="12" fill="#1877F2" /><path fill="#fff" d="M15.1 15.5l.5-3.3h-3.1v-2.1c0-.9.4-1.8 1.9-1.8h1.4V5.5s-1.3-.2-2.5-.2c-2.6 0-4.2 1.6-4.2 4.4v2.5H6.3v3.3h2.8V24a11 11 0 0 0 3.4 0v-8.5h2.6z" /></svg>
  );
}

// ── Google (botão próprio): token do Google Identity Services ──────────────
interface GsiOAuth { accounts: { oauth2: { initTokenClient(cfg: Record<string, unknown>): { requestAccessToken(o?: Record<string, unknown>): void } } } }

/** Pré-carrega o script do Google (o clique tem de abrir a janela sem esperar). */
export function usePreloadSocial(fbAppId: string | null) {
  useEffect(() => {
    if (appKind().native) return;
    void loadGsi().catch(() => undefined);
    if (fbAppId) void loadFacebook(fbAppId).catch(() => undefined);
  }, [fbAppId]);
}

/**
 * Token do Google: no site abre a janela do Google (fluxo de token, com o
 * botão desenhado por nós, igual ao do Vendus); na app usa o login nativo
 * (Android) ou o navegador do sistema (Windows), que devolvem um ID token.
 */
export async function googleToken(): Promise<string | null> {
  const k = appKind();
  if (k.native) {
    if (k.mobile) {
      if (!nativeGoogleAvailable()) throw new Error('Entrar com Google ainda não está disponível nesta versão da app. Atualize para a versão mais recente.');
      return nativeGoogleSignIn();
    }
    if (!desktopGoogleAvailable()) throw new Error('Entrar com Google ainda não está disponível nesta versão da app. Atualize para a versão mais recente.');
    return desktopGoogleSignIn();
  }
  await loadGsi();
  const g = (window as unknown as { google?: GsiOAuth }).google;
  if (!g?.accounts?.oauth2) throw new Error('Entrar com Google indisponível neste momento.');
  return new Promise((resolve) => {
    const client = g.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: 'openid email profile',
      callback: (r: { access_token?: string }) => resolve(r?.access_token ?? null),
      error_callback: () => resolve(null),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// ── Facebook (SDK JS) ───────────────────────────────────────────────────────
interface FBApi {
  init(o: Record<string, unknown>): void;
  login(cb: (r: { authResponse?: { accessToken?: string } | null }) => void, o: Record<string, unknown>): void;
}
let fbPromise: Promise<void> | null = null;
function loadFacebook(appId: string): Promise<void> {
  if (fbPromise) return fbPromise;
  fbPromise = new Promise<void>((resolve, reject) => {
    const w = window as unknown as { FB?: FBApi; fbAsyncInit?: () => void };
    const init = () => { w.FB!.init({ appId, cookie: false, xfbml: false, version: 'v19.0' }); resolve(); };
    if (w.FB) { init(); return; }
    w.fbAsyncInit = init;
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/pt_PT/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => { fbPromise = null; reject(new Error('load')); };
    document.head.appendChild(s);
  });
  return fbPromise;
}

/** Access token do Facebook (janela do Facebook com pedido do e-mail). */
export async function facebookToken(appId: string | null): Promise<string | null> {
  if (appKind().native) throw new Error('Entrar com Facebook está disponível no site (navegador).');
  if (!appId) throw new Error('Entrar com Facebook ainda não está disponível.');
  await loadFacebook(appId);
  const FB = (window as unknown as { FB?: FBApi }).FB;
  if (!FB) throw new Error('Entrar com Facebook indisponível neste momento.');
  return new Promise((resolve) => FB.login((r) => resolve(r?.authResponse?.accessToken ?? null), { scope: 'email', auth_type: 'rerequest' }));
}

/**
 * Sem scroll em nenhum ecrã: se o conteúdo for mais alto do que a janela,
 * encolhe-o (CSS zoom, suportado por Chrome, Edge, Safari e Firefox ≥126)
 * até caber. Recalcula ao redimensionar e quando o conteúdo muda.
 */
export function useFitHeight<T extends HTMLElement>(pad = 24): React.RefObject<T> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Síncrono (sem requestAnimationFrame, que pára com a janela em segundo plano).
    const fit = () => {
      el.style.zoom = '';
      const h = el.scrollHeight;
      const avail = window.innerHeight - pad * 2;
      el.style.zoom = h > avail && h > 0 ? String(Math.max(0.2, Math.floor(((avail - 4) / h) * 1000) / 1000)) : '';
    };
    fit();
    window.addEventListener('resize', fit);
    const mo = new MutationObserver(fit);
    mo.observe(el, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
    const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts;
    void fonts?.ready.then(fit);
    return () => { window.removeEventListener('resize', fit); mo.disconnect(); };
  }, [pad]);
  return ref;
}
