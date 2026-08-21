import type {
  AssignableWorldRole,
  LobbyResult,
  ScenarioId,
  WorldPatch,
} from '@together/shared';
import { once, request } from './request';
import type { AppSocket } from './socket';

/**
 * As doze operações do lobby, como funções `async` tipadas.
 *
 * Cada uma resolve um `LobbyResult` e **nunca lança**: falha de transporte vira
 * `{ ok: false, reason: 'socket-down' | 'timeout' }`, no mesmo formato da recusa
 * do servidor. Quem chama trata um caminho de erro, não dois.
 *
 * As que escrevem passam por `once()`, com chave por operação **e por alvo**:
 * dois cliques em "Convidar" no mesmo mundo são um pedido, mas convidar em dois
 * mundos diferentes ao mesmo tempo continua permitido. `null` significa "já
 * havia uma igual em vôo" — não é erro, e a tela ignora.
 */

/** Toda falha de transporte entra no mesmo formato da recusa do servidor. */
const asResult = (reason: 'socket-down' | 'timeout'): LobbyResult => ({ ok: false, reason });

export interface LobbyApi {
  list(): Promise<LobbyResult>;
  create(
    name: string,
    scenarioId: ScenarioId,
    capacity: number | null,
  ): Promise<LobbyResult | null>;
  /** dá acesso ao mundo para quem já tem conta, pelo ID dela */
  addMember(worldId: string, memberId: string): Promise<LobbyResult | null>;
  accept(inviteId: string): Promise<LobbyResult | null>;
  decline(inviteId: string): Promise<LobbyResult | null>;
  world(worldId: string): Promise<LobbyResult>;
  update(worldId: string, patch: WorldPatch): Promise<LobbyResult | null>;
  archive(worldId: string): Promise<LobbyResult | null>;
  removeMember(worldId: string, profileId: string): Promise<LobbyResult | null>;
  revokeInvite(inviteId: string): Promise<LobbyResult | null>;
  setMemberRole(
    worldId: string,
    profileId: string,
    role: AssignableWorldRole,
  ): Promise<LobbyResult | null>;
  transferOwner(worldId: string, profileId: string): Promise<LobbyResult | null>;
}

export function createLobbyApi(getSocket: () => AppSocket | null): LobbyApi {
  const ask = (emit: Parameters<typeof request<LobbyResult>>[1]) =>
    request<LobbyResult>(getSocket(), emit, asResult);

  /** Leitura não precisa de `once`: repetir um `list` é inofensivo. */
  const write = (key: string, emit: Parameters<typeof request<LobbyResult>>[1]) =>
    once(key, () => ask(emit));

  return {
    list: () => ask((s, ack) => s.emit('lobby:list', ack)),

    world: (worldId) => ask((s, ack) => s.emit('lobby:world', worldId, ack)),

    create: (name, scenarioId, capacity) =>
      // chave sem alvo: só se cria um mundo por vez
      write('create', (s, ack) => s.emit('lobby:create', name, scenarioId, capacity, ack)),

    addMember: (worldId, memberId) =>
      write(`addMember:${worldId}:${memberId}`, (s, ack) =>
        s.emit('lobby:addMember', worldId, memberId, ack),
      ),

    accept: (inviteId) =>
      write(`accept:${inviteId}`, (s, ack) => s.emit('lobby:accept', inviteId, ack)),

    decline: (inviteId) =>
      write(`decline:${inviteId}`, (s, ack) => s.emit('lobby:decline', inviteId, ack)),

    update: (worldId, patch) =>
      write(`update:${worldId}`, (s, ack) => s.emit('lobby:update', worldId, patch, ack)),

    archive: (worldId) =>
      write(`archive:${worldId}`, (s, ack) => s.emit('lobby:archive', worldId, ack)),

    removeMember: (worldId, profileId) =>
      write(`removeMember:${worldId}:${profileId}`, (s, ack) =>
        s.emit('lobby:removeMember', worldId, profileId, ack),
      ),

    revokeInvite: (inviteId) =>
      write(`revokeInvite:${inviteId}`, (s, ack) =>
        s.emit('lobby:revokeInvite', inviteId, ack),
      ),

    setMemberRole: (worldId, profileId, role) =>
      write(`setMemberRole:${worldId}:${profileId}`, (s, ack) =>
        s.emit('lobby:setMemberRole', worldId, profileId, role, ack),
      ),

    transferOwner: (worldId, profileId) =>
      write(`transferOwner:${worldId}`, (s, ack) =>
        s.emit('lobby:transferOwner', worldId, profileId, ack),
      ),
  };
}
