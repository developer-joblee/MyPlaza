import type { Server, Socket } from 'socket.io';
import {
  NAME_MAX_LENGTH,
  isProfileId,
  isScenarioId,
  type ClientToServerEvents,
  type LobbyErrorReason,
  type LobbyResult,
  type LobbyState,
  type ScenarioId,
  type ServerToClientEvents,
  type AssignableWorldRole,
  type WorldDetail,
  type WorldPatch,
  type WorldRole,
} from '@together/shared';
import { authRequired, verifyAccessToken, type AuthUser } from './auth';
import {
  acceptInviteById,
  archiveWorld,
  createWorld,
  deletePendingInvite,
  ensureOrgForNewWorld,
  ensureProfile,
  getMemberRole,
  getMyWorldRole,
  getPendingInvite,
  getPlaceById,
  addMemberToWorld,
  listPendingInvites,
  listWorldsFor,
  loadWorldDetail,
  removeWorldMember,
  setMemberRole,
  transferWorldOwnership,
  updateWorld,
} from './db';
import { worldOnlineCount } from './world';
import type { SocketData } from './handlers';

/**
 * O lobby: escolher, criar e ser convidado para mundos — tudo ANTES de entrar
 * em um.
 *
 * Fica separado de `handlers.ts` porque é outra fase da vida do socket: aqui
 * ninguém está num mundo, então nada de posição, voz ou chat. O cliente abre um
 * socket só para o lobby e o fecha ao entrar num mundo.
 *
 * Regras que valem para os quatro eventos:
 *
 * - **Identidade vem do token**, nunca do payload. É a mesma verificação do
 *   `join`, e o resultado fica no `socket.data` para os cliques seguintes não
 *   pagarem uma ida à rede cada.
 * - **Toda resposta de sucesso traz o estado inteiro.** São operações de um
 *   clique; devolver o estado evita a dança "escreve, depois lista" com uma
 *   janela no meio em que a tela mente.
 * - **Falha é código, não texto.** Igual ao `join:denied`.
 */

/** Limite defensivo: nome de mundo é texto livre de usuário. */
const WORLD_NAME_MAX = 40;
/** Teto para `capacity` — número absurdo não protege ninguém e polui a UI. */
const CAPACITY_MAX = 200;

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Quem está pedindo, resolvido uma vez por socket. */
interface LobbyIdentity {
  authUser: AuthUser;
  profileId: string;
}

/**
 * Resultado de `whoAmI`, com o MOTIVO em vez de só `null`.
 *
 * Existia como `LobbyIdentity | null`, e três causas bem diferentes — sem
 * token, token recusado, e falha do banco ao resolver o perfil — colapsavam no
 * mesmo `null`, que o `handle` traduzia para `invalid-token`. A tela dizia
 * "sua sessão expirou" para uma falha de banco, o que manda investigar
 * exatamente o lugar errado.
 */
type Who = { ok: true; me: LobbyIdentity } | { ok: false; reason: LobbyErrorReason };

