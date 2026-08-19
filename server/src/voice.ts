import { AccessToken } from 'livekit-server-sdk';
import type { ScenarioId } from '@together/shared';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;

/**
 * Prefixo do nome da sala. Dev e produção normalmente compartilham o mesmo
 * projeto LiveKit; sem prefixos diferentes os dois cairiam na MESMA sala —
 * gente de dev e de produção se ouvindo, invisíveis nos mundos uma da outra
 * (e queimando cota de produção). Defina LIVEKIT_ROOM_PREFIX=dev no .env local.
 */
const ROOM_PREFIX = process.env.LIVEKIT_ROOM_PREFIX ?? 'together';

/** Token vale mais que a sessão típica: se expirar, um reconnect completo do SDK falha. */
const TOKEN_TTL = '8h';

export const voiceConfigured = Boolean(LIVEKIT_URL && API_KEY && API_SECRET);

// log único no boot — nunca a key nem a secret
console.log(
  voiceConfigured
    ? `[voice] LiveKit configurado (${LIVEKIT_URL}, salas "${ROOM_PREFIX}-*")`
    : '[voice] LIVEKIT_URL/API_KEY/API_SECRET ausentes — voz desativada (o resto do app funciona)',
);

export function roomNameFor(scenarioId: ScenarioId): string {
  return `${ROOM_PREFIX}-${scenarioId}`;
}

export async function mintVoiceToken(
  identity: string,
  name: string,
  scenarioId: ScenarioId,
): Promise<{ url: string; token: string; room: string }> {
  const room = roomNameFor(scenarioId);
  const at = new AccessToken(API_KEY!, API_SECRET!, { identity, name, ttl: TOKEN_TTL });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    // dados e metadados trafegam pelo Socket.IO, não pelo LiveKit
    canPublishData: false,
    canUpdateOwnMetadata: false,
  });
  return { url: LIVEKIT_URL!, token: await at.toJwt(), room };
}
