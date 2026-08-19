import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@together/shared';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Mesmo origin: em dev o Vite faz proxy de /socket.io para o server. */
export function createSocket(): AppSocket {
  return io({
    autoConnect: false,
    // WebSocket primeiro (o default é polling e depois upgrade): evita a janela
    // inicial em polling, que é mais frágil atrás de proxy. Polling fica como
    // fallback para redes que bloqueiam WebSocket.
    transports: ['websocket', 'polling'],
  });
}
