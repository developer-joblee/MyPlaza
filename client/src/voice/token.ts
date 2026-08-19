import type { VoiceTokenResponse } from '@together/shared';
import type { AppSocket } from '../net/socket';

/** Folgado: o servidor responde em ms, então um timeout aqui indica socket ruim. */
const TOKEN_TIMEOUT_MS = 15000;

/**
 * Pede as credenciais de voz ao servidor pelo socket já conectado.
 * Sem import do livekit-client de propósito: assim este módulo continua
 * utilizável (e fora do chunk do SDK) quando a voz não está configurada.
 */
export function requestVoiceToken(socket: AppSocket): Promise<VoiceTokenResponse> {
  return new Promise((resolve) => {
    /**
     * Emitir com o socket caído manda o pacote para o `sendBuffer`, e o
     * socket.io **não** limpa o ack de pacotes enfileirados — então o timeout
     * dispara sem o servidor nunca ter visto o pedido. Era exatamente o
     * "operation has timed out" do log de produção.
     */
    if (!socket.connected) {
      resolve({ ok: false, reason: 'socket-down' });
      return;
    }

    let done = false;
    const finish = (res: VoiceTokenResponse) => {
      if (done) return;
      done = true;
      socket.off('disconnect', onDown);
      resolve(res);
    };
    // cair no meio da espera é resposta imediata, não 15s de espera inútil
    const onDown = () => finish({ ok: false, reason: 'socket-down' });
    socket.once('disconnect', onDown);

    socket
      .timeout(TOKEN_TIMEOUT_MS)
      .emit('voice:token', (err: Error | null, res: VoiceTokenResponse) => {
        if (err) {
          console.warn('[voice] pedido de token falhou:', err.message);
          finish({ ok: false, reason: 'timeout' });
        } else {
          finish(res);
        }
      });
  });
}
