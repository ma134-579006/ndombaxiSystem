import React, { useEffect, useRef } from 'react';
import { GOOGLE_CLIENT_ID } from '../config';

interface GoogleIdApi {
  accounts: {
    id: {
      initialize(cfg: { client_id: string; callback: (r: { credential: string }) => void }): void;
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
    s.onerror = () => reject(new Error('Falha ao carregar o Google.'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/**
 * Botão "Entrar com Google" (Google Identity Services). Devolve o ID token
 * via onCredential; o backend verifica-o. Renderiza o botão oficial da Google.
 */
export function GoogleSignInButton({ onCredential }: { onCredential(idToken: string): void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const cbRef = useRef(onCredential);
  cbRef.current = onCredential;

  useEffect(() => {
    let cancelled = false;
    loadGsi().then(() => {
      if (cancelled || !ref.current) return;
      const g = (window as unknown as { google?: GoogleIdApi }).google;
      if (!g) return;
      g.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (r) => { if (r?.credential) cbRef.current(r.credential); },
      });
      g.accounts.id.renderButton(ref.current, {
        theme: 'outline', size: 'large', width: 280, text: 'continue_with', shape: 'pill',
      });
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  return <div ref={ref} style={{ display: 'flex', justifyContent: 'center' }} />;
}
