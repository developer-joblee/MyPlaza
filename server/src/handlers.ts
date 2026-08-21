import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  CALL_COOLDOWN_MS,
  CHAT_MAX_LENGTH,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  NUDGE_COOLDOWN_MS,
  PRESENCE_CREDIT_MS,
  POSITION_SAVE_MS,
  isCharacterId,
  isScenarioId,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinDeniedReason,
  type PlayerState,
  type ScenarioId,
  type ServerToClientEvents,
  type VoiceTokenResponse,
} from '@together/shared';
import { getWorld, scenarioWorldKey, type ResumePosition } from './world';
import { mintVoiceToken, roomNameFor, voiceConfigured } from './voice';
import { authRequired, verifyAccessToken } from './auth';
import { dbConfigured } from './supabase';
import {
  closeScreenShare,
  closeSession,
  closeZoneVisit,
  findMembership,
  findOrCreateProfile,
  getPlaceById,
  isPlaceMember,
  loadChatHistory,
  loadPosition,
  openScreenShare,
  openSession,
  openZoneVisit,
  recordTokenGrant,
  resolveAudioZoneId,
  savePosition,
  addPresenceSeconds,
  saveChatMessage,
  touchSession,
} from './db';

export interface SocketData {
  scenarioId?: ScenarioId;
  /**
   * Chave do mundo em que este socket está: `places.id` com banco, sintética
   * sem banco. É também o nome da sala do Socket.IO e a base do nome da sala do
   * LiveKit — ou seja, o que isola uma empresa da outra.
   */
  worldKey?: string;
  /** id da conta no Supabase Auth, verificado no join */
  authUserId?: string;
  /** o `join` é assíncrono agora (espera o banco); trava contra join duplo */
  joining?: boolean;
  /** identidade estável entre reconexões; ausente = sessão sem persistência */
  profileId?: string;
  /** local (uuid) correspondente ao cenário; null = banco indisponível */
  placeId?: string | null;
  sessionId?: string | null;
  /** última gravação de posição, para respeitar POSITION_SAVE_MS */
  positionSavedAt?: number;
  /** zona de áudio atual (chave do shared) — `null` é área aberta */
  zoneKey?: string | null;
  /**
   * Fila da visita de sala: resolve para o id da visita ABERTA, ou null.
   * É uma corrente de promessas, e não um id solto, porque abrir a visita é
   * assíncrono e alguém andando rápido troca de sala antes de a anterior ter
   * gravado — sem serializar, sobrariam visitas nunca fechadas.
   */
  zoneVisit?: Promise<string | null>;
  sharing?: boolean;
  /**
   * Quando este socket chamou cada alvo, para impor `NUDGE_COOLDOWN_MS`. Vive
   * no socket (e não num mapa global) porque cai junto com a conexão, e é podado
   * a cada chamado — então não guarda mais que os alvos da última janela.
   */
  nudgedAt?: Map<string, number>;
  /**
   * Mesma ideia do `nudgedAt`, para o chamado pelo menu de contexto
   * (`CALL_COOLDOWN_MS`). É um mapa **separado** de propósito: chamar quem está
   * ausente e chamar quem está presente são dois canais com regras diferentes, e
   * compartilhar a janela faria um limitar o outro sem nenhuma razão.
   */
  calledAt?: Map<string, number>;
  /** mesma corrente, para o compartilhamento de tela */
  shareRecord?: Promise<string | null>;
  /**
   * Timer que credita presença (`PRESENCE_CREDIT_MS`) e o instante do último
   * crédito. Vivem no socket, e não num mapa global, porque morrem com a
   * conexão: um timer sobrevivente creditaria tempo de quem já saiu.
   */
  creditTimer?: NodeJS.Timeout;
  creditedAt?: number;
  /** último som tocado por este socket, para impor `SOUND_COOLDOWN_MS` */
  soundAt?: number;
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

