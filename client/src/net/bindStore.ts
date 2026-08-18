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
    s().setRoster(players.map(({ id, name, color }) => ({ id, name, color })));
    s().setChat(chat);
  });
  socket.on('player:joined', ({ id, name, color }) => {
    s().upsertRosterEntry({ id, name, color });
  });
  socket.on('player:left', (id) => s().removeRosterEntry(id));
  socket.on('chat:message', (msg) => s().appendChat(msg));

  return () => {
    socket.off('connect', onConnect);
    socket.off('disconnect', onDisconnect);
    socket.removeAllListeners('world:snapshot');
    socket.removeAllListeners('player:joined');
    socket.removeAllListeners('player:left');
    socket.removeAllListeners('chat:message');
  };
}
