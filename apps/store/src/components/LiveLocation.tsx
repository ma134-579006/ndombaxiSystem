import { useEffect, useRef } from 'react';
import { api } from '../api/client';
import { watchHighAccuracy } from '../store/geo';

/**
 * Transmite a localização GPS do cliente em TEMPO REAL para a loja, enquanto a
 * encomenda está ativa (página de confirmação/seguimento). Não desenha nada.
 * Envia no máximo a cada 4s (ou quando a posição muda significativamente).
 */
export function LiveLocation({ code, orderId, token }: { code: string; orderId: string; token?: string }) {
  const lastSent = useRef(0);
  const lastPos = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (!code || !orderId || !token) return;
    const stop = watchHighAccuracy((fix) => {
      const now = Date.now();
      const moved = !lastPos.current
        || Math.abs(lastPos.current.lat - fix.lat) > 0.00002
        || Math.abs(lastPos.current.lng - fix.lng) > 0.00002;
      if (now - lastSent.current < 4000 && !moved) return;
      lastSent.current = now;
      lastPos.current = { lat: fix.lat, lng: fix.lng };
      void api.updateLocation(code, orderId, token, { lat: fix.lat, lng: fix.lng, accuracy: fix.accuracy }).catch(() => undefined);
    });
    return stop;
  }, [code, orderId, token]);

  return null;
}