  socket.on('join', async (rawName, color, rawScenario, rawCharacter, rawWorldId) => {
    // `joining` além de `worldKey`: entre o pedido e o `addPlayer` há awaits de
    // rede, e sem a trava dois `join` seguidos criariam dois players
    if (socket.data.worldKey !== undefined || socket.data.joining) return;
    socket.data.joining = true;

    const deny = (reason: JoinDeniedReason): void => {
      console.log(`[join] recusado ${socket.id}: ${reason}`);
      socket.emit('join:denied', reason);
    };

    try {
      // aposta do cliente sobre o mapa; com login, quem manda é o mundo (abaixo)
      let scenarioId = isScenarioId(rawScenario) ? rawScenario : DEFAULT_SCENARIO;
      const name = String(rawName).trim().slice(0, NAME_MAX_LENGTH) || 'Anônimo';
      const safeColor = AVATAR_COLORS.includes(color as (typeof AVATAR_COLORS)[number])
        ? color
        : AVATAR_COLORS[0];
      // id desconhecido (cliente antigo ou payload adulterado) cai no padrão
      const character = isCharacterId(rawCharacter) ? rawCharacter : DEFAULT_CHARACTER;

      /**
       * O portão. Cada passo pode recusar, e recusar é o default: qualquer
       * `null` no caminho vira `join:denied`, nunca "entra sem verificar".
       *
       * Sem Supabase configurado não há como verificar nada, então o modo
       * anônimo de antes continua: um mundo por cenário, sem persistência.
       */
      let worldKey = scenarioWorldKey(scenarioId);
      let placeId: string | null = null;
      let profileId: string | undefined;
      let resume: ResumePosition | null = null;

      if (authRequired) {
        // 1. quem é você — a identidade sai do token, nunca do payload
        const token = String(socket.handshake.auth?.token ?? '');
        if (!token) return deny('auth-required');
        const authUser = await verifyAccessToken(token);
        if (!authUser) return deny('invalid-token');

        // 2. o perfil desta conta
        const profile = await findOrCreateProfile(authUser.id, name, safeColor, character);
        if (!profile) return deny('error');

        // 3. o mundo — escolhido no lobby, nunca derivado do cenário. Derivar
        // do cenário dentro de uma empresa fixa era o modelo de antes do lobby;
        // com mundos criados por gente, o mesmo cenário existe muitas vezes.
        const worldId = String(rawWorldId ?? '');
        if (!worldId) return deny('no-world');
        const place = await getPlaceById(worldId);
        // arquivado é indistinguível de inexistente para quem tenta entrar
        if (!place || place.archivedAt) return deny('no-place');
        // o MAPA vem do mundo, não do pedido: senão dava para entrar num mundo
        // do Estúdio carregando a colisão da Praça
        scenarioId = place.scenarioId;

        /**
         * 4. acesso à empresa — só confere, não concede.
         *
         * Antes, quem não tinha membership tinha aqui o convite pendente do seu
         * e-mail aceito **automaticamente**. Isso saiu junto com a confirmação
         * de e-mail: sem verificar o endereço, quem se cadastrasse com o e-mail
         * de outra pessoa herdaria o convite dela — era a verificação de e-mail
         * que sustentava esse mecanismo. Hoje quem concede acesso é quem
         * administra o mundo, pelo ID da pessoa (`lobby:addMember`).
         */
        const membership = await findMembership(place.organizationId, profile);
        if (!membership) return deny('no-invite');
        if (membership.status !== 'active') return deny('no-membership');

        // 5. mundo restrito: precisa estar na lista — ou ser quem o criou.
        // O dono passa sem consulta extra (`created_by` já veio) e sem depender
        // de continuar em `place_members`, de onde ele poderia ter saído.
        if (
          place.visibility === 'restricted' &&
          place.createdBy !== profile &&
          !(await isPlaceMember(place.id, profile))
        ) {
          return deny('place-restricted');
        }

        // 6. lotação. Conta em memória, e é a contagem certa: sessão aberta no
        // banco erraria para mais em toda queda que não fechou a linha.
        if (place.capacity !== null && getWorld(place.id, scenarioId).size >= place.capacity) {
          return deny('place-full');
        }

        worldKey = place.id;
        placeId = place.id;
        profileId = profile;
        socket.data.authUserId = authUser.id;
      }

      const world = getWorld(worldKey, scenarioId);

      if (placeId && profileId) {
        resume = await loadPosition(placeId, profileId);
        // histórico do chat: uma vez por mundo, no primeiro join após o boot
        if (!world.isChatHydrated) world.hydrateChat(await loadChatHistory(placeId));
      }

      // caiu enquanto esperávamos a rede: não adiciona ninguém ao mundo, senão
      // fica um player fantasma (o handler de disconnect já rodou e não achou nada)
      if (socket.disconnected) return;

      const player = world.addPlayer(socket.id, name, safeColor, character, resume);
      socket.data.scenarioId = scenarioId;
      socket.data.worldKey = worldKey;
      socket.data.profileId = profileId;
      socket.data.placeId = placeId;
      socket.join(worldKey);
      console.log(
        `[join] ${name} (${socket.id}) -> ${scenarioId} como ${character}` +
          ` mundo=${worldKey}` +
          (resume ? ' (posição restaurada)' : '') +
          (authRequired ? '' : ' (anônimo: sem Supabase)'),
      );
      socket.emit('world:snapshot', world.getPlayers(), world.getChatHistory(), scenarioId);
      socket.to(worldKey).emit('player:joined', player);

      /**
       * Grava o vínculo (nome, cor, personagem e posição) AGORA, e não no
       * primeiro passo: quem entra e fecha a aba em seguida sem andar teria
       * saído sem vínculo nenhum, e o mundo pediria o nome de novo na próxima
       * vez — exatamente o que esta feature existe para não fazer. É a mesma
       * escrita forçada de sentar/ausentar-se, então não há caminho novo.
       */
      persistPosition(true);

      // abre a sessão depois de já estar no mundo: é histórico, ninguém espera por ela
      if (placeId && profileId) {
        const userAgent = String(socket.handshake.headers['user-agent'] ?? '').slice(0, 300) || null;
        startPresenceCredit();
        void openSession(placeId, profileId, socket.id, character, userAgent).then((id) => {
          socket.data.sessionId = id;
          // quem nasceu (ou foi restaurado) dentro de uma sala já conta como
          // dentro dela; sem isto a visita só começaria no primeiro passo
          trackZone();
        });
      }
    } finally {
      socket.data.joining = false;
    }
  });

