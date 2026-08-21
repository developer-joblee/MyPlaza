import { CALL_COOLDOWN_MS } from '@together/shared';
import { runtime } from './runtime';
import { useStore } from './state/store';
import { playCallPing } from './ui/ping';

/**
 * "Chamar" pelo menu de contexto do avatar: o pin, o alerta e o "ir até".
 *
 * Este arquivo é o dono dos efeitos colaterais do chamado, como `presence.ts` é
 * o dono dos da ausência: ele é o único lugar que junta store + som + rede +
 * jogo. Nem componente nem store falam com o servidor ou tocam som direto — a
 * UI chama daqui, e o `bindStore` entrega os eventos aqui.
 *
 * A divisão com o "toc-toc" de `presence.ts`: aquele é para quem está **ausente**
 * (canal que atravessa o silêncio do SFU, e a resposta é "Voltar"); este é para
 * quem está **presente**, e a resposta é *vir até você*.
 */

/**
 * Quanto tempo o cartão "X está vindo" fica na tela. Ao contrário do alerta de
 * chamado — que **não** expira, porque quem chamou pode estar longe da tela —,
 * este é confirmação de algo que já está acontecendo: em poucos segundos a
 * pessoa aparece do lado, e aí o cartão só ocuparia espaço.
 *
 * Constante local: é só do cliente, o servidor não sabe que este cartão existe.
 */
const COMING_MS = 6000;

/**
 * Chama, ou desiste de chamar, esta pessoa. É a ação do item do menu, que é um
 * interruptor: pressionado = chamado no ar na tela dela.
 *
 * Só marca o store se o `fire()` disse que o evento foi para a rede — a lição do
 * botão "chamar" do HUD: com o socket caído, marcar deixaria o item pressionado
 * mentindo sobre um alerta que ninguém recebeu.
 */
export function toggleCall(targetId: string): void {
  const store = useStore.getState();
  const on = store.myCalls[targetId] === undefined;
  if (!runtime.api?.call(targetId, on)) return;
  if (on) store.setMyCall(targetId);
  else store.clearMyCall(targetId);
}

/**
 * Este chamado ainda está no cooldown do servidor? A UI usa para desabilitar o
 * item em vez de deixar o clique não fazer nada — o limite de verdade é imposto
 * no servidor, isto aqui só evita o clique inútil.
 */
export function callCooldownLeft(at: number | undefined): number {
  if (at === undefined) return 0;
  return Math.max(0, CALL_COOLDOWN_MS - (Date.now() - at));
}

/** Alguém me chamou (`on`), ou desistiu de me chamar (`!on`). */
export function receiveCall(fromId: string, fromName: string, on: boolean): void {
  const store = useStore.getState();
  if (!on) {
    store.removeCall(fromId, 'incoming');
    return;
  }
  store.pushCall(fromId, fromName, 'incoming');
  playCallPing();
}

/**
 * Respondo ao chamado de alguém: `accepted` = vou até lá.
 *
 * Tira o alerta nos dois casos — o chamado foi respondido, e um cartão que
 * sobrasse na tela depois do aceite ficaria pedindo o que já está a caminho.
 */
export function answerCall(fromId: string, accepted: boolean): void {
  useStore.getState().removeCall(fromId, 'incoming');
  runtime.api?.callAnswer(fromId, accepted);
  if (accepted) runtime.game?.walkTo(fromId);
}

/**
 * O alvo respondeu ao MEU chamado. Despressionar o item do menu é o ponto: sem
 * isto ele apontaria para um alerta que a outra pessoa já tirou da tela.
 *
 * O cartão "está vindo" só aparece no aceite: "fechou o seu chamado" é
 * informação que só serviria para cobrar alguém, e o item voltar ao normal já
 * diz que o chamado morreu.
 */
export function receiveCallAnswer(byId: string, byName: string, accepted: boolean): void {
  const store = useStore.getState();
  store.clearMyCall(byId);
  if (!accepted) return;
  store.pushCall(byId, byName, 'coming');
  // sem guardar o timer: ele só remove um cartão, e removê-lo duas vezes (ou
  // depois de sair do mundo, quando o `leave` já limpou) é no-op
  window.setTimeout(() => useStore.getState().removeCall(byId, 'coming'), COMING_MS);
}
