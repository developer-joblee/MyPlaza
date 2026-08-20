import type { CharacterId } from './constants';

export interface PlayerState {
  id: string;
  name: string;
  color: number;
  /** qual boneco desenhar; é por aqui que os outros clientes descobrem */
  character: CharacterId;
  x: number;
  y: number;
  /**
   * Está sentado? A **direção** não vem por aqui de propósito: ela sai do tile
   * de cadeira sob o jogador (`sitFacingAt`), que todo cliente já tem, então
   * não há como a pose divergir do cenário. O que precisa vir pela rede é só
   * isto — sem a flag, um remoto interpolando por cima de um tile de cadeira
   * apareceria sentado de relance.
   */
  sitting: boolean;
  /** ausente: sem microfone, sem áudio, e o avatar aparece no celular */
  away: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

/**
 * Resposta do servidor ao pedido de credenciais de voz. O cliente não manda
 * nada no pedido: `identity` e `room` são derivados no servidor a partir do
 * socket, então um cliente não escolhe em que sala entra nem com que identidade.
 */
export type VoiceTokenResponse =
  | { ok: true; url: string; token: string; room: string; identity: string }
  | {
      ok: false;
      /** `socket-down` e `timeout` são do cliente; o servidor nunca os emite */
      reason: 'not-configured' | 'not-joined' | 'rate-limited' | 'error' | 'socket-down' | 'timeout';
      /** quando recusado por limite: quanto esperar, em ms (o cliente não precisa adivinhar) */
      retryAfterMs?: number;
    };