  /**
   * Começa a creditar tempo de presença em fatias de `PRESENCE_CREDIT_MS`.
   *
   * É o que alimenta a progressão do soundboard, e é creditado em fatias em vez
   * de calculado somando `sessions` na leitura por uma razão concreta: sessão
   * que morre junto com o processo fica com `left_at is null` para sempre, e
   * `coalesce(left_at, now())` — o que a view `v_place_activity` faz — passaria
   * a contar dias de alguém que saiu. Em fatias, uma queda custa no máximo uma
   * fatia.
   *
   * O timer é `unref`ado para não segurar o processo vivo no shutdown: crédito
   * de presença não é motivo para o Node não morrer.
   */
  function startPresenceCredit(): void {
    if (socket.data.creditTimer) return;
    socket.data.creditedAt = Date.now();
    socket.data.creditTimer = setInterval(() => creditPresence(), PRESENCE_CREDIT_MS);
    socket.data.creditTimer.unref?.();
  }

  /**
   * Credita o tempo decorrido desde o último crédito e reinicia a contagem.
   *
   * Mede pelo relógio em vez de assumir que passou exatamente uma fatia porque
   * `setInterval` atrasa (event loop ocupado, processo suspenso) — e porque a
   * chamada final no `disconnect` credita um pedaço de fatia, não uma inteira.
   */
  function creditPresence(): void {
    const profileId = socket.data.profileId;
    const since = socket.data.creditedAt;
    if (!profileId || !since) return;
    const elapsed = Math.floor((Date.now() - since) / 1000);
    socket.data.creditedAt = Date.now();
    if (elapsed <= 0) return;
    void addPresenceSeconds(profileId, elapsed);
  }

  function stopPresenceCredit(): void {
    if (socket.data.creditTimer) {
      clearInterval(socket.data.creditTimer);
      socket.data.creditTimer = undefined;
    }
    // credita o pedaço final: quem ficou 3min e saiu merece os 3min, não 2
    creditPresence();
    socket.data.creditedAt = undefined;
  }

