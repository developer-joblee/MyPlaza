import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@together/shared';
import { currentAccessToken } from '../auth/supabase';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Mesmo origin: em dev o Vite faz proxy de /socket.io para o server. */
export function createSocket(): AppSocket {
  return io({
    autoConnect: false,
    // WebSocket primeiro (o default é polling e depois upgrade): evita a janela
    // inicial em polling, que é mais frágil atrás de proxy. Polling fica como
    // fallback para redes que bloqueiam WebSocket.
    transports: ['websocket', 'polling'],
    /**
     * Identidade da conexão. É FUNÇÃO, e não objeto, de propósito: o Socket.IO
     * reavalia a cada tentativa de conexão, então a reconexão pega o token
     * renovado pelo SDK do Supabase. Com um objeto fixo, uma sessão longa
     * reconectaria com token vencido e o servidor recusaria com `invalid-token`.
     *
     * Sem login configurado o token é null e o servidor cai no modo anônimo.
     */
    auth: (cb: (data: Record<string, unknown>) => void) => {
      void currentAccessToken().then((token) => cb({ token }));
    },
  });
}
