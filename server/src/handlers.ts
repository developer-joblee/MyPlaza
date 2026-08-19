import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  CHAT_MAX_LENGTH,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  isCharacterId,
  isScenarioId,
  type ChatMessage,
  type ClientToServerEvents,
  type ScenarioId,
  type ServerToClientEvents,
  type VoiceTokenResponse,
} from '@together/shared';
import { getWorld } from './world';
import { mintVoiceToken, roomNameFor, voiceConfigured } from './voice';

export interface SocketData {
  scenarioId?: ScenarioId;
  /** bucket de tokens concedidos (não conta recusas — ver o handler) */
  tokenAllowance?: number;
  tokenRefilledAt?: number;
  /** último token emitido, para repetir em vez de recusar (ver o handler) */
  tokenCache?: { room: string; res: VoiceTokenResponse; at: number };
  connectedAt?: number;
}

/**
 * Assinar JWT é barato, mas este é o único endpoint de computação sem
 * autenticação, então vale um limite. É um bucket que recarrega com o tempo,
 * em vez de um intervalo mínimo fixo: reconexão legítima precisa de rajada
 * curta (teardown -> token novo, às vezes duas vezes seguidas), e um intervalo
 * fixo punia justamente esse caso.
 */
const TOKEN_BURST = 5;
const TOKEN_REFILL_MS = 3000;
/**
 * Repetir o mesmo token é idempotente: mesma identidade, mesma sala, TTL de 8h.
 * Isso conserta o caso exato que apareceu em produção — o ack do primeiro
 * pedido se perdeu numa reconexão, o cliente repetiu e levou `rate-limited`
 * por um token que já existia. Devolver o mesmo é grátis e não concede nada novo.
 */
const TOKEN_CACHE_TTL_MS = 60000;

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function registerHandlers(io: IoServer, socket: IoSocket): void {
  socket.data.connectedAt = Date.now();

  socket.on('join', (rawName, color, rawScenario, rawCharacter) => {
    if (socket.data.scenarioId !== undefined) return;
    const scenarioId = isScenarioId(rawScenario) ? rawScenario : DEFAULT_SCENARIO;
    const world = getWorld(scenarioId);
    const name = String(rawName).trim().slice(0, NAME_MAX_LENGTH) || 'Anônimo';
    const safeColor = AVATAR_COLORS.includes(color as (typeof AVATAR_COLORS)[number])
      ? color
      : AVATAR_COLORS[0];
    // id desconhecido (cliente antigo ou payload adulterado) cai no padrão
    const character = isCharacterId(rawCharacter) ? rawCharacter : DEFAULT_CHARACTER;
    const player = world.addPlayer(socket.id, name, safeColor, character);
    socket.data.scenarioId = scenarioId;
    socket.join(scenarioId);
    console.log(`[join] ${name} (${socket.id}) -> ${scenarioId} como ${character}`);
    socket.emit('world:snapshot', world.getPlayers(), world.getChatHistory(), scenarioId);
    socket.to(scenarioId).emit('player:joined', player);
  });

  socket.on('move', (x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    const scenarioId = socket.data.scenarioId;
    if (!scenarioId) return;
    const player = getWorld(scenarioId).movePlayer(socket.id, x, y);
    if (!player) return;
    socket.to(scenarioId).emit('player:moved', socket.id, player.x, player.y);
  });

  socket.on('chat:send', (rawText) => {
    const scenarioId = socket.data.scenarioId;
    if (!scenarioId) return;
    const world = getWorld(scenarioId);
    const player = world.getPlayer(socket.id);
    if (!player) return;
    const text = String(rawText).trim().slice(0, CHAT_MAX_LENGTH);
    if (!text) return;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      senderId: socket.id,
      senderName: player.name,
      text,
      timestamp: Date.now(),
    };
    world.addChatMessage(msg);
    io.to(scenarioId).emit('chat:message', msg);
  });

  socket.on('voice:token', async (ack) => {
    if (typeof ack !== 'function') return;
    if (!voiceConfigured) return ack({ ok: false, reason: 'not-configured' });

    const scenarioId = socket.data.scenarioId;
    if (!scenarioId) return ack({ ok: false, reason: 'not-joined' });

    const now = Date.now();
    const room = roomNameFor(scenarioId);

    // IDEMPOTÊNCIA ANTES DE QUALQUER LIMITE: se já emitimos um token válido para
    // esta sala, repetir é a resposta certa. Era aqui que a produção quebrava.
    const cached = socket.data.tokenCache;
    if (cached && cached.room === room && now - cached.at < TOKEN_CACHE_TTL_MS) {
      console.log(`[voice] token repetido (cache) -> ${socket.id} (${room})`);
      return ack(cached.res);
    }

    // recarrega o bucket pelo tempo decorrido; só concessões consomem crédito,
    // então uma rajada de retentativas recusadas não esgota o socket para sempre
    const since = now - (socket.data.tokenRefilledAt ?? now);
    const allowance = Math.min(
      TOKEN_BURST,
      (socket.data.tokenAllowance ?? TOKEN_BURST) + since / TOKEN_REFILL_MS,
    );
    socket.data.tokenRefilledAt = now;
    if (allowance < 1) {
      socket.data.tokenAllowance = allowance;
      const retryAfterMs = Math.ceil((1 - allowance) * TOKEN_REFILL_MS);
      console.log(`[voice] token recusado (limite) -> ${socket.id} espere=${retryAfterMs}ms`);
      return ack({ ok: false, reason: 'rate-limited', retryAfterMs });
    }
    socket.data.tokenAllowance = allowance - 1;

    try {
      const name = getWorld(scenarioId).getPlayer(socket.id)?.name ?? 'Anônimo';
      const { url, token } = await mintVoiceToken(socket.id, name, scenarioId);
      const res: VoiceTokenResponse = { ok: true, url, token, room, identity: socket.id };
      socket.data.tokenCache = { room, res, at: Date.now() };
      console.log(`[voice] token emitido -> ${socket.id} (${room})`); // sem o token, sem a secret
      ack(res);
    } catch (err) {
      console.error('[voice] falha ao emitir token:', err);
      // erro nosso não deve consumir o orçamento do cliente
      socket.data.tokenAllowance = Math.min(TOKEN_BURST, (socket.data.tokenAllowance ?? 0) + 1);
      ack({ ok: false, reason: 'error' });
    }
  });

  socket.on('disconnect', (reason) => {
    /**
     * O `reason` é o que diferencia as causas de queda, e sem ele os logs não
     * dizem nada: `ping timeout` aponta para aba congelada em segundo plano ou
     * rede travada; `transport close`/`transport error` para queda de rede;
     * `client namespace disconnect` para saída intencional (nosso botão). Se
     * vários sockets caírem no mesmo segundo, foi reinício do contêiner.
     */
    const secs = Math.round((Date.now() - (socket.data.connectedAt ?? Date.now())) / 1000);
    const transport = socket.conn.transport.name;
    const scenarioId = socket.data.scenarioId;
    console.log(
      `[disconnect] ${socket.id} motivo="${reason}" transporte=${transport} sessao=${secs}s` +
        (scenarioId ? ` cenario=${scenarioId}` : ' (sem join)'),
    );
    if (!scenarioId) return;
    if (getWorld(scenarioId).removePlayer(socket.id)) {
      socket.to(scenarioId).emit('player:left', socket.id);
    }
  });
}
