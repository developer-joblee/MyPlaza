import { runtime } from './runtime';
import { useStore } from './state/store';

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
}
