import type { FurnitureId, FurnitureResult } from '@together/shared';
import { request } from './request';
import type { AppSocket } from './socket';

/**
 * A fronteira de requisição do editor de móveis. Tudo por ack
 * (`FurnitureResult`): o efeito visível volta pelo broadcast
 * (`furniture:changed`/`removed`), o ack só diz se o pedido valeu — é o que
 * deixa a UI mostrar o motivo de uma recusa sem inventar estado.
 */
export interface FurnitureApi {
  place(furnitureId: FurnitureId, tileX: number, tileY: number, rotation: number): Promise<FurnitureResult>;
  move(id: string, tileX: number, tileY: number, rotation: number): Promise<FurnitureResult>;
  remove(id: string): Promise<FurnitureResult>;
}

const fail = (): FurnitureResult => ({ ok: false, reason: 'error' });

export function createFurnitureApi(getSocket: () => AppSocket | null): FurnitureApi {
  return {
    place: (furnitureId, tileX, tileY, rotation) =>
      request(
        getSocket(),
        (s, ack) => s.emit('furniture:place', furnitureId, tileX, tileY, rotation, ack),
        fail,
      ),
    move: (id, tileX, tileY, rotation) =>
      request(
        getSocket(),
        (s, ack) => s.emit('furniture:move', id, tileX, tileY, rotation, ack),
        fail,
      ),
    remove: (id) => request(getSocket(), (s, ack) => s.emit('furniture:remove', id, ack), fail),
  };
}
