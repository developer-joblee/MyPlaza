import { AccessToken } from 'livekit-server-sdk';

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

/**
 * Nome da sala no LiveKit, a partir da chave do MUNDO — não do cenário.
 *
 * Isto é isolamento de verdade, não cosmético: enquanto a sala era
 * `together-studio`, duas empresas usando o Estúdio caíam na MESMA sala de voz
 * e se ouviam, invisíveis nos mundos uma da outra. Com a chave do local
 * (`places.id`), cada uma tem a sua.
 *
 * Sanitiza porque o nome da sala vai para a URL do LiveKit; uuid e a chave
 * sintética já passam limpos, mas um slug novo qualquer não necessariamente.
 */
export function roomNameFor(worldKey: string): string {
  return `${ROOM_PREFIX}-${worldKey.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

export async function mintVoiceToken(
  identity: string,
  name: string,
  worldKey: string,
): Promise<{ url: string; token: string; room: string }> {
  const room = roomNameFor(worldKey);
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
