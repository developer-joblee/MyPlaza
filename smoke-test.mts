// Teste de fumaça do servidor: dois clients simulados (removido após o teste)
import { io, type Socket } from 'socket.io-client';

const URL = 'http://localhost:3001';
const results: string[] = [];
const fail = (msg: string): never => {
  console.error('FALHOU:', msg);
  process.exit(1);
};

function wait<T>(desc: string, fn: (resolve: (v: T) => void) => void, ms = 4000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout: ${desc}`)), ms);
    fn((v) => {
      clearTimeout(timer);
      resolve(v);
    });
  });
}

const a: Socket = io(URL);
const b: Socket = io(URL);

try {
  const waitConnect = (s: Socket, desc: string) =>
    s.connected ? Promise.resolve(null) : wait(desc, (done) => s.on('connect', () => done(null)));
  await waitConnect(a, 'conexão A');
  await waitConnect(b, 'conexão B');

  // A entra e recebe snapshot
  const snapA = wait<any[]>('snapshot A', (done) =>
    a.on('world:snapshot', (players: any[]) => done(players)),
  );
  a.emit('join', 'Alice', 0xe63946);
  const playersA = await snapA;
  if (playersA.length !== 1 || playersA[0].name !== 'Alice') fail('snapshot de A inválido');
  results.push('join + snapshot OK');

  // B entra; A deve ver player:joined
  const joinedSeen = wait<any>('A vê B entrar', (done) =>
    a.on('player:joined', (p: any) => done(p)),
  );
  b.emit('join', 'Bob', 0x2a9d8f);
  const bob = await joinedSeen;
  if (bob.name !== 'Bob') fail('broadcast player:joined inválido');
  results.push('broadcast de entrada OK');

  // B se move; A deve receber
  const moved = wait<[string, number, number]>('A vê B mover', (done) =>
    a.on('player:moved', (id: string, x: number, y: number) => done([id, x, y])),
  );
  b.emit('move', 200, 300);
  const [movedId, mx, my] = await moved;
  if (movedId !== b.id || mx !== 200 || my !== 300) fail('player:moved inválido');
  results.push('movimento OK');

  // chat
  const chatSeen = wait<any>('A recebe chat', (done) => a.on('chat:message', (m: any) => done(m)));
  b.emit('chat:send', 'olá equipe!');
  const msg = await chatSeen;
  if (msg.text !== 'olá equipe!' || msg.senderName !== 'Bob') fail('chat inválido');
  results.push('chat OK');

  // sinalização: B -> A com from preenchido pelo servidor
  const sigSeen = wait<any>('A recebe sinal', (done) => a.on('rtc:signal', (p: any) => done(p)));
  b.emit('rtc:signal', { to: a.id, description: { type: 'offer', sdp: 'x' } });
  const sig = await sigSeen;
  if (sig.from !== b.id || sig.description.type !== 'offer') fail('sinalização inválida');
  results.push('sinalização OK');

  // B sai; A deve ver player:left
  const leftSeen = wait<string>('A vê B sair', (done) => a.on('player:left', (id: string) => done(id)));
  b.disconnect();
  const leftId = await leftSeen;
  if (leftId !== bob.id) fail('player:left inválido');
  results.push('saída OK');

  console.log(results.map((r) => '✓ ' + r).join('\n'));
  console.log('SMOKE TEST PASSOU');
  process.exit(0);
} catch (err) {
  fail(String(err));
}
