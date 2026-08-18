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

export interface SocketData {
  scenarioId?: ScenarioId;
}

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

  socket.on('rtc:signal', (payload) => {
    if (!payload || typeof payload.to !== 'string') return;
    const scenarioId = socket.data.scenarioId;
    if (!scenarioId || !getWorld(scenarioId).hasPlayer(payload.to)) return;
    io.to(payload.to).emit('rtc:signal', { ...payload, from: socket.id });
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
