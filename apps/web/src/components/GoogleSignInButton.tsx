import React, { useEffect, useRef, useState } from 'react';
import { GOOGLE_CLIENT_ID } from '../config';

interface GoogleIdApi {
  accounts: {
    id: {
      initialize(cfg: Record<string, unknown>): void;
      renderButton(el: HTMLElement, opts: Record<string, unknown>): void;
    };
  };
}

let scriptPromise: Promise<void> | null = null;
function loadGsi(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if ((window as unknown as { google?: GoogleIdApi }).google) { resolve(); return; }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('load'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Botão "Entrar com Google" (Google Identity Services). Devolve o ID token via
 * onCredential. RESILIENTE: se o Google não carregar/renderizar (ex.: domínio
 * não autorizado no Google Cloud), mostra um aviso em vez de ficar em branco —
 * o utilizador continua a poder usar o e-mail.
 */
export function GoogleSignInButton({ onCredential }: { onCredential(idToken: string): void }) {
  // Na APP INSTALADA (desktop/móvel) o Google BLOQUEIA o seu OAuth dentro de
  // WebViews (política "disallowed_useragent") — o botão nunca completaria o
  // login. Por isso escondemo-lo na app e o utilizador entra por e-mail/PIN; o
  // SITE (navegador normal) continua a mostrar o Google. (Login nativo com Google
  // fica para um passo próprio, com plugin nativo — ver notas.)
  const nw = window as unknown as {
    ndombaxi?: unknown; __NDOMBAXI_NATIVE__?: boolean;
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  const isNativeApp = window.location.protocol === 'ndombaxi:'
    || typeof nw.ndombaxi !== 'undefined'
    || nw.__NDOMBAXI_NATIVE__ === true
    || !!nw.Capacitor?.isNativePlatform?.();

  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isNativeApp) return;               // app instalada: Google escondido
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !ref.current) return;
      const g = (window as unknown as { google?: GoogleIdApi }).google;
      if (!g) { setFailed(true); return; }
      try {
        g.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          callback: (r: { credential?: string }) => { if (r?.credential) cbRef.current(r.credential); },
          // Se o domínio não estiver autorizado, a Google chama este callback.
          error_callback: () => setFailed(true),
          use_fedcm_for_prompt: false,
        });
        g.accounts.id.renderButton(ref.current, {
          theme: 'outline', size: 'large', width: 280, text: 'continue_with', shape: 'pill',
        });
        // Se em 3s o botão não renderizou (origem não autorizada), mostra aviso.
        window.setTimeout(() => {
          if (!cancelled && ref.current && ref.current.childElementCount === 0) setFailed(true);
        }, 3000);
      } catch {
        setFailed(true);
      }
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  if (isNativeApp) return null; // app instalada: sem Google (usa-se e-mail/PIN)
  if (failed) {
    return (
      <div className="muted" style={{ fontSize: 12, textAlign: 'center', maxWidth: 300 }}>
        Entrar com Google indisponível neste momento. Use o <strong>e-mail e palavra-passe</strong> acima.
      </div>
    );
  }
  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />;
}
