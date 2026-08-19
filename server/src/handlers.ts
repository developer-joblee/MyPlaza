import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  CHAT_MAX_LENGTH,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  isScenarioId,
  type ChatMessage,
  type ClientToServerEvents,
  type ScenarioId,
  type ServerToClientEvents,
} from '@together/shared';
import { getWorld } from './world';
import { mintVoiceToken, voiceConfigured } from './voice';

export interface SocketData {
  scenarioId?: ScenarioId;
  lastTokenAt?: number;
  tokenCount?: number;
}

/** Assinar JWT é barato, mas este é o único endpoint de computação sem autenticação. */
const TOKEN_MIN_INTERVAL_MS = 1000;
const TOKEN_MAX_PER_SOCKET = 30;

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

export function registerHandlers(io: IoServer, socket: IoSocket): void {
  socket.on('join', (rawName, color, rawScenario) => {
    if (socket.data.scenarioId !== undefined) return;
    const scenarioId = isScenarioId(rawScenario) ? rawScenario : DEFAULT_SCENARIO;
    const world = getWorld(scenarioId);
    const name = String(rawName).trim().slice(0, NAME_MAX_LENGTH) || 'Anônimo';
    const safeColor = AVATAR_COLORS.includes(color as (typeof AVATAR_COLORS)[number])
      ? color
      : AVATAR_COLORS[0];
    const player = world.addPlayer(socket.id, name, safeColor);
    socket.data.scenarioId = scenarioId;
    socket.join(scenarioId);
    console.log(`[join] ${name} (${socket.id}) -> ${scenarioId}`);
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
    socket.data.tokenCount = (socket.data.tokenCount ?? 0) + 1;
    if (
      now - (socket.data.lastTokenAt ?? 0) < TOKEN_MIN_INTERVAL_MS ||
      socket.data.tokenCount > TOKEN_MAX_PER_SOCKET
    ) {
      return ack({ ok: false, reason: 'rate-limited' });
    }
    socket.data.lastTokenAt = now;

    try {
      const name = getWorld(scenarioId).getPlayer(socket.id)?.name ?? 'Anônimo';
      const { url, token, room } = await mintVoiceToken(socket.id, name, scenarioId);
      console.log(`[voice] token -> ${socket.id} (${room})`); // sem o token, sem a secret
      ack({ ok: true, url, token, room, identity: socket.id });
    } catch (err) {
      console.error('[voice] falha ao emitir token:', err);
      ack({ ok: false, reason: 'error' });
    }
  });

  socket.on('disconnect', () => {
    const scenarioId = socket.data.scenarioId;
    if (!scenarioId) return;
    if (getWorld(scenarioId).removePlayer(socket.id)) {
      console.log(`[leave] ${socket.id} (${scenarioId})`);
      socket.to(scenarioId).emit('player:left', socket.id);
    }
  });
}
