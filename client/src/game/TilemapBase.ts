import { Container } from 'pixi.js';
import { TILE_SIZE, TileType, isSolid, sitFacingAt, type WorldMap } from '@together/shared';
import type { SitFacing } from './characterDefs';

/** Uma cadeira sentável: onde ela está e para que lado quem senta fica virado. */
export interface SittableSpot {
  tileX: number;
  tileY: number;
  facing: SitFacing;
}

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

  /** Para que lado sentaria quem estivesse neste tile (null = não é cadeira). */
  sitFacingAtTile(tileX: number, tileY: number): SitFacing | null {
    const t = this.tileAt(tileX, tileY);
    return t === null ? null : sitFacingAt(t);
  }

  /**
   * A cadeira sentável mais próxima da posição, entre as quatro adjacentes ao
   * tile atual. Só ortogonais de propósito: na diagonal a pessoa "alcançaria"
   * uma cadeira do outro lado da mesa.
   */
  sittableNear(x: number, y: number): SittableSpot | null {
    const tx = Math.floor(x / TILE_SIZE);
    const ty = Math.floor(y / TILE_SIZE);
    let melhor: SittableSpot | null = null;
    let menorDist = Infinity;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const cx = tx + dx;
      const cy = ty + dy;
      const facing = this.sitFacingAtTile(cx, cy);
      if (!facing) continue;
      // desempate pelo centro do tile, para a cadeira "da frente" ganhar
      const dist = Math.hypot(cx * TILE_SIZE + TILE_SIZE / 2 - x, cy * TILE_SIZE + TILE_SIZE / 2 - y);
      if (dist < menorDist) {
        menorDist = dist;
        melhor = { tileX: cx, tileY: cy, facing };
      }
    }
    return melhor;
  }

  /**
   * Um tile livre ao lado da cadeira, para onde levantar. Devolve null se a
   * cadeira estiver cercada — aí o chamador mantém a pessoa onde está.
   */
  freeTileNear(tileX: number, tileY: number): { x: number; y: number } | null {
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      if (!this.isSolidAt(tileX + dx, tileY + dy)) {
        return {
          x: (tileX + dx) * TILE_SIZE + TILE_SIZE / 2,
          y: (tileY + dy) * TILE_SIZE + TILE_SIZE / 2,
        };
      }
    }
    return null;
  }

  /** Animações do cenário (ex.: água). Padrão: nada. */
  animate(_dt: number): void {}
}
