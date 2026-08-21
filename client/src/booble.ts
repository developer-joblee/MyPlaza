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
 * "Quero booble com essa pessoa" — o clique do menu de contexto, **de qualquer
 * distância**.
 *
 * A booble só se forma a 2 tiles (é o servidor que impõe), então de longe o
 * clique não pode ser o pedido: ele é uma **intenção**. O avatar caminha sozinho
 * até lá (o mesmo `AutoWalk` do "ir até", que já para exatamente em
 * `BOOBLE_JOIN_RADIUS`) e a booble se abre na chegada.
 *
 * Perto, não há intenção nenhuma: é o pedido direto de sempre. Guardar estado
 * para um caso que resolve no mesmo frame só criaria uma janela para divergir.
 */
export function requestBooble(targetId: string): void {
  const store = useStore.getState();
  if (store.boobleReachIds.includes(targetId)) {
    joinBooble(targetId);
    return;
  }
  store.setPendingBooble(targetId);
  runtime.game?.walkTo(targetId);
}

/**
 * Desisti (andei, cliquei no chão, cancelei no aviso) — ou o `Game` percebeu que
 * a caminhada morreu (prazo, `E`, alvo que saiu do mundo, rota impossível).
 *
 * Idempotente de propósito: o `Game` chama isto **por frame** enquanto não está
 * caminhando, e a saída antecipada é o que torna isso grátis.
 */
export function cancelPendingBooble(): void {
  const store = useStore.getState();
  if (store.pendingBooble === null) return;
  store.setPendingBooble(null);
  runtime.game?.cancelWalk();
}

/**
 * Cheguei: cumpre a intenção. Chamado pelo `Game` no frame em que o alvo entra em
 * `boobleReachIds` — que é distância **e** zona, as duas condições que o servidor
 * confere. Limpa antes de pedir, senão um pedido recusado deixaria a intenção
 * pendurada esperando uma chegada que já aconteceu.
 */
export function fulfillPendingBooble(targetId: string): void {
  useStore.getState().setPendingBooble(null);
  joinBooble(targetId);
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
