import type { Server, Socket } from 'socket.io';
import {
  AVATAR_COLORS,
  CHAT_MAX_LENGTH,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  NUDGE_COOLDOWN_MS,
  POSITION_SAVE_MS,
  isCharacterId,
  isScenarioId,
  type ChatMessage,
  type ClientToServerEvents,
  type JoinDeniedReason,
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
  /** mesma corrente, para o compartilhamento de tela */
  shareRecord?: Promise<string | null>;
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

      // abre a sessão depois de já estar no mundo: é histórico, ninguém espera por ela
      if (placeId && profileId) {
        const userAgent = String(socket.handshake.headers['user-agent'] ?? '').slice(0, 300) || null;
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
    // 15 msgs/s entram aqui; cada um decide sozinho se vale uma escrita
    persistPosition(wasSitting === true && !player.sitting);
    trackZone();
  });

  socket.on('away', (away) => {
    const { scenarioId, worldKey } = socket.data;
    if (!scenarioId || !worldKey) return;
    const player = getWorld(worldKey, scenarioId).setAway(socket.id, away === true);
    if (!player) return; // já estava assim
    socket.to(worldKey).emit('player:away', socket.id, player.away);
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
    const sessionId = socket.data.sessionId;
    if (sessionId) void closeSession(sessionId, reason);
    if (getWorld(worldKey, scenarioId).removePlayer(socket.id)) {
      socket.to(worldKey).emit('player:left', socket.id);
    }
  });
}
