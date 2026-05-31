import { useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { API_URL, REALTIME_NAMESPACE } from '../config';
import type { OrderMessage, SaleEmittedEvent } from '../api/types';

interface RealtimeHandlers {
  onSale?(event: SaleEmittedEvent): void;
  onOrderMessage?(message: OrderMessage): void;
}

/**
 * Liga-se ao gateway WebSocket como EQUIPA (handshake `auth.token`) e encaminha
 * os eventos do tenant (`sale.emitted`, `order.message`) para os handlers.
 * Reconecta automaticamente quando o token muda (rotação de sessão).
 */
export function useRealtime(token: string | null, handlers: RealtimeHandlers): boolean {
  const [connected, setConnected] = useState(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!token) {
      setConnected(false);
      return;
    }
    const socket: Socket = io(`${API_URL}${REALTIME_NAMESPACE}`, {
      transports: ['websocket'],
      auth: { token },
      forceNew: true,
    });

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    socket.on('sale.emitted', (e: SaleEmittedEvent) => handlersRef.current.onSale?.(e));
    socket.on('order.message', (m: OrderMessage) => handlersRef.current.onOrderMessage?.(m));

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [token]);

  return connected;
}
