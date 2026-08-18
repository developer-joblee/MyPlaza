import { createServer } from 'node:http';
import { existsSync, createReadStream, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';
import {
  SERVER_PORT,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@together/shared';
import { registerHandlers, type SocketData } from './handlers';

const PORT = Number(process.env.PORT) || SERVER_PORT;

// build do client (produção: um serviço só serve tudo)
const CLIENT_DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
const hasClientBuild = existsSync(join(CLIENT_DIST, 'index.html'));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const httpServer = createServer((req, res) => {
  if (!hasClientBuild) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('toGether signaling server (client em modo dev via Vite)');
    return;
  }

  const url = (req.url ?? '/').split('?')[0];
  // normaliza e bloqueia path traversal
  const safePath = normalize(url).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(CLIENT_DIST, safePath);
  if (!filePath.startsWith(CLIENT_DIST)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(CLIENT_DIST, 'index.html'); // SPA fallback
  }

  const ext = extname(filePath).toLowerCase();
  const immutable = safePath.startsWith('/assets/') || safePath.startsWith('\\assets\\');
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  createReadStream(filePath).pipe(res);
});

const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket) => {
  registerHandlers(io, socket);
});

httpServer.listen(PORT, () => {
  console.log(
    `toGether server ouvindo em http://localhost:${PORT}` +
      (hasClientBuild ? ' (servindo client/dist)' : ''),
  );
});
