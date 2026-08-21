import type { Appearance, EmoteId, ScenarioId } from '@together/shared';
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
    appearance: Appearance,
    worldId?: string,
  ): boolean;
  move(x: number, y: number): boolean;
  sit(sitting: boolean): boolean;
  setAway(away: boolean): boolean;
  chatSend(text: string): boolean;
  /** Chama quem está ausente. O servidor pode recusar em silêncio (cooldown). */
  nudge(targetId: string): boolean;
  /**
   * Acende (`on: true`) ou apaga o chamado desta pessoa — o "pin" do menu de
   * contexto. O servidor pode recusar em silêncio (alvo ausente, cooldown).
   */
  call(targetId: string, on: boolean): boolean;
  /** Responde ao chamado de alguém: `accepted` = "ir até". */
  callAnswer(fromId: string, accepted: boolean): boolean;
  /**
   * Entra na booble desta pessoa, criando uma se ela não tiver. O servidor pode
   * recusar em silêncio (longe, ausente, outra zona, booble cheia).
   */
  boobleJoin(targetId: string): boolean;
  /** Sai da minha booble. Sem argumento: só se sai da própria. */
  boobleLeave(): boolean;
  /** Comecei/parei de compartilhar a tela — o servidor só registra. */
  share(sharing: boolean): boolean;
  /** Reação sobre a cabeça. O servidor pode recusar em silêncio (cooldown). */
  emote(emoteId: EmoteId): boolean;
}

/**
 * `getSocket` é função, e não o socket direto, porque quem cria a api
 * (`GameView`) a guarda em `runtime` e o socket pode ser substituído numa
 * reconexão. Ler na hora do envio evita uma api apontando para um socket morto.
 */
export function createWorldApi(getSocket: () => AppSocket | null): WorldApi {
  return {
    // o 4º argumento do evento é o `character` LEGADO (clientes antigos);
    // cliente novo manda undefined ali e a aparência no 6º
    join: (name, color, scenarioId, appearance, worldId) =>
      fire(getSocket(), (s) =>
        s.emit('join', name, color, scenarioId, undefined, worldId, appearance),
      ),
    move: (x, y) => fire(getSocket(), (s) => s.emit('move', x, y)),
    sit: (sitting) => fire(getSocket(), (s) => s.emit('sit', sitting)),
    setAway: (away) => fire(getSocket(), (s) => s.emit('away', away)),
    chatSend: (text) => fire(getSocket(), (s) => s.emit('chat:send', text)),
    nudge: (targetId) => fire(getSocket(), (s) => s.emit('presence:nudge', targetId)),
    call: (targetId, on) => fire(getSocket(), (s) => s.emit('presence:call', targetId, on)),
    callAnswer: (fromId, accepted) =>
      fire(getSocket(), (s) => s.emit('presence:callAnswer', fromId, accepted)),
    boobleJoin: (targetId) => fire(getSocket(), (s) => s.emit('booble:join', targetId)),
    boobleLeave: () => fire(getSocket(), (s) => s.emit('booble:leave')),
    share: (sharing) => fire(getSocket(), (s) => s.emit('share', sharing)),
    emote: (emoteId) => fire(getSocket(), (s) => s.emit('player:emote', emoteId)),
  };
}
