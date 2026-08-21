import { receiveBoobleChange } from '../booble';
import { receiveCall, receiveCallAnswer } from '../call';
import { receiveNudge } from '../presence';
import { receiveSound } from '../soundboard';
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
    s().setRoster(
      players.map(({ id, name, color, away, boobleId }) => ({ id, name, color, away, boobleId })),
    );
    s().setChat(chat);
  });
  socket.on('player:joined', ({ id, name, color, away, boobleId }) => {
    s().upsertRosterEntry({ id, name, color, away, boobleId });
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
   * Chamado pelo menu de contexto (o "pin"), e a resposta a um chamado meu. Vão
   * por `call.ts` pela mesma razão: têm efeito de som e de jogo (a
   * auto-caminhada), e o dono desses efeitos não é este arquivo.
   */
  socket.on('presence:called', (fromId, fromName, on) => receiveCall(fromId, fromName, on));
  socket.on('presence:callAnswered', (byId, byName, accepted) =>
    receiveCallAnswer(byId, byName, accepted),
  );
  /**
   * Alguém perto tocou um som do soundboard. Vai por `soundboard/`, e não pelo
   * store, pela mesma razão do chamado acima: o evento tem efeito de áudio, e o
   * dono desse efeito é aquele módulo.
   */
  socket.on('soundboard:played', (fromId, fromName, soundId, url) =>
    receiveSound(fromId, fromName, soundId, url),
  );
  /**
   * A booble de alguém mudou. Vai por `booble.ts` (e não direto no store)
   * porque a mudança também mexe no jogo — a pastilha no avatar e o que a voz
   * usa para decidir volume. Mesmo arranjo do chamado acima.
   */
  socket.on('player:booble', (id, boobleId) => receiveBoobleChange(id, boobleId));
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
    socket.removeAllListeners('presence:called');
    socket.removeAllListeners('presence:callAnswered');
    socket.removeAllListeners('soundboard:played');
    socket.removeAllListeners('player:booble');
    socket.removeAllListeners('join:denied');
  };
}
