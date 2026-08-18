import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  SERVER_PORT,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@together/shared';
import { registerHandlers, type SocketData } from './handlers';

const httpServer = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('toGether signaling server');
});

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

httpServer.listen(SERVER_PORT, () => {
  console.log(`toGether server ouvindo em http://localhost:${SERVER_PORT}`);
});
