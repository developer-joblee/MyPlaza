import { runtime } from './runtime';
import { useStore } from './state/store';
import { playKnock } from './ui/knock';

/**
 * Ficar ausente ou voltar.
 *
 * Ausente mexe em quatro lugares (store, voz, avatar local e rede), então a
 * ordem e a completude ficam num só ponto em vez de espalhadas pela UI. Há dois
 * caminhos que chamam isto: o botão da barra e o próprio jogo, quando a pessoa
 * anda estando ausente.
 *
 * O store é escrito aqui, e não na sala de voz, porque a voz pode não existir
 * (ambiente sem LiveKit configurado) e o estado de ausente tem de valer de
 * qualquer jeito — inclusive o visual do celular e o aviso aos outros.
 */
export function setAway(away: boolean): void {
  if (useStore.getState().away === away) return;
  useStore.getState().setAway(away);
  runtime.voice?.setAway(away);
  runtime.game?.setSelfAway(away);
  runtime.api?.setAway(away);
  /**
   * Corta som de soundboard em vôo ao ficar ausente. Ausente cortou o áudio da
   * sala, e um som de 5s que continua tocando depois disso soa como a feature
   * ignorando o botão. O caminho de volta não precisa de nada: o próximo som
   * chega pelo evento.
   */
  if (away) runtime.soundboard?.stopAll();
}

/**
 * Chama alguém que está ausente ("toc-toc").
 *
 * Devolve `false` quando não havia socket — o `fire()` da camada de requisição
 * é quem sabe disso, e quem chama usa esse retorno para **não** marcar o botão
 * como "chamado". O servidor ainda pode recusar em silêncio (cooldown, alvo que
 * acabou de voltar), e isso é de propósito: ver `presence:nudge` no `shared`.
 */
export function nudge(targetId: string): boolean {
  return runtime.api?.nudge(targetId) ?? false;
}

/**
 * Recebi um chamado. Aviso na tela (pilha do `Notices`) + som.
 *
 * Ignora o chamado se eu não estiver ausente: o servidor só emite para quem
 * está, mas entre o clique da outra pessoa e a chegada aqui eu posso ter
 * voltado — e nesse caso o aviso "alguém está te chamando" apareceria em cima
 * de uma pessoa que já está ouvindo a sala.
 *
 * O aviso **não** expira por tempo, e é a decisão que mais importa aqui: quem
 * está ausente está longe da tela, então um toast de 5s garante que a pessoa
 * perca exatamente a informação que a feature existe para entregar. Ele sai
 * quando ela volta (`setAway(false)`) ou quando ela dispensa.
 */
export function receiveNudge(fromId: string, fromName: string): void {
  const store = useStore.getState();
  if (!store.away) return;
  store.pushNudge(fromId, fromName);
  playKnock();
}
