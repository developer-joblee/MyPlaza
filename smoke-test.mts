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
  // compatibilidade: cliente que não manda nada cai na aparência do legado padrão
  const aApp = playersA[0].appearance;
  if (!aApp || typeof aApp.body !== 'string' || typeof aApp.outfit !== 'string') {
    fail(`join sem aparência deveria cair no padrão, veio: ${JSON.stringify(aApp)}`);
  }
  if (playersA[0].sitting !== false) fail('quem entra deveria começar de pé');
  if (playersA[0].away !== false) fail('quem entra deveria começar presente');
  results.push('join + snapshot OK (aparência padrão, de pé, presente)');

  // B entra escolhendo personagem; A deve ver player:joined com a escolha
  const joinedSeen = wait<any>('A vê B entrar', (done) =>
    a.on('player:joined', (p: any) => done(p)),
  );
  // `character` legado no 4º argumento: o servidor traduz para a combinação
  // equivalente do gerador (LEGACY_CHARACTER_APPEARANCE) e propaga a aparência
  b.emit('join', 'Bob', 0x2a9d8f, undefined, 'bob');
  const bob = await joinedSeen;
  if (bob.name !== 'Bob') fail('broadcast player:joined inválido');
  if (bob.appearance?.outfit !== 'outfit_27_01') {
    fail(`personagem legado não virou a aparência mapeada: ${JSON.stringify(bob.appearance)}`);
  }
  results.push('broadcast de entrada OK (aparência do legado propagada)');

  // B se move; A deve receber
  const moved = wait<[string, number, number]>('A vê B mover', (done) =>
    a.on('player:moved', (id: string, x: number, y: number) => done([id, x, y])),
  );
  b.emit('move', 200, 300);
  const [movedId, mx, my] = await moved;
  if (movedId !== b.id || mx !== 200 || my !== 300) fail('player:moved inválido');
  results.push('movimento OK');

  /**
   * Sentar, com as coordenadas do cenário padrão (Estúdio): a cadeira `>` na
   * ponta da mesa de reunião fica no tile (27,3), da linha `#tt>oooo<tt#`. O
   * servidor valida pela posição, então B tem de estar em cima dela antes de
   * pedir. (3,4) é tapete de spawn do lounge: livre e garantidamente
   * não-cadeira.
   */
  const CADEIRA = { x: 27 * 32 + 16, y: 3 * 32 + 16 };
  const naoCadeira = { x: 3 * 32 + 16, y: 4 * 32 + 16 };

  // pedir para sentar longe de cadeira deve ser ignorado
  let satIndevido = false;
  const vigia = (id: string, s: boolean) => {
    if (id === b.id && s) satIndevido = true;
  };
  a.on('player:sat', vigia);
  b.emit('move', naoCadeira.x, naoCadeira.y);
  b.emit('sit', true);
  await new Promise((r) => setTimeout(r, 300));
  if (satIndevido) fail('sentar fora de cadeira deveria ser recusado');
  a.off('player:sat', vigia);
  results.push('sentar fora de cadeira recusado OK');

  // em cima da cadeira, sentar propaga
  const satSeen = wait<[string, boolean]>('A vê B sentar', (done) =>
    a.on('player:sat', (id: string, s: boolean) => done([id, s])),
  );
  b.emit('move', CADEIRA.x, CADEIRA.y);
  b.emit('sit', true);
  const [satId, satVal] = await satSeen;
  if (satId !== b.id || satVal !== true) fail(`player:sat inválido: ${satId} ${satVal}`);
  results.push('sentar na cadeira propaga OK');

  // andar para longe levanta, mesmo sem o cliente avisar
  const upSeen = wait<[string, boolean]>('A vê B levantar ao andar', (done) =>
    a.on('player:sat', (id: string, s: boolean) => done([id, s])),
  );
  b.emit('move', naoCadeira.x, naoCadeira.y);
  const [upId, upVal] = await upSeen;
  if (upId !== b.id || upVal !== false) fail(`levantar ao andar falhou: ${upId} ${upVal}`);
  results.push('andar levanta automaticamente OK');

  // ausente: propaga, e um pedido repetido não retransmite
  const awaySeen = wait<[string, boolean]>('A vê B ficar ausente', (done) =>
    a.on('player:away', (id: string, v: boolean) => done([id, v])),
  );
  b.emit('away', true);
  const [awayId, awayVal] = await awaySeen;
  if (awayId !== b.id || awayVal !== true) fail(`player:away inválido: ${awayId} ${awayVal}`);
  results.push('ficar ausente propaga OK');

  let repetiu = false;
  const vigiaRepeticao = (id: string) => {
    if (id === b.id) repetiu = true;
  };
  a.on('player:away', vigiaRepeticao);
  b.emit('away', true); // mesmo estado: não deve gerar evento
  await new Promise((r) => setTimeout(r, 250));
  if (repetiu) fail('pedido de ausente repetido não deveria retransmitir');
  a.off('player:away', vigiaRepeticao);
  results.push('ausente idempotente OK');

  const backSeen = wait<[string, boolean]>('A vê B voltar', (done) =>
    a.on('player:away', (id: string, v: boolean) => done([id, v])),
  );
  b.emit('away', false);
  const [backId, backVal] = await backSeen;
  if (backId !== b.id || backVal !== false) fail(`voltar de ausente falhou: ${backId} ${backVal}`);
  results.push('voltar de ausente propaga OK');

  // chat
  const chatSeen = wait<any>('A recebe chat', (done) => a.on('chat:message', (m: any) => done(m)));
  b.emit('chat:send', 'olá equipe!');
  const msg = await chatSeen;
  if (msg.text !== 'olá equipe!' || msg.senderName !== 'Bob') fail('chat inválido');
  results.push('chat OK');

  // emote: chega em TODOS do mundo, inclusive o emissor (caminho único de render)
  const emoteSeenA = wait<[string, string]>('A vê emote de B', (done) =>
    a.on('player:emoted', (id: string, e: string) => done([id, e])),
  );
  const emoteSeenB = wait<[string, string]>('B vê o próprio emote', (done) =>
    b.on('player:emoted', (id: string, e: string) => done([id, e])),
  );
  b.emit('player:emote', 'duvida');
  const [emFrom, emId] = await emoteSeenA;
  const [emFromB, emIdB] = await emoteSeenB;
  if (emFrom !== b.id || emId !== 'duvida') fail(`emote não propagou: ${emFrom} ${emId}`);
  if (emFromB !== b.id || emIdB !== 'duvida') fail('emissor não recebeu o próprio emote');
  // cooldown: o segundo imediato é recusado em silêncio; id inválido idem
  let extra = 0;
  const countExtra = () => extra++;
  a.on('player:emoted', countExtra);
  b.emit('player:emote', 'coracao');
  b.emit('player:emote', 'nao-existe');
  await new Promise((r) => setTimeout(r, 400));
  a.off('player:emoted', countExtra);
  if (extra !== 0) fail(`cooldown/validação não seguraram: ${extra} emotes extras`);
  results.push('emote propaga (incl. emissor); cooldown e id inválido calados OK');

  // editor de móveis (modo anônimo: todos podem editar)
  const placedSeenA = wait<any>('A vê móvel colocado', (done) =>
    a.on('furniture:changed', (item: any) => done(item)),
  );
  const placedSeenB = wait<any>('B vê móvel colocado', (done) =>
    b.on('furniture:changed', (item: any) => done(item)),
  );
  const placeAck = wait<any>('ack do place', (done) =>
    b.emit('furniture:place', 'plant_small', 12, 10, 0, (res: any) => done(res)),
  );
  const [placed, placedB, ackRes] = await Promise.all([placedSeenA, placedSeenB, placeAck]);
  if (!ackRes.ok) fail(`place recusado: ${ackRes.reason}`);
  if (placed.furnitureId !== 'plant_small' || placed.tileX !== 12) fail('broadcast do place inválido');
  if (placedB.id !== placed.id) fail('emissor não recebeu o próprio móvel');
  // mover para tile válido; depois tentar EM CIMA de parede (0,0) e ser barrado
  const moveAck = await wait<any>('ack do move', (done) =>
    b.emit('furniture:move', placed.id, 13, 10, 1, (res: any) => done(res)),
  );
  if (!moveAck.ok) fail(`move recusado: ${moveAck.reason}`);
  const blockedAck = await wait<any>('ack do move barrado', (done) =>
    b.emit('furniture:move', placed.id, 0, 0, 0, (res: any) => done(res)),
  );
  if (blockedAck.ok || blockedAck.reason !== 'blocked') {
    fail(`mover para parede deveria ser blocked: ${JSON.stringify(blockedAck)}`);
  }
  // sobreposição: outro móvel no MESMO tile é barrado
  const overlapAck = await wait<any>('ack do overlap', (done) =>
    b.emit('furniture:place', 'globe', 13, 10, 0, (res: any) => done(res)),
  );
  if (overlapAck.ok || overlapAck.reason !== 'blocked') {
    fail(`sobreposição deveria ser blocked: ${JSON.stringify(overlapAck)}`);
  }
  // id de catálogo inválido; e remover de verdade, com broadcast nos dois
  const invalidAck = await wait<any>('ack do id inválido', (done) =>
    b.emit('furniture:place', 'sofa-hackeado', 5, 10, 0, (res: any) => done(res)),
  );
  if (invalidAck.ok || invalidAck.reason !== 'invalid') fail('id inválido deveria ser invalid');
  // v2: rotação fora da faixa é invalid; colocar EM CIMA de uma pessoa é blocked
  const badRotAck = await wait<any>('ack da rotação inválida', (done) =>
    b.emit('furniture:place', 'globe', 5, 10, 99, (res: any) => done(res)),
  );
  if (badRotAck.ok || badRotAck.reason !== 'invalid') fail('rotação 99 deveria ser invalid');
  b.emit('move', 8 * 32 + 16, 10 * 32 + 16); // B fica parado no tile (8,10)
  await new Promise((r) => setTimeout(r, 150));
  const onPlayerAck = await wait<any>('ack do place sobre pessoa', (done) =>
    b.emit('furniture:place', 'sofa_big', 7, 10, 0, (res: any) => done(res)), // cobre (7..9,10)
  );
  if (onPlayerAck.ok || onPlayerAck.reason !== 'blocked') {
    fail(`colocar sobre uma pessoa deveria ser blocked: ${JSON.stringify(onPlayerAck)}`);
  }
  const removedSeenA = wait<string>('A vê remoção', (done) =>
    a.on('furniture:removed', (id: string) => done(id)),
  );
  const removeAck = await wait<any>('ack do remove', (done) =>
    b.emit('furniture:remove', placed.id, (res: any) => done(res)),
  );
  if (!removeAck.ok) fail(`remove recusado: ${removeAck.reason}`);
  if ((await removedSeenA) !== placed.id) fail('broadcast da remoção inválido');
  results.push(
    'móveis: place/move/remove propagam; parede, sobreposição, pessoa, id e rotação inválidos barrados OK',
  );

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
  // personagem legado inválido cai no padrão (a aparência do adam)
  if (dave.appearance?.outfit !== 'outfit_02_01') {
    fail(`personagem inválido deveria cair no padrão, veio: ${JSON.stringify(dave.appearance)}`);
  }
  // e aparência ADULTERADA (6º argumento) também cai no padrão
  const e = io(URL);
  const snapE = wait<any[]>('snapshot E', (done) =>
    e.on('world:snapshot', (players: any[]) => done(players)),
  );
  e.emit('join', 'Eve', 0xe9c46a, undefined, undefined, undefined, {
    body: 'hack', eyes: 1, outfit: null, hair: 'x', accessory: 'y',
  } as any);
  const eve = (await snapE).find((p) => p.name === 'Eve');
  if (!eve) fail('Eve não entrou');
  if (eve.appearance?.body !== 'body_02') {
    fail(`aparência adulterada deveria cair no padrão do legado, veio: ${JSON.stringify(eve.appearance)}`);
  }
  e.disconnect();
  results.push('personagem/aparência inválidos caem no padrão OK');
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
    // a sala da voz é derivada do cenário, que sem parâmetro é o DEFAULT_SCENARIO
    if (!afterJoin.room?.endsWith('-studio')) fail(`sala inesperada: ${afterJoin.room}`);
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
