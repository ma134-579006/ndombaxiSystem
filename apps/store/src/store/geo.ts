/** Localização GPS de alta precisão (mesma fonte do Google Maps no telemóvel). */

export interface GeoFix { lat: number; lng: number; accuracy: number }

export type GeoErrorKind = 'unsupported' | 'denied' | 'unavailable' | 'timeout';
export class GeoError extends Error {
  constructor(public kind: GeoErrorKind, message: string) { super(message); this.name = 'GeoError'; }
}

const MSG: Record<GeoErrorKind, string> = {
  unsupported: 'O seu dispositivo/navegador não suporta GPS. Use um telemóvel com localização.',
  denied: 'Precisamos da sua localização GPS para entregar. Ative o GPS e PERMITA o acesso à localização para concluir a encomenda.',
  unavailable: 'Não foi possível obter o sinal de GPS. Verifique se o GPS está ligado e tente ao ar livre.',
  timeout: 'Demorou a obter o GPS. Verifique o sinal e tente novamente.',
};

/**
 * Pede UMA posição (para o checkout). Tenta ALTA PRECISÃO (GPS) primeiro; se
 * demorar/falhar o sinal (típico em interiores), faz fallback para precisão
 * normal para não bloquear o cliente. PERMISSION_DENIED falha de imediato.
 * Funciona em Chrome/Edge/Firefox/Safari (Windows, macOS, iOS, Android).
 * Deve ser chamada DENTRO do gesto do utilizador (clique) — é o que fazemos.
 */
export function getHighAccuracyPosition(timeoutMs = 15000): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new GeoError('unsupported', MSG.unsupported));
      return;
    }
    // A Geolocation só funciona em contexto seguro (HTTPS). Em produção é HTTPS.
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      reject(new GeoError('unavailable', 'A localização só funciona em ligação segura (HTTPS).'));
      return;
    }
    const ok = (pos: GeolocationPosition) =>
      resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 });
    const fail = (err: GeolocationPositionError) => {
      const kind: GeoErrorKind = err.code === err.PERMISSION_DENIED ? 'denied'
        : err.code === err.TIMEOUT ? 'timeout' : 'unavailable';
      reject(new GeoError(kind, MSG[kind]));
    };
    navigator.geolocation.getCurrentPosition(
      ok,
      (err) => {
        // Se o utilizador RECUSOU, não insistir. Caso contrário (timeout/sem
        // sinal de GPS), tentar uma vez com precisão normal para não bloquear.
        if (err.code === err.PERMISSION_DENIED) { fail(err); return; }
        navigator.geolocation.getCurrentPosition(ok, fail, {
          enableHighAccuracy: false, timeout: 12000, maximumAge: 60000,
        });
      },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}

/**
 * Observa a posição em tempo real (alta precisão) e chama `onFix` a cada leitura.
 * Devolve uma função para parar. Usado depois da encomenda, enquanto ativa.
 */
export function watchHighAccuracy(onFix: (fix: GeoFix) => void, onError?: (e: GeoError) => void): () => void {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    onError?.(new GeoError('unsupported', MSG.unsupported));
    return () => undefined;
  }
  const id = navigator.geolocation.watchPosition(
    (pos) => onFix({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy ?? 0 }),
    (err) => {
      const kind: GeoErrorKind = err.code === err.PERMISSION_DENIED ? 'denied'
        : err.code === err.TIMEOUT ? 'timeout' : 'unavailable';
      onError?.(new GeoError(kind, MSG[kind]));
    },
    { enableHighAccuracy: true, timeout: 27000, maximumAge: 5000 },
  );
  return () => { try { navigator.geolocation.clearWatch(id); } catch { /* */ } };
}