  /**
   * Grava a posição atual, no máximo uma vez a cada POSITION_SAVE_MS. `force`
   * ignora o intervalo — usado quando o estado muda de verdade (sentar,
   * ausentar-se, sair), onde perder a última alteração é justamente o que não
   * pode acontecer.
   */
  function persistPosition(force = false): void {
    const { placeId, profileId, scenarioId, worldKey } = socket.data;
    if (!placeId || !profileId || !scenarioId || !worldKey) return;
    const now = Date.now();
    if (!force && now - (socket.data.positionSavedAt ?? 0) < POSITION_SAVE_MS) return;
    const player = getWorld(worldKey, scenarioId).getPlayer(socket.id);
    if (!player) return;
    socket.data.positionSavedAt = now;
    void savePosition(placeId, profileId, {
      x: player.x,
      y: player.y,
      sitting: player.sitting,
      away: player.away,
      character: player.character,
      // o VÍNCULO com este mundo: como a pessoa se chama aqui. Vai na mesma
      // escrita da posição de propósito — é a mesma linha de `presence_state`,
      // então guardar o nome não custa consulta nem tabela nova (ver 0009).
      name: player.name,
      color: player.color,
    });
    // `sessions.last_seen_at` só nas gravações forçadas: o heartbeat de verdade
    // é `presence_state.updated_at`, que acabou de ser escrito acima. Tocar a
    // sessão a cada 3s dobraria a escrita para guardar a mesma informação — e
    // `closeSession` grava o valor final na saída, que é quando ele importa.
    const sessionId = socket.data.sessionId;
    if (force && sessionId) void touchSession(sessionId);
  }

  /**
   * Reconcilia a sala em que a pessoa está com o que o banco tem aberto.
   *
   * Chamado a cada movimento; sai na hora quando a sala não mudou, que é o caso
   * de 99% dos ticks. Só troca de sala custa escrita — e a corrente
   * `zoneVisit` garante que a visita anterior feche antes de a próxima abrir,
   * mesmo em quem atravessa a copa correndo.
   */
  function trackZone(): void {
    const { placeId, profileId, scenarioId, sessionId, worldKey } = socket.data;
    if (!placeId || !profileId || !scenarioId || !sessionId || !worldKey) return;
    const world = getWorld(worldKey, scenarioId);
    const player = world.getPlayer(socket.id);
    if (!player) return;
    const key = world.zoneKeyAt(player.x, player.y);
    if (key === (socket.data.zoneKey ?? null)) return;
    socket.data.zoneKey = key;
    const previous = socket.data.zoneVisit ?? Promise.resolve(null);
    socket.data.zoneVisit = previous.then(async (openVisitId) => {
      if (openVisitId) await closeZoneVisit(openVisitId);
      if (!key) return null;
      const zoneId = await resolveAudioZoneId(scenarioId, key);
      return zoneId ? await openZoneVisit(sessionId, zoneId) : null;
    });
  }

  /**
   * Trilha de auditoria da emissão de token de voz — hoje isso só existia como
   * `console.log`, que morre no restart do contêiner.
   *
   * Não registra recusa por limite de taxa de propósito: recusa é barata para
   * quem tenta e viraria amplificação de escrita. E **nunca** grava o JWT.
   */
  function auditTokenGrant(room: string, outcome: 'granted' | 'cached' | 'error'): void {
    if (!socket.data.placeId) return; // sem persistência configurada
    void recordTokenGrant({
      sessionId: socket.data.sessionId ?? null,
      profileId: socket.data.profileId ?? null,
      socketId: socket.id,
      room,
      outcome,
    });
  }

  /**
   * Difunde uma mudança de booble para o mundo INTEIRO, incluindo quem a causou.
   *
   * Incluir o autor (`io.to`, e não `socket.to`) é de propósito: o id da booble
   * é cunhado aqui, então não existe atualização otimista possível no cliente —
   * ele *precisa* do broadcast para saber em que booble entrou. De quebra, isso
   * elimina a classe de bug em que o autor e o resto do mundo discordam.
   *
   * Lista vazia não emite nada: é o mesmo contrato do `if (!player) return` dos
   * outros handlers, só que a mudança pode envolver mais de uma pessoa.
   */
  function broadcastBooble(worldKey: string, changed: PlayerState[]): void {
    for (const p of changed) io.to(worldKey).emit('player:booble', p.id, p.boobleId);
  }

