import type { AppSocket } from './net/socket';
import type { WorldApi } from './net/worldApi';
import type { VoiceRoom } from './voice/VoiceRoom';
import type { Game } from './game/Game';

/**
 * Referências vivas (não-reativas) para objetos criados no GameView,
 * acessíveis pelos componentes de UI sem passar por props/store.
 *
 * `api` é a fronteira de requisição (`net/worldApi.ts`). Quem está dentro de um
 * mundo manda pedidos por ela, e não por `socket` — que fica aqui só para quem
 * precisa do socket em si (assinar eventos, ler `connected`).
 */
export const runtime: {
  socket: AppSocket | null;
  api: WorldApi | null;
  voice: VoiceRoom | null;
  game: Game | null;
} = {
  socket: null,
  api: null,
  voice: null,
  game: null,
};
