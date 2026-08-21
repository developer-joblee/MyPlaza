import { receiveNudge } from '../presence';
import { useStore } from '../state/store';
import type { AppSocket } from './socket';

/**
 * Liga os eventos do socket ao store (roster, chat, conexão).
 * O estado de posição/movimento é tratado direto pelo Game, fora do React.
 */
export function bindStoreToSocket(socket: AppSocket): () => void {
  const s = () => useStore.getState();

  const onConnect = () => s().setSelf(socket.id ?? null, true);
  const onDisconnect = () => s().setSelf(null, false);

  socket.on('connect', onConnect);
  socket.on('disconnect', onDisconnect);
  socket.on('world:snapshot', (players, chat, scenarioId) => {
    s().setScenario(scenarioId);
    s().setRoster(players.map(({ id, name, color, away }) => ({ id, name, color, away })));
    s().setChat(chat);
  });
  socket.on('player:joined', ({ id, name, color, away }) => {
    s().upsertRosterEntry({ id, name, color, away });
  });
  socket.on('player:left', (id) => s().removeRosterEntry(id));
  socket.on('chat:message', (msg) => s().appendChat(msg));
  /**
   * Alguém te chamou estando ausente. Vai por `presence.ts` (e não direto no
   * store) porque o chamado também toca o som — e o dono dos efeitos colaterais
   * de presença é aquele módulo, não este.
   */
  socket.on('presence:nudged', (fromId, fromName) => receiveNudge(fromId, fromName));
  /**
   * Recusado: volta para a tela de entrada com o motivo. Sem isto o cliente
   * ficaria para sempre num mundo vazio esperando um snapshot que não vem.
   */
  socket.on('join:denied', (reason) => s().denyJoin(reason));

  return () => {
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.removeAllListeners('world:snapshot');
    socket.removeAllListeners('player:joined');
    socket.removeAllListeners('player:left');
    socket.removeAllListeners('chat:message');
    socket.removeAllListeners('presence:nudged');
    socket.removeAllListeners('join:denied');
  };
}
