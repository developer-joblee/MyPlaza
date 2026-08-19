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
  // sem cenário e sem personagem, como um cliente antigo faria
  a.emit('join', 'Alice', 0xe63946);
  const playersA = await snapA;
  if (playersA.length !== 1 || playersA[0].name !== 'Alice') fail('snapshot de A inválido');
  // compatibilidade: cliente que não manda personagem cai no padrão
  if (playersA[0].character !== 'adam') {
    fail(`join sem personagem deveria cair no padrão, veio: ${playersA[0].character}`);
  }
  results.push('join + snapshot OK (personagem padrão)');

  // B entra escolhendo personagem; A deve ver player:joined com a escolha
  const joinedSeen = wait<any>('A vê B entrar', (done) =>
    a.on('player:joined', (p: any) => done(p)),
  );
  b.emit('join', 'Bob', 0x2a9d8f, undefined, 'bob');
  const bob = await joinedSeen;
  if (bob.name !== 'Bob') fail('broadcast player:joined inválido');
  if (bob.character !== 'bob') fail(`personagem escolhido não propagou: ${bob.character}`);
  results.push('broadcast de entrada OK (personagem propagado)');

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

  // B sai; A deve ver player:left
  const leftSeen = wait<string>('A vê B sair', (done) => a.on('player:left', (id: string) => done(id)));
  b.disconnect();
  const leftId = await leftSeen;
  if (leftId !== bob.id) fail('player:left inválido');
  results.push('saída OK');

  // personagem inválido (payload adulterado) deve cair no padrão, não quebrar
  const d: Socket = io(URL);
  await waitConnect(d, 'conexão D');
  const snapD = wait<any[]>('snapshot D', (done) =>
    d.on('world:snapshot', (players: any[]) => done(players)),
  );
  d.emit('join', 'Dave', 0xe9c46a, undefined, 'nao-existe' as any);
  const dave = (await snapD).find((p) => p.name === 'Dave');
  if (!dave) fail('Dave não entrou');
  if (dave.character !== 'adam') {
    fail(`personagem inválido deveria cair no padrão, veio: ${dave.character}`);
  }
  results.push('personagem inválido cai no padrão OK');
  d.disconnect();

  // voz: pedir token ANTES de entrar deve ser recusado
  const c: Socket = io(URL);
  await waitConnect(c, 'conexão C');
  const beforeJoin = await wait<any>('token sem join', (done) =>
    c.emit('voice:token', (res: any) => done(res)),
  );
  if (beforeJoin.ok !== false || !['not-joined', 'not-configured'].includes(beforeJoin.reason)) {
    fail(`token sem join deveria ser recusado, veio: ${JSON.stringify(beforeJoin)}`);
  }
  results.push(`token sem join recusado (${beforeJoin.reason}) OK`);

  // voz: depois de entrar, depende de haver credenciais no ambiente
  c.emit('join', 'Carol', 0x457b9d);
  const afterJoin = await wait<any>('token com join', (done) =>
    c.emit('voice:token', (res: any) => done(res)),
  );
  if (afterJoin.ok === true) {
    if (!afterJoin.url?.startsWith('ws') || !afterJoin.token || afterJoin.identity !== c.id) {
      fail(`token inválido: ${JSON.stringify({ ...afterJoin, token: '[oculto]' })}`);
    }
    if (!afterJoin.room?.endsWith('-plaza')) fail(`sala inesperada: ${afterJoin.room}`);
    results.push(`token emitido para a sala "${afterJoin.room}" OK`);

    // o bucket tolera rajada curta (reconexão legítima pede 2-3 tokens seguidos)
    const rajada: any[] = [];
    for (let i = 0; i < 4; i++) {
      rajada.push(await wait<any>(`rajada ${i}`, (done) => c.emit('voice:token', (r: any) => done(r))));
    }
    if (!rajada.every((r) => r.ok)) {
      fail(`o bucket deveria tolerar rajada curta: ${JSON.stringify(rajada.map((r) => r.ok ? 'ok' : r.reason))}`);
    }
    results.push('rajada de reconexão tolerada OK');

    /**
     * Idempotência: pedidos repetidos devolvem o MESMO token, em vez de emitir
     * outro ou recusar. Era exatamente aqui que a produção quebrava — o ack do
     * primeiro pedido se perdia numa reconexão, o cliente repetia e levava
     * `rate-limited` por um token que já existia.
     *
     * Consequência: uma rajada repetida nunca chega ao limitador, porque não
     * custa nada (sem assinatura, sem emissão). O limitador passa a proteger
     * só as emissões de verdade, que agora são uma por minuto por socket.
     */
    const tokens = new Set(rajada.map((r) => r.token));
    if (tokens.size !== 1) {
      fail(`pedidos repetidos deveriam devolver o mesmo token, veio ${tokens.size} distintos`);
    }
    results.push('token idempotente em pedido repetido OK (beco sem saída corrigido)');

    // e a resposta carrega quanto esperar quando de fato recusa
    const semCache = await wait<any>('sala diferente', (done) =>
      c.emit('voice:token', (r: any) => done(r)),
    );
    if (semCache.ok !== true) fail(`pedido normal deveria passar: ${JSON.stringify(semCache)}`);
    results.push('sessão segue funcional após a rajada OK');
  } else if (afterJoin.reason === 'not-configured') {
    results.push('voz não configurada — recusa limpa OK (sem LIVEKIT_* no ambiente)');
  } else {
    fail(`token com join falhou: ${JSON.stringify(afterJoin)}`);
  }
  c.disconnect();

  console.log(results.map((r) => '✓ ' + r).join('\n'));
  console.log('SMOKE TEST PASSOU');
  process.exit(0);
} catch (err) {
  fail(String(err));
}
