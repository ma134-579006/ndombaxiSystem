import { useEffect, useState } from 'react';

/**
 * "Expandir" / "Diminuir" — a janela passa a ocupar o ECRÃ INTEIRO do computador
 * (sem barras do navegador nem do sistema), como no menu da conta do POS de
 * referência; "Diminuir" ou Esc volta ao normal.
 *
 * Fullscreen API nativa + prefixos para TODOS os navegadores: webkit (Safari,
 * Chrome/Edge antigos, WebViews), moz (Firefox antigo) e ms (IE11/Edge Legacy).
 * Onde não existe de todo (ex.: Safari do iPhone, que só põe vídeos em ecrã
 * inteiro), o item do menu não aparece.
 */
type FsDoc = Document & {
  webkitFullscreenEnabled?: boolean; mozFullScreenEnabled?: boolean; msFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null; webkitCurrentFullScreenElement?: Element | null;
  mozFullScreenElement?: Element | null; msFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void; webkitCancelFullScreen?: () => void;
  mozCancelFullScreen?: () => Promise<void> | void; msExitFullscreen?: () => Promise<void> | void;
};
type FsEl = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void> | void; webkitRequestFullScreen?: () => void;
  mozRequestFullScreen?: () => Promise<void> | void; msRequestFullscreen?: () => Promise<void> | void;
};

const EVENTS = ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'];

export function fullscreenSupported(): boolean {
  if (typeof document === 'undefined') return false;
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled ?? d.mozFullScreenEnabled ?? d.msFullscreenEnabled;
  const can = !!(el.requestFullscreen || el.webkitRequestFullscreen || el.webkitRequestFullScreen || el.mozRequestFullScreen || el.msRequestFullscreen);
  return can && enabled !== false;
}

export function isFullscreen(): boolean {
  const d = document as FsDoc;
  return !!(d.fullscreenElement || d.webkitFullscreenElement || d.webkitCurrentFullScreenElement || d.mozFullScreenElement || d.msFullscreenElement);
}

export async function toggleFullscreen(): Promise<void> {
  const d = document as FsDoc;
  const el = document.documentElement as FsEl;
  try {
    if (isFullscreen()) {
      if (d.exitFullscreen) await d.exitFullscreen();
      else if (d.webkitExitFullscreen) await d.webkitExitFullscreen();
      else if (d.webkitCancelFullScreen) d.webkitCancelFullScreen();
      else if (d.mozCancelFullScreen) await d.mozCancelFullScreen();
      else if (d.msExitFullscreen) await d.msExitFullscreen();
    } else if (el.requestFullscreen) await el.requestFullscreen({ navigationUI: 'hide' });
    else if (el.webkitRequestFullscreen) await el.webkitRequestFullscreen();
    else if (el.webkitRequestFullScreen) el.webkitRequestFullScreen();
    else if (el.mozRequestFullScreen) await el.mozRequestFullScreen();
    else if (el.msRequestFullscreen) await el.msRequestFullscreen();
  } catch { /* o navegador recusou (sem gesto do utilizador, política) — nada a fazer */ }
}

/** Estado actual (também quando se sai com Esc/F11) e a acção para alternar. */
export function useFullscreen(): { supported: boolean; on: boolean; toggle: () => void } {
  const [on, setOn] = useState(() => (typeof document !== 'undefined' ? isFullscreen() : false));
  useEffect(() => {
    const sync = () => setOn(isFullscreen());
    EVENTS.forEach((ev) => document.addEventListener(ev, sync));
    return () => EVENTS.forEach((ev) => document.removeEventListener(ev, sync));
  }, []);
  return { supported: fullscreenSupported(), on, toggle: () => void toggleFullscreen() };
}