  /** Fecha o que ficou aberto nas correntes de atividade (saída da sessão). */
  function closeActivity(): void {
    const zoneVisit = socket.data.zoneVisit;
    if (zoneVisit) void zoneVisit.then((id) => (id ? closeZoneVisit(id) : undefined));
    const shareRecord = socket.data.shareRecord;
    if (shareRecord) void shareRecord.then((id) => (id ? closeScreenShare(id) : undefined));
  }

  socket.on('move', (x, y) => {
    if (typeof x !== 'number' || typeof y !== 'number' || !isFinite(x) || !isFinite(y)) return;
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const world = getWorld(worldKey, scenarioId);
    const wasSitting = world.getPlayer(socket.id)?.sitting;
    const player = world.movePlayer(socket.id, x, y);
    if (!player) return;
    socket.to(worldKey).emit('player:moved', socket.id, player.x, player.y);
    // movePlayer levanta quem saiu da cadeira; os outros precisam saber
    if (wasSitting && !player.sitting) {
      socket.to(worldKey).emit('player:sat', socket.id, false);
    }
    /**
     * A booble quebra por distância, e é aqui que isso é imposto — não no
     * cliente. Sai na hora quando a pessoa não está em booble nenhuma, que é o
     * caso de quase todo tick; quando está, é uma comparação por membro (no
     * máximo `BOOBLE_MAX_MEMBERS`).
     */
    broadcastBooble(worldKey, world.evictFarBooble(socket.id));
    // 15 msgs/s entram aqui; cada um decide sozinho se vale uma escrita
    persistPosition(wasSitting === true && !player.sitting);
    trackZone();
  });

