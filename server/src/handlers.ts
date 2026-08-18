import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  CHAT_MAX_LENGTH,
  NAME_MAX_LENGTH,
  type ChatMessage,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@together/shared';
import * as world from './world';

type IoServer = Server<ClientToServerEvents, ServerToClientEvents>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents>;

export function registerHandlers(io: IoServer, socket: IoSocket): void {
  socket.on('join', (rawName, color) => {
    if (world.hasPlayer(socket.id)) return;
    const name = String(rawName).trim().slice(0, NAME_MAX_LENGTH) || 'Anônimo';
    const safeColor = AVATAR_COLORS.includes(color as (typeof AVATAR_COLORS)[number])
      ? color
      : AVATAR_COLORS[0];
    const player = world.addPlayer(socket.id, name, safeColor);
    console.log(`[join] ${name} (${socket.id})`);
    socket.emit('world:snapshot', world.getPlayers(), world.getChatHistory());
    socket.broadcast.emit('player:joined', player);
  });

  socket.on('move', (x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    const player = world.movePlayer(socket.id, x, y);
    if (!player) return;
    socket.broadcast.emit('player:moved', socket.id, player.x, player.y);
  });

  socket.on('chat:send', (rawText) => {
    const player = world.getPlayers().find((p) => p.id === socket.id);
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
    io.emit('chat:message', msg);
  });

  socket.on('rtc:signal', (payload) => {
    if (!payload || typeof payload.to !== 'string') return;
    io.to(payload.to).emit('rtc:signal', { ...payload, from: socket.id });
  });

  socket.on('disconnect', () => {
    if (world.removePlayer(socket.id)) {
      console.log(`[leave] ${socket.id}`);
      socket.broadcast.emit('player:left', socket.id);
    }
  });
}
