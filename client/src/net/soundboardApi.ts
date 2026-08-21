import type { SoundboardResult } from '@together/shared';
import { fire, once, request } from './request';
import type { AppSocket } from './socket';

/**
 * As operações do soundboard, na fronteira de requisição.
 *
 * Três por ack (biblioteca) e uma sem (o disparo), espelhando o protocolo em
 * `shared/src/events.ts`. As por ack nunca lançam: falha de transporte vira
 * `{ ok: false, reason: 'socket-down' | 'timeout' }`, no mesmo formato da recusa
 * do servidor — quem chama trata um caminho de erro, não dois.
 *
 * `play` devolve `boolean` como os outros eventos de mundo ("foi para a rede" ou
 * "não havia conexão"), e é isso que a grade usa para não acender o botão de um
 * som que não saiu.
 */

const asResult = (reason: 'socket-down' | 'timeout'): SoundboardResult => ({ ok: false, reason });

export interface SoundboardApi {
  list(): Promise<SoundboardResult>;
  /**
   * Sobe um som para um slot. `null` = já havia um upload igual em vôo (dois
   * cliques no mesmo slot), o que não é erro: a tela ignora.
   */
  upload(
    slot: number,
    label: string,
    mime: string,
    durationMs: number,
    bytes: ArrayBuffer,
  ): Promise<SoundboardResult | null>;
  remove(soundId: string): Promise<SoundboardResult | null>;
  /** Persiste o volume no perfil. Sem `once`: ver a implementação. */
  setVolume(volume: number): Promise<SoundboardResult>;
  play(soundId: string): boolean;
}

export function createSoundboardApi(getSocket: () => AppSocket | null): SoundboardApi {
  const ask = (emit: Parameters<typeof request<SoundboardResult>>[1]) =>
    request<SoundboardResult>(getSocket(), emit, asResult);

  return {
    list: () => ask((s, ack) => s.emit('soundboard:list', ack)),

    /**
     * Prazo maior que o default de 10s: aqui o ack só volta depois de o servidor
     * ter subido o arquivo para o Storage, o que numa conexão ruim é o passo
     * lento — e um timeout no meio de um upload que ia dar certo deixaria o
     * arquivo no bucket com a tela dizendo que falhou.
     */
    upload: (slot, label, mime, durationMs, bytes) =>
      once(`upload:${slot}`, () =>
        request<SoundboardResult>(
          getSocket(),
          (s, ack) => s.emit('soundboard:upload', slot, label, mime, durationMs, bytes, ack),
          asResult,
          30000,
        ),
      ),

    remove: (soundId) =>
      once(`removeSound:${soundId}`, () =>
        ask((s, ack) => s.emit('soundboard:remove', soundId, ack)),
      ),

    /**
     * **Sem** `once()`, de propósito: aquele dedupe descarta a segunda chamada
     * com a mesma chave enquanto a primeira está em vôo, e aqui a segunda é
     * justamente o valor mais novo do slider. Quem controla a frequência é o
     * debounce da tela; o que chega aqui é o valor final, e o último tem de
     * ganhar.
     */
    setVolume: (volume) => ask((s, ack) => s.emit('soundboard:setVolume', volume, ack)),

    play: (soundId) => fire(getSocket(), (s) => s.emit('soundboard:play', soundId)),
  };
}
