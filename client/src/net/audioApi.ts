import type { PeerAudioResult } from '@together/shared';
import { request } from './request';
import type { AppSocket } from './socket';

/**
 * O volume por pessoa, na fronteira de requisição.
 *
 * Arquivo próprio, e não uma linha em `worldApi.ts`, por duas razões que se
 * somam: aquele arquivo é inteiro de eventos **sem ack** (devolvem `boolean` de
 * "foi para a rede"), e o efeito daqui é uma escrita no **perfil**, não no
 * mundo — o mundo entra só como a lista de quem é quem. Enfiar uma operação por
 * ack ali apagaria justamente a característica que faz o `worldApi` ser fácil de
 * ler.
 *
 * Ver `docs/features/volume-por-pessoa.md`.
 */

const asResult = (reason: 'socket-down' | 'timeout'): PeerAudioResult => ({ ok: false, reason });

export interface AudioApi {
  /**
   * Grava o meu ajuste para esta pessoa. `targetId` é o `socket.id` dela.
   *
   * Nunca lança: falha de transporte volta no mesmo formato da recusa do
   * servidor, para a tela tratar um caminho de erro e não dois.
   */
  setPeer(targetId: string, voice: number, sound: number): Promise<PeerAudioResult>;
}

export function createAudioApi(getSocket: () => AppSocket | null): AudioApi {
  return {
    /**
     * **Sem** `once()`, pela mesma razão do `soundboardApi.setVolume`: o dedupe
     * descartaria a segunda chamada com a mesma chave enquanto a primeira está
     * em vôo — e a segunda é justamente o valor mais novo do slider. Quem
     * controla a frequência é o debounce da tela; o último tem de ganhar.
     */
    setPeer: (targetId, voice, sound) =>
      request<PeerAudioResult>(
        getSocket(),
        (s, ack) => s.emit('audio:setPeer', targetId, voice, sound, ack),
        asResult,
      ),
  };
}
