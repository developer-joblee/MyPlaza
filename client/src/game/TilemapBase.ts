import { Container } from 'pixi.js';
import { TILE_SIZE, TileType, isSolid, type WorldMap } from '@together/shared';

/**
 * Base comum dos renderers de cenário: colisão + contrato consumido
 * pelo Game (view, props, animate). O render em si fica nas subclasses.
 */
export abstract class TilemapBase {
  /** camada de chão (abaixo dos players) */
  readonly view = new Container();
  /** sprites altos para o layer com y-sort do Game */
  readonly props: Container[] = [];

  constructor(protected map: WorldMap) {}

  protected tileAt(x: number, y: number): TileType | null {
    if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) return null;
    return this.map.tiles[y][x];
  }

  isSolidAt(tileX: number, tileY: number): boolean {
    const t = this.tileAt(tileX, tileY);
    return t === null ? true : isSolid(t);
  }

  /** Colisão de um círculo (aproximado por AABB) contra tiles sólidos. */
  collidesCircle(x: number, y: number, radius: number): boolean {
    const minTx = Math.floor((x - radius) / TILE_SIZE);
    const maxTx = Math.floor((x + radius) / TILE_SIZE);
    const minTy = Math.floor((y - radius) / TILE_SIZE);
    const maxTy = Math.floor((y + radius) / TILE_SIZE);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (this.isSolidAt(tx, ty)) return true;
      }
    }
    return false;
  }

  /** Animações do cenário (ex.: água). Padrão: nada. */
  animate(_dt: number): void {}
}