export function registerLobbyHandlers(io: IoServer, socket: IoSocket): void {
  let identity: LobbyIdentity | null = null;

  const fail = (reason: LobbyErrorReason): LobbyResult => ({ ok: false, reason });

  /**
   * Autentica e resolve o perfil. Note que o perfil é CRIADO aqui se não
   * existir: o lobby vem antes da tela de entrada, então ainda não há nome nem
   * personagem escolhidos — o nome sai do e-mail e a tela de entrada
   * sobrescreve depois.
   */
  async function whoAmI(): Promise<Who> {
    if (identity) return { ok: true, me: identity };
    if (!authRequired) return { ok: false, reason: 'not-configured' };
    const token = String(socket.handshake.auth?.token ?? '');
    if (!token) return { ok: false, reason: 'auth-required' };
    const authUser = await verifyAccessToken(token);
    if (!authUser) return { ok: false, reason: 'invalid-token' };
    const profileId = await ensureProfile(authUser.id, authUser.email);
    if (!profileId) {
      /**
       * O token é VÁLIDO — o Supabase já disse de quem é. O que falhou foi o
       * banco, criando ou lendo o perfil. Isto tem log próprio porque a
       * confusão custou caro uma vez: devolvendo `invalid-token` como antes, a
       * tela dizia "sua sessão expirou" e mandava investigar login, quando a
       * causa era `profiles.id` sem default (ver `0007`).
       */
      console.error(
        '[lobby] token válido, mas o perfil não pôde ser criado/lido: ' +
          'isto é falha de BANCO, não de sessão. O motivo está no log `[db] ensureProfile` acima.',
      );
      return { ok: false, reason: 'error' };
    }
    identity = { authUser, profileId };
    return { ok: true, me: identity };
  }

  /** Estado atual do lobby: mundos visíveis (com gente online) e convites. */
  async function buildState(me: LobbyIdentity): Promise<LobbyState> {
    const [worlds, invites] = await Promise.all([
      listWorldsFor(me.profileId),
      listPendingInvites(me.authUser.email),
    ]);
    return {
      // `online` vem da memória do processo, não do banco: é a única contagem
      // que não mente depois de uma queda de conexão que não fechou a sessão
      worlds: worlds.map((w) => ({ ...w, online: worldOnlineCount(w.id) })),
      invites,
      // o ID que a pessoa passa a quem administra um mundo para ser adicionada
      myId: me.profileId,
    };
  }

  /**
   * Casca comum dos quatro eventos: ack válido, Supabase configurado, token
   * válido, e a resposta já com o estado novo. Cada handler só devolve se a
   * operação deu certo (ou o motivo).
   */
  function handle(
    label: string,
    op: (me: LobbyIdentity) => Promise<LobbyErrorReason | { detail?: WorldDetail } | null>,
  ): (ack: unknown) => Promise<void> {
    return async (ack: unknown) => {
      if (typeof ack !== 'function') return;
      const reply = ack as (res: LobbyResult) => void;
      if (!authRequired) return reply(fail('not-configured'));
      const who = await whoAmI();
      if (!who.ok) return reply(fail(who.reason));
      const me = who.me;
      try {
        const outcome = await op(me);
        if (typeof outcome === 'string') {
          console.log(`[lobby] ${label} recusado: ${outcome}`);
          return reply(fail(outcome));
        }
        reply({ ok: true, state: await buildState(me), detail: outcome?.detail });
      } catch (err) {
        console.error(`[lobby] ${label}:`, err instanceof Error ? err.message : err);
        reply(fail('error'));
      }
    };
  }

  /**
   * Confere que quem pediu pode administrar este mundo, e devolve o mundo mais
   * o papel de quem pediu.
   *
   * Toda operação de gerenciamento passa por aqui. A checagem é no servidor a
   * cada chamada porque esconder o botão na tela não é controle de acesso — e
   * mundo arquivado não se gerencia mais.
   *
   * `ownerOnly` é para as duas operações que não se delega: arquivar o mundo e
   * passar a propriedade adiante.
   */
  async function manageableWorld(
    worldId: string,
    me: LobbyIdentity,
    ownerOnly = false,
  ): Promise<{ organizationId: string; myRole: WorldRole } | LobbyErrorReason> {
    if (!worldId) return 'invalid-input';
    const world = await getPlaceById(worldId);
    if (!world || world.archivedAt) return 'not-found';
    const myRole = await getMyWorldRole(worldId, me.profileId);
    if (myRole !== 'owner' && (ownerOnly || myRole !== 'host')) return 'not-allowed';
    return { organizationId: world.organizationId, myRole };
  }

  /**
   * Desconecta quem está dentro do mundo — todos, ou só um perfil.
   *
   * Não existe evento de "você foi expulso": o cliente reconecta sozinho, refaz
   * o `join`, e o portão recusa com o motivo certo (`place-restricted` para quem
   * perdeu o acesso, `no-place` se o mundo foi arquivado). Reusar o portão é
   * melhor que um caminho paralelo que poderia discordar dele.
   */
  async function ejectFrom(worldKey: string, profileId?: string): Promise<void> {
    const sockets = await io.in(worldKey).fetchSockets();
    for (const other of sockets) {
      if (profileId && other.data.profileId !== profileId) continue;
      other.disconnect(true);
    }
  }

  socket.on('lobby:list', (ack) => void handle('list', async () => null)(ack));

  socket.on('lobby:create', (rawName, rawScenario, rawCapacity, ack) => {
    void handle('create', async (me) => {
      const name = String(rawName ?? '').trim().slice(0, WORLD_NAME_MAX);
      if (!name) return 'invalid-input';
      if (!isScenarioId(rawScenario)) return 'invalid-input';
      const scenarioId: ScenarioId = rawScenario;

      // null = sem limite. Qualquer coisa fora de 1..CAPACITY_MAX é entrada
      // inválida, não um valor a ser "corrigido" silenciosamente.
      let capacity: number | null = null;
      if (rawCapacity !== null && rawCapacity !== undefined) {
        const n = Number(rawCapacity);
        if (!Number.isInteger(n) || n < 1 || n > CAPACITY_MAX) return 'invalid-input';
        capacity = n;
      }

      const displayName = (me.authUser.email?.split('@')[0] ?? 'Alguém').slice(0, NAME_MAX_LENGTH);
      const orgId = await ensureOrgForNewWorld(me.profileId, displayName);
      if (!orgId) return 'error';
      const worldId = await createWorld(me.profileId, orgId, name, scenarioId, capacity);
      return worldId ? null : 'error';
    })(ack);
  });

  socket.on('lobby:addMember', (rawWorldId, rawMemberId, ack) => {
    void handle('addMember', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const memberId = String(rawMemberId ?? '').trim().toLowerCase();
      /**
       * O formato é conferido aqui de propósito: sem isto, qualquer texto colado
       * iria para o banco e voltaria como erro de sintaxe de uuid — que o
       * `guard` traduz para `'error'`, e a tela diria "erro" onde a verdade é
       * "esse ID não existe". Um ID malformado é entrada inválida.
       */
      if (!worldId || !isProfileId(memberId)) return 'invalid-input';
      // dono ou host adiciona. Membro comum não pode ampliar o acesso ao mundo —
      // senão o controle de quem administra seria decorativo.
      const managed = await manageableWorld(worldId, me);
      if (typeof managed === 'string') return managed;
      const res = await addMemberToWorld(worldId, managed.organizationId, memberId);
      return res === 'ok' ? null : res === 'not-found' ? 'not-found' : 'error';
    })(ack);
  });

  /**
   * Quem é o dono deste mundo. O painel usa para marcar a linha do dono na
   * lista de membros — que não é necessariamente quem está olhando, agora que
   * host também abre o painel.
   */
  async function ownerOf(worldId: string): Promise<string | null> {
    return (await getPlaceById(worldId))?.createdBy ?? null;
  }

  socket.on('lobby:setMemberRole', (rawWorldId, rawProfileId, rawRole, ack) => {
    void handle('setMemberRole', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const profileId = String(rawProfileId ?? '');
      if (!profileId) return 'invalid-input';
      if (rawRole !== 'host' && rawRole !== 'member') return 'invalid-input';
      const role: AssignableWorldRole = rawRole;

      const managed = await manageableWorld(worldId, me);
      if (typeof managed === 'string') return managed;

      // o dono não tem papel editável: a propriedade vem de `created_by`, e
      // deixá-la depender de `place_members.role` seria poder perdê-la por
      // engano. Para trocar de dono existe `lobby:transferOwner`.
      if (profileId === (await ownerOf(worldId))) return 'not-allowed';

      const current = await getMemberRole(worldId, profileId);
      if (current === null) return 'not-found';
      // host mexe em member; mexer em host é só do dono
      if (managed.myRole !== 'owner' && current === 'host') return 'not-allowed';

      if (!(await setMemberRole(worldId, profileId, role))) return 'error';
      return { detail: await loadWorldDetail(worldId, await ownerOf(worldId)) };
    })(ack);
  });

  socket.on('lobby:transferOwner', (rawWorldId, rawProfileId, ack) => {
    void handle('transferOwner', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const profileId = String(rawProfileId ?? '');
      if (!profileId) return 'invalid-input';
      // passar a propriedade é só do dono, e não se passa para si mesmo
      const managed = await manageableWorld(worldId, me, true);
      if (typeof managed === 'string') return managed;
      if (profileId === me.profileId) return 'invalid-input';
      // só para quem já tem acesso: promover um estranho a dono num clique
      // seria dar o mundo a quem nunca foi convidado
      if ((await getMemberRole(worldId, profileId)) === null) return 'not-found';
      if (!(await transferWorldOwnership(worldId, me.profileId, profileId))) return 'error';
      return { detail: await loadWorldDetail(worldId, profileId) };
    })(ack);
  });

  socket.on('lobby:world', (rawWorldId, ack) => {
    void handle('world', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const managed = await manageableWorld(worldId, me);
      if (typeof managed === 'string') return managed;
      return { detail: await loadWorldDetail(worldId, await ownerOf(worldId)) };
    })(ack);
  });

  socket.on('lobby:update', (rawWorldId, rawPatch, ack) => {
    void handle('update', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const managed = await manageableWorld(worldId, me);
      if (typeof managed === 'string') return managed;

      const raw = (rawPatch ?? {}) as Record<string, unknown>;
      const patch: WorldPatch = {};

      if (raw.name !== undefined) {
        const name = String(raw.name).trim().slice(0, WORLD_NAME_MAX);
        if (!name) return 'invalid-input';
        patch.name = name;
      }
      if (raw.capacity !== undefined) {
        // null é intencional ("sem limite"); qualquer outro valor fora da faixa
        // é entrada inválida, não algo a corrigir silenciosamente
        if (raw.capacity === null) {
          patch.capacity = null;
        } else {
          const n = Number(raw.capacity);
          if (!Number.isInteger(n) || n < 1 || n > CAPACITY_MAX) return 'invalid-input';
          patch.capacity = n;
        }
      }
      if (raw.visibility !== undefined) {
        if (raw.visibility !== 'organization' && raw.visibility !== 'restricted') {
          return 'invalid-input';
        }
        patch.visibility = raw.visibility;
      }

      if (!(await updateWorld(worldId, patch))) return 'error';
      // reduzir a lotação abaixo de quem já está dentro NÃO expulsa ninguém: o
      // limite vale para quem entra. Expulsar por um número mudaria a regra
      // debaixo de quem já estava numa conversa.
      return { detail: await loadWorldDetail(worldId, await ownerOf(worldId)) };
    })(ack);
  });

  socket.on('lobby:archive', (rawWorldId, ack) => {
    void handle('archive', async (me) => {
      const worldId = String(rawWorldId ?? '');
      // arquivar é só do dono: é a operação que some com o mundo para todos
      const managed = await manageableWorld(worldId, me, true);
      if (typeof managed === 'string') return managed;
      if (!(await archiveWorld(worldId))) return 'error';
      // a chave do mundo é o próprio id do local
      await ejectFrom(worldId);
      return null;
    })(ack);
  });

  socket.on('lobby:removeMember', (rawWorldId, rawProfileId, ack) => {
    void handle('removeMember', async (me) => {
      const worldId = String(rawWorldId ?? '');
      const profileId = String(rawProfileId ?? '');
      if (!profileId) return 'invalid-input';
      const managed = await manageableWorld(worldId, me);
      if (typeof managed === 'string') return managed;
      // ninguém se remove do próprio mundo, e o dono não é removível: ele
      // continuaria entrando (o portão deixa o criador passar) e a lista mentiria
      if (profileId === me.profileId) return 'not-allowed';
      if (profileId === (await ownerOf(worldId))) return 'not-allowed';
      // host não mexe em host — só o dono. Senão dois hosts poderiam se remover
      // um ao outro numa corrida, e quem clicasse primeiro ganharia o mundo.
      if (managed.myRole !== 'owner' && (await getMemberRole(worldId, profileId)) === 'host') {
        return 'not-allowed';
      }
      if (!(await removeWorldMember(worldId, profileId))) return 'error';
      await ejectFrom(worldId, profileId);
      return { detail: await loadWorldDetail(worldId, await ownerOf(worldId)) };
    })(ack);
  });

  socket.on('lobby:revokeInvite', (rawInviteId, ack) => {
    void handle('revokeInvite', async (me) => {
      const inviteId = String(rawInviteId ?? '');
      if (!inviteId) return 'invalid-input';
      const invite = await getPendingInvite(inviteId);
      // convite de empresa (sem mundo) não tem dono de mundo para revogá-lo:
      // isso é administração de empresa, que ainda não existe
      if (!invite?.placeId) return 'not-found';
      const managed = await manageableWorld(invite.placeId, me);
      if (typeof managed === 'string') return managed;
      if (!(await deletePendingInvite(inviteId))) return 'error';
      return { detail: await loadWorldDetail(invite.placeId, await ownerOf(invite.placeId)) };
    })(ack);
  });

  socket.on('lobby:decline', (rawInviteId, ack) => {
    void handle('decline', async (me) => {
      const inviteId = String(rawInviteId ?? '');
      if (!inviteId) return 'invalid-input';
      const invite = await getPendingInvite(inviteId);
      // só recuso o que é endereçado a mim — id alheio não serve de nada
      if (!invite || invite.email !== (me.authUser.email ?? '').toLowerCase()) return 'not-found';
      return (await deletePendingInvite(inviteId)) ? null : 'error';
    })(ack);
  });

  socket.on('lobby:accept', (rawInviteId, ack) => {
    void handle('accept', async (me) => {
      const inviteId = String(rawInviteId ?? '');
      if (!inviteId) return 'invalid-input';
      // `acceptInviteById` confere que o convite é do e-mail de quem pediu —
      // por isso um id de convite alheio não serve de nada
      const ok = await acceptInviteById(inviteId, me.profileId, me.authUser.email);
      return ok ? null : 'not-found';
    })(ack);
  });
}
