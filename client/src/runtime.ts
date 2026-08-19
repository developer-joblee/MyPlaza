import type { AppSocket } from './net/socket';
import type { VoiceRoom } from './voice/VoiceRoom';
import type { Game } from './game/Game';

/**
 * Referências vivas (não-reativas) para objetos criados no GameView,
 * acessíveis pelos componentes de UI sem passar por props/store.
 */
export const runtime: {
  socket: AppSocket | null;
  voice: VoiceRoom | null;
  game: Game | null;
} = {
  socket: null,
  voice: null,
  game: null,
};
