import { Graphics } from 'pixi.js';
import { TILE_SIZE, TileType, type WorldMap } from '@together/shared';
import { TilemapBase } from './TilemapBase';

const TILE_COLORS: Partial<Record<TileType, number>> = {
  [TileType.Floor]: 0xede7db,
  [TileType.Wall]: 0x4a4f63,
  [TileType.Desk]: 0xb08968,
  [TileType.Table]: 0x9c6644,
  [TileType.Carpet]: 0xd4e2dc,
};

/** Cenário do escritório: render procedural (Graphics), sem texturas. */
export class OfficeTilemap extends TilemapBase {
  constructor(map: WorldMap) {
    super(map);
    const g = new Graphics();

    // fundo
    g.rect(0, 0, map.widthPx, map.heightPx).fill(TILE_COLORS[TileType.Floor]!);

    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const tile = map.tiles[y][x];
        const px = x * TILE_SIZE;
        const py = y * TILE_SIZE;
        switch (tile) {
          case TileType.Wall:
            g.rect(px, py, TILE_SIZE, TILE_SIZE).fill(TILE_COLORS[tile]!);
            g.rect(px, py, TILE_SIZE, 4).fill(0x5d6379);
            break;
          case TileType.Carpet:
            g.rect(px, py, TILE_SIZE, TILE_SIZE).fill(TILE_COLORS[tile]!);
            break;
          case TileType.Desk:
          case TileType.Table: {
            const inset = 2;
            g.roundRect(px + inset, py + inset, TILE_SIZE - inset * 2, TILE_SIZE - inset * 2, 4)
              .fill(TILE_COLORS[tile]!);
            g.roundRect(px + inset, py + inset, TILE_SIZE - inset * 2, 5, 4)
              .fill({ color: 0xffffff, alpha: 0.3 });
            break;
          }
          case TileType.Plant: {
            const cx = px + TILE_SIZE / 2;
            const cy = py + TILE_SIZE / 2;
            g.circle(cx, cy + 6, 7).fill(0x8d6e4f); // vaso
            g.circle(cx, cy - 2, 10).fill(0x588157);
            g.circle(cx - 6, cy + 2, 7).fill(0x6a994e);
            g.circle(cx + 6, cy + 2, 7).fill(0x6a994e);
            break;
          }
          default:
            break;
        }
      }
    }

    // grade sutil
    for (let x = 0; x <= map.cols; x++) {
      g.moveTo(x * TILE_SIZE, 0).lineTo(x * TILE_SIZE, map.heightPx)
        .stroke({ width: 1, color: 0x000000, alpha: 0.04 });
    }
    for (let y = 0; y <= map.rows; y++) {
      g.moveTo(0, y * TILE_SIZE).lineTo(map.widthPx, y * TILE_SIZE)
        .stroke({ width: 1, color: 0x000000, alpha: 0.04 });
    }

    this.view.addChild(g);
  }
}
