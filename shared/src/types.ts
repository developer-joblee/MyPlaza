export interface PlayerState {
  id: string;
  name: string;
  color: number;
  x: number;
  y: number;
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
  | { ok: false; reason: 'not-configured' | 'not-joined' | 'rate-limited' | 'error' };
