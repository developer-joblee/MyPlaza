import type { VoiceTokenResponse } from '@together/shared';
import { request } from './request';
import type { AppSocket } from './socket';

/** Folgado: o servidor responde em ms, então um timeout aqui indica socket ruim. */
const TOKEN_TIMEOUT_MS = 15000;

/**
 * Pede as credenciais de voz ao servidor pelo socket já conectado.
 *
 * Sem import do livekit-client de propósito: assim este módulo continua
 * utilizável (e fora do chunk do SDK) quando a voz não está configurada — mora
 * em `net/` junto com as outras requisições, e `net/` não conhece o SDK.
 *
 * A lógica de "socket caído, queda no meio da espera, prazo do ack" que morava
 * aqui virou `net/request.ts` — os motivos `socket-down` e `timeout` do
 * `VoiceTokenResponse` são justamente os que ela devolve.
 */
export function requestVoiceToken(socket: AppSocket): Promise<VoiceTokenResponse> {
  return request<VoiceTokenResponse>(
    socket,
    (s, ack) => s.emit('voice:token', ack),
    (reason) => ({ ok: false, reason }),
    TOKEN_TIMEOUT_MS,
  );
}
