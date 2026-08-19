import type { VoiceTokenResponse } from '@together/shared';
import type { AppSocket } from '../net/socket';

const TOKEN_TIMEOUT_MS = 8000;

/**
 * Pede as credenciais de voz ao servidor pelo socket já conectado.
 * Sem import do livekit-client de propósito: assim este módulo continua
 * utilizável (e fora do chunk do SDK) quando a voz não está configurada.
 */
export function requestVoiceToken(socket: AppSocket): Promise<VoiceTokenResponse> {
  return new Promise((resolve) => {
    socket
      .timeout(TOKEN_TIMEOUT_MS)
      .emit('voice:token', (err: Error | null, res: VoiceTokenResponse) => {
        if (err) {
          console.warn('[voice] pedido de token falhou:', err.message);
          resolve({ ok: false, reason: 'error' });
        } else {
          resolve(res);
        }
      });
  });
}
