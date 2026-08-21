import type { LobbyErrorReason } from '@together/shared';

/**
 * Motivos vindos do servidor, em português. Ele manda código, nunca texto.
 *
 * Vive fora do `LobbyScreen` porque **duas** telas fazem operações de lobby: o
 * lobby em si e o menu de configurações dentro do jogo, que adiciona gente pelo
 * ID sem sair do mundo. Duas cópias deste mapa divergiriam no primeiro motivo
 * novo — e o `LobbyErrorReason` já cresceu uma vez (ganhou `socket-down` e
 * `timeout`, que o servidor nunca emite).
 */
export const REASON_TEXT: Record<LobbyErrorReason, string> = {
  // os dois primeiros são do transporte: o servidor nem soube do pedido
  'socket-down': 'Sem conexão com o servidor. Tente de novo.',
  timeout: 'O servidor não respondeu. Tente de novo.',
  'not-configured': 'Este servidor não tem login configurado.',
  'auth-required': 'Entre com sua conta para ver seus mundos.',
  'invalid-token': 'Sua sessão expirou. Entre de novo.',
  'invalid-input': 'Confira o que foi digitado.',
  'not-allowed': 'Só quem administra o mundo pode adicionar gente.',
  'not-found': 'Isso não existe mais.',
  error: 'Algo falhou do nosso lado. Se continuar, o motivo está no log do servidor.',
};