  socket.on('away', (away) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const world = getWorld(worldKey, scenarioId);
    const player = world.setAway(socket.id, away === true);
    if (!player) return; // já estava assim
    socket.to(worldKey).emit('player:away', socket.id, player.away);
    /**
     * Ficar ausente **sai da booble**. Ausente corta microfone e áudio no
     * cliente (`VoiceRoom.applySilence`), então continuar membro seria segurar
     * uma vaga sendo inaudível — e pior: quem está numa booble parece disponível
     * para quem olha a lista. Voltar não recria a booble, e não deveria:
     * recomeçar é um clique, e adivinhar com quem a pessoa ainda quer falar
     * meia hora depois é chute.
     */
    if (player.away) broadcastBooble(worldKey, world.leaveBooble(socket.id));
    persistPosition(true);
  });

  socket.on('sit', (sitting) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const player = getWorld(worldKey, scenarioId).setSitting(socket.id, sitting === true);
    if (!player) return; // recusado (não é cadeira) ou já estava assim
    socket.to(worldKey).emit('player:sat', socket.id, player.sitting);
    // sentar/levantar muda a posição para o centro da cadeira: grava já
    persistPosition(true);
  });

  socket.on('share', (sharing) => {
    const sessionId = socket.data.sessionId;
    if (!sessionId) return; // sem persistência não há o que registrar
    const wants = sharing === true;
    if (wants === (socket.data.sharing ?? false)) return;
    socket.data.sharing = wants;
    const previous = socket.data.shareRecord ?? Promise.resolve(null);
    socket.data.shareRecord = previous.then(async (openShareId) => {
      if (openShareId) await closeScreenShare(openShareId);
      return wants ? await openScreenShare(sessionId) : null;
    });
  });

  socket.on('chat:send', (rawText) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const world = getWorld(worldKey, scenarioId);
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
    io.to(worldKey).emit('chat:message', msg);
    // entrega primeiro, grava depois: o chat não deve esperar pelo banco
    const { placeId, profileId } = socket.data;
    if (placeId) void saveChatMessage(placeId, profileId ?? null, msg);
  });

  /**
   * "Toc-toc": chama alguém que está ausente.
   *
   * Três recusas, todas em silêncio — o cliente não recebe nada de volta, então
   * um cliente adulterado não consegue usar isto para descobrir quem está onde:
   *
   * 1. alvo fora do mesmo mundo (ou inexistente);
   * 2. alvo que **não** está ausente — o chamado só existe para atravessar o
   *    silêncio do ausente; quem está presente se ouve por voz ou lê no chat;
   * 3. cooldown por par ainda correndo. O limite é imposto aqui, e não só no
   *    botão: esconder o botão não é limite.
   */
  socket.on('presence:nudge', (rawTargetId) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const targetId = String(rawTargetId ?? '');
    if (!targetId || targetId === socket.id) return;

    const world = getWorld(worldKey, scenarioId);
    const from = world.getPlayer(socket.id);
    const target = world.getPlayer(targetId);
    if (!from || !target || !target.away) return;

    const now = Date.now();
    const nudged = (socket.data.nudgedAt ??= new Map());
    // poda antes de consultar: o mapa nunca passa dos alvos da janela atual
    for (const [id, at] of nudged) if (now - at >= NUDGE_COOLDOWN_MS) nudged.delete(id);
    if (nudged.has(targetId)) return;
    nudged.set(targetId, now);

    // o Socket.IO já mantém cada socket numa sala com o próprio id: é entrega
    // ponto a ponto, sem passar pelo mundo
    io.to(targetId).emit('presence:nudged', socket.id, from.name);
  });

  /**
   * "Pin": chama alguém que está **presente**, pelo menu de contexto do avatar.
   *
   * É o interruptor de um alerta na tela do alvo — `on: true` acende (com som),
   * `on: false` apaga porque quem chamou desistiu. As recusas são em silêncio,
   * pela mesma razão do "toc-toc": um "não deu" viraria sonda de presença.
   *
   * A guarda de ausência é **invertida** em relação ao `presence:nudge`: quem
   * está ausente não é chamado por aqui, porque o alerta pede que a pessoa
   * *venha até você* e quem está no celular já tem o canal próprio (com o
   * "toc-toc" e o botão "Voltar"). Uma pessoa, dois estados, dois canais. Ela
   * vale só para acender — ver o comentário no corpo.
   *
   * O servidor **não guarda** quem está chamando quem: o alerta vive no cliente
   * do alvo e o "pressionado" no cliente de quem chamou, e os dois se resolvem
   * pelo roster — quem sai do mundo faz os dois morrerem sozinhos. Um registro
   * aqui precisaria de limpeza no `disconnect` e não compraria nada.
   */
  socket.on('presence:call', (rawTargetId, rawOn) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const targetId = String(rawTargetId ?? '');
    if (!targetId || targetId === socket.id) return;

    const world = getWorld(worldKey, scenarioId);
    const from = world.getPlayer(socket.id);
    const target = world.getPlayer(targetId);
    if (!from || !target) return;

    const on = Boolean(rawOn);
    // a guarda de ausência vale só para ACENDER: apagar é limpeza, e recusar
    // limpeza só pode deixar lixo na tela. Sem esta distinção, o alvo que ficasse
    // ausente com um chamado no ar prenderia o alerta — o cancelamento de quem
    // chamou nunca chegaria, e o botão dele despressionaria mentindo.
    if (on && target.away) return;
    if (on) {
      const now = Date.now();
      const called = (socket.data.calledAt ??= new Map());
      // poda antes de consultar, como no "toc-toc": o mapa nunca passa dos
      // alvos da janela atual
      for (const [id, at] of called) if (now - at >= CALL_COOLDOWN_MS) called.delete(id);
      if (called.has(targetId)) return;
      called.set(targetId, now);
    }
    // apagar não passa pelo cooldown: desistir tem de ser sempre imediato,
    // senão o botão de quem chamou fica preso pressionado
    io.to(targetId).emit('presence:called', socket.id, from.name, on);
  });

  /**
   * O alvo respondeu: `accepted` = vem até aqui, `false` = fechou o alerta.
   *
   * Relay puro, com a única validação que faz sentido sem registro de chamados:
   * os dois no mesmo mundo. Sem isto o item do menu ficaria pressionado
   * apontando para um alerta que já saiu da tela da outra pessoa.
   */
  socket.on('presence:callAnswer', (rawFromId, rawAccepted) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const fromId = String(rawFromId ?? '');
    if (!fromId || fromId === socket.id) return;

    const world = getWorld(worldKey, scenarioId);
    const me = world.getPlayer(socket.id);
    if (!me || !world.hasPlayer(fromId)) return;

    io.to(fromId).emit('presence:callAnswered', socket.id, me.name, Boolean(rawAccepted));
  });

  /**
   * Entra na booble de alguém (criando-a se preciso) e sai da própria.
   *
   * Toda a validação está em `World.joinBooble` — é lá que estão as posições e o
   * mapa. Recusa **em silêncio**, como o "toc-toc" e pela mesma razão: um ack
   * dizendo "não deu" transformaria o clique numa sonda de quem está perto de
   * quem, e de quem está em que sala.
   */
  socket.on('booble:join', (rawTargetId) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const targetId = String(rawTargetId ?? '');
    if (!targetId || targetId === socket.id) return;
    broadcastBooble(worldKey, getWorld(worldKey, scenarioId).joinBooble(socket.id, targetId));
  });

  socket.on('booble:leave', () => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    broadcastBooble(worldKey, getWorld(worldKey, scenarioId).leaveBooble(socket.id));
  });

  socket.on('voice:token', async (ack) => {
    if (typeof ack !== 'function') return;
    if (!voiceConfigured) return ack({ ok: false, reason: 'not-configured' });

    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return ack({ ok: false, reason: 'not-joined' });

    const now = Date.now();
    const room = roomNameFor(worldKey);

    // IDEMPOTÊNCIA ANTES DE QUALQUER LIMITE: se já emitimos um token válido para
    // esta sala, repetir é a resposta certa. Era aqui que a produção quebrava.
    const cached = socket.data.tokenCache;
    if (cached && cached.room === room && now - cached.at < TOKEN_CACHE_TTL_MS) {
      console.log(`[voice] token repetido (cache) -> ${socket.id} (${room})`);
      auditTokenGrant(room, 'cached');
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
      const name = getWorld(worldKey, scenarioId).getPlayer(socket.id)?.name ?? 'Anônimo';
      const { url, token } = await mintVoiceToken(socket.id, name, worldKey);
      const res: VoiceTokenResponse = { ok: true, url, token, room, identity: socket.id };
      socket.data.tokenCache = { room, res, at: Date.now() };
      console.log(`[voice] token emitido -> ${socket.id} (${room})`); // sem o token, sem a secret
      auditTokenGrant(room, 'granted');
      ack(res);
    } catch (err) {
      console.error('[voice] falha ao emitir token:', err);
      auditTokenGrant(room, 'error');
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
    const { scenarioId, worldKey } = socket.data;
    console.log(
      `[disconnect] ${socket.id} motivo="${reason}" transporte=${transport} sessao=${secs}s` +
        (worldKey ? ` mundo=${worldKey}` : ' (sem join)'),
    );
    if (!scenarioId || !worldKey) return;
    // grava a posição final ANTES de tirar do mundo — depois o player não existe
    persistPosition(true);
    closeActivity();
    stopPresenceCredit();
    const sessionId = socket.data.sessionId;
    if (sessionId) void closeSession(sessionId, reason);
    const world = getWorld(worldKey, scenarioId);
    /**
     * Sai da booble ANTES de deixar o mundo: depois do `removePlayer` o player
     * já não existe, e a booble que ficaria com uma pessoa só nunca se
     * dissolveria. O próprio socket é filtrado porque o `player:left` logo
     * abaixo já o remove de todas as listas — mandar o `null` dele seria ruído.
     */
    broadcastBooble(
      worldKey,
      world.leaveBooble(socket.id).filter((p) => p.id !== socket.id),
    );
    if (world.removePlayer(socket.id)) {
      socket.to(worldKey).emit('player:left', socket.id);
    }
  });
}
