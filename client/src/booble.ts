import { runtime } from './runtime';
import { useStore } from './state/store';

/**
 * **Booble**: um grupo ad-hoc que prioriza o áudio de quem está dentro.
 *
 * Existe pelo mesmo motivo que `presence.ts`: a booble tem efeito em três
 * lugares (o store, que a UI lê; o jogo, que desenha a pastilha e alimenta a
 * voz; e a rede) e a ordem e a completude ficam melhor num só ponto do que
 * espalhadas por quem clica.
 *
 * A diferença em relação a `setAway` é quem manda. Ausência é intenção local —
 * o cliente decide, escreve o store e avisa os outros. A booble é o contrário:
 * **quem decide a filiação é o servidor**, porque ele é o único que tem as
 * posições de todos e é ele que impõe o raio de entrada e a remoção de quem se
 * afasta. Por isso `joinBooble`/`leaveBooble` só pedem, e nada muda na tela até
 * o `player:booble` voltar. Sem atualização otimista não existe o estado em que
 * a sua tela diz que você está numa booble e a dos outros diz que não.
 */

/**
 * Pede para entrar na booble desta pessoa (criando uma com vocês dois se ela
 * não tiver nenhuma).
 *
 * Devolve `false` quando não havia socket — igual a `nudge`, e serve para o
 * mesmo: quem clica não deve marcar nada na tela se o pedido não saiu. O
 * servidor ainda pode recusar em **silêncio** (longe, ausente, outra zona,
 * booble cheia), e nesse caso simplesmente não vem `player:booble`. É de
 * propósito: ver `booble:join` em `shared/src/events.ts`.
 */
export function joinBooble(targetId: string): boolean {
  return runtime.api?.boobleJoin(targetId) ?? false;
}

/** Sai da minha booble. Não recebe id: só se sai da própria. */
export function leaveBooble(): boolean {
  return runtime.api?.boobleLeave() ?? false;
}

/**
 * A booble de alguém mudou (a minha ou de um remoto) — é a única forma de o
 * estado mudar, e vale para o autor da ação também.
 *
 * Store primeiro, jogo depois: a ordem não importa para o resultado (nenhum dos
 * dois lê o outro), mas mantê-la igual à de `setAway` deixa os dois módulos com
 * a mesma forma para quem lê.
 */
export function receiveBoobleChange(id: string, boobleId: string | null): void {
  useStore.getState().setPlayerBooble(id, boobleId);
  runtime.game?.setPlayerBooble(id, boobleId);
}
