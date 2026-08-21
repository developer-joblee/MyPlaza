import type { CharacterId, ScenarioId } from '@together/shared';
import { fire } from './request';
import type { AppSocket } from './socket';

/**
 * O que se manda ao servidor estando **dentro** de um mundo.
 *
 * Todos sem ack, porque é assim que o protocolo os define (ver
 * `shared/src/events.ts`): o efeito volta como broadcast, não como resposta.
 * Por isso devolvem `boolean` — "foi para a rede" ou "não havia conexão" — em
 * vez de `Promise`.
 *
 * Esse `boolean` é o ponto: antes isto era `runtime.socket?.emit(...)`, e o
 * `?.` sumia com o pedido em silêncio. Quem digitou uma mensagem com o socket
 * caído perdia o texto sem nenhum aviso.
 */
export interface WorldApi {
  /** Entra no mundo. `worldId` é obrigatório quando o servidor exige login. */
  join(
    name: string,
    color: number,
    scenarioId: ScenarioId,
    character: CharacterId,
    worldId?: string,
  ): boolean;
  move(x: number, y: number): boolean;
  sit(sitting: boolean): boolean;
  setAway(away: boolean): boolean;
  chatSend(text: string): boolean;
  /** Comecei/parei de compartilhar a tela — o servidor só registra. */
  share(sharing: boolean): boolean;
}

/**
 * `getSocket` é função, e não o socket direto, porque quem cria a api
 * (`GameView`) a guarda em `runtime` e o socket pode ser substituído numa
 * reconexão. Ler na hora do envio evita uma api apontando para um socket morto.
 */
export function createWorldApi(getSocket: () => AppSocket | null): WorldApi {
  return {
    join: (name, color, scenarioId, character, worldId) =>
      fire(getSocket(), (s) => s.emit('join', name, color, scenarioId, character, worldId)),
    move: (x, y) => fire(getSocket(), (s) => s.emit('move', x, y)),
    sit: (sitting) => fire(getSocket(), (s) => s.emit('sit', sitting)),
    setAway: (away) => fire(getSocket(), (s) => s.emit('away', away)),
    chatSend: (text) => fire(getSocket(), (s) => s.emit('chat:send', text)),
    share: (sharing) => fire(getSocket(), (s) => s.emit('share', sharing)),
  };
}
