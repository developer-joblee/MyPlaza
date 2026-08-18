import type { AppSocket } from './net/socket';
import type { PeerManager } from './webrtc/PeerManager';
import type { Game } from './game/Game';

/**
 * Referências vivas (não-reativas) para objetos criados no GameView,
 * acessíveis pelos componentes de UI sem passar por props/store.
 */
export const runtime: {
  socket: AppSocket | null;
  peerManager: PeerManager | null;
  game: Game | null;
} = {
  socket: null,
  peerManager: null,
  game: null,
};
