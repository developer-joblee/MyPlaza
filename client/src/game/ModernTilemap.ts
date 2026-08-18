import { Assets, Container, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
import { TILE_SIZE, TileType, isSolid, isWallLike, type WorldMap } from '@together/shared';
import { TilemapBase } from './TilemapBase';

const NAVY = 0x2b2b45;
const CAP_WHITE = 0xf2f1ed;

/** Hash determinístico para variação estável entre clients. */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}

interface Piece {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Recortes calibrados por varredura de alpha das sheets (px). */
const RB = {
  floorGray: { x: 448, y: 160, w: 32, h: 32 },
  floorTeal: { x: 352, y: 352, w: 32, h: 32 },
  floorYellow: { x: 352, y: 256, w: 32, h: 32 },
  floorHerringbone: { x: 352, y: 416, w: 32, h: 32 },
  // faixa bege: friso branco + face + rodapé (cobre o tile da parede e o de cima)
  wallFace: { x: 32, y: 608, w: 32, h: 64 },
} as const;

const IN = {
  workstations: [
    { x: 238, y: 1142, w: 48, h: 70 },
    { x: 354, y: 1142, w: 48, h: 70 },
  ],
  longDesk: { x: 32, y: 1154, w: 128, h: 46 },
  stool: { x: 194, y: 418, w: 28, h: 28 },
  chairs: [
    { x: 292, y: 994, w: 26, h: 42 },
    { x: 290, y: 1058, w: 26, h: 42 },
    { x: 324, y: 994, w: 26, h: 42 },
    { x: 322, y: 1058, w: 26, h: 42 },
  ],
  sofaBig: { x: 256, y: 576, w: 96, h: 52 },
  sofaSmall: { x: 234, y: 432, w: 76, h: 42 },
  shelves: [
    { x: 64, y: 592, w: 64, h: 64 },
    { x: 128, y: 592, w: 64, h: 64 },
  ],
  easel: { x: 322, y: 1280, w: 62, h: 64 },
  counters: [
    { x: 358, y: 1554, w: 54, h: 64 },
    { x: 422, y: 1554, w: 54, h: 64 },
  ],
  fridge: { x: 390, y: 1296, w: 26, h: 48 },
  globes: [
    { x: 418, y: 1154, w: 26, h: 42 },
    { x: 450, y: 1154, w: 26, h: 42 },
  ],
  plants: [
    { x: 334, y: 1426, w: 36, h: 60 },
    { x: 386, y: 1444, w: 28, h: 46 },
    { x: 426, y: 1408, w: 46, h: 62 }, // palmeira
  ],
  rug3x2: { x: 228, y: 488, w: 120, h: 80 },
  rug3x1: { x: 96, y: 1348, w: 96, h: 56 },
  rug2x1: { x: 6, y: 1348, w: 86, h: 56 },
  window: { x: 298, y: 788, w: 42, h: 36 },
  arts: [
    { x: 10, y: 432, w: 44, h: 14 }, // TV
    { x: 32, y: 506, w: 63, h: 56 }, // planner
    { x: 262, y: 656, w: 54, h: 28 }, // quadro fogo
    { x: 262, y: 727, w: 54, h: 28 }, // quadro praia
  ],
  chalkboard: { x: 420, y: 1294, w: 56, h: 46 },
} as const;

export interface ModernTextures {
  roomBuilder: Texture;
  interiors: Texture;
}

let cached: ModernTextures | null = null;

export async function loadModernTextures(): Promise<ModernTextures> {
  if (cached) return cached;
  const [roomBuilder, interiors] = await Promise.all([
    Assets.load<Texture>('/tiles/modern/room_builder.png'),
    Assets.load<Texture>('/tiles/modern/interiors.png'),
  ]);
  roomBuilder.source.scaleMode = 'nearest';
  interiors.source.scaleMode = 'nearest';
  cached = { roomBuilder, interiors };
  return cached;
}

/**
 * Cenário Estúdio (Modern Interiors, 32px nativo, escala 1).
 * Paredes estilo Gather: face de 2 tiles nas paredes viradas para o sul
 * (entra no y-sort e oclui players atrás), "teto" branco com contorno
 * navy nas demais. Móveis são props y-sorted; tapetes/pisos na camada chão.
 */
export class ModernTilemap extends TilemapBase {
  private cutCache = new Map<string, Texture>();

  constructor(map: WorldMap, private tx: ModernTextures) {
    super(map);
    this.build();
  }

  private cut(sheet: Texture, piece: Piece): Texture {
    const key = `${sheet.uid}:${piece.x},${piece.y},${piece.w},${piece.h}`;
    let tex = this.cutCache.get(key);
    if (!tex) {
      tex = new Texture({
        source: sheet.source,
        frame: new Rectangle(piece.x, piece.y, piece.w, piece.h),
      });
      this.cutCache.set(key, tex);
    }
    return tex;
  }

  private isWallAt(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t === null || isWallLike(t);
  }

  private floorTexFor(t: TileType): Texture {
    switch (t) {
      case TileType.FloorLounge:
        return this.cut(this.tx.roomBuilder, RB.floorHerringbone);
      case TileType.FloorMeeting:
        return this.cut(this.tx.roomBuilder, RB.floorTeal);
      case TileType.FloorKitchen:
        return this.cut(this.tx.roomBuilder, RB.floorYellow);
      default:
        return this.cut(this.tx.roomBuilder, RB.floorGray);
    }
  }

  /** Piso a desenhar sob um móvel: o do vizinho caminhável mais próximo. */
  private floorTexUnder(x: number, y: number): Texture {
    const floors = new Set([
      TileType.Floor, TileType.FloorLounge, TileType.FloorMeeting,
      TileType.FloorKitchen, TileType.Rug,
    ]);
    for (const [dx, dy] of [[0, 1], [0, -1], [-1, 0], [1, 0]] as const) {
      const t = this.tileAt(x + dx, y + dy);
      if (t !== null && floors.has(t) && t !== TileType.Rug) return this.floorTexFor(t);
    }
    return this.cut(this.tx.roomBuilder, RB.floorGray);
  }

  private build(): void {
    const { map } = this;
    // 1) chão + paredes
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        const t = map.tiles[y][x];
        if (isWallLike(t)) {
          this.buildWall(x, y, t);
        } else {
          const floorTex = isSolid(t) || t === TileType.Rug
            ? this.floorTexUnder(x, y)
            : this.floorTexFor(t);
          this.addGround(floorTex, x, y);
        }
      }
    }
    // 2) tapetes por região retangular
    this.buildRugs();
    // 3) móveis (runs + singles)
    this.buildFurniture();
  }

  // ------------------------------------------------------------- paredes

  private buildWall(x: number, y: number, t: TileType): void {
    const southOpen = y + 1 < this.map.rows && !this.isWallAt(x, y + 1);

    if (southOpen) {
      // face de 64px cobre o tile da parede + o de cima, entra no y-sort
      const face = new Sprite(this.cut(this.tx.roomBuilder, RB.wallFace));
      face.anchor.set(0, 1);
      face.position.set(x * TILE_SIZE, (y + 1) * TILE_SIZE);
      face.zIndex = (y + 1) * TILE_SIZE;
      this.props.push(face);
    } else {
      const cap = new Graphics();
      const px = x * TILE_SIZE;
      const py = y * TILE_SIZE;
      cap.rect(px, py, TILE_SIZE, TILE_SIZE).fill(CAP_WHITE);
      const line = 3;
      if (!this.isWallAt(x, y - 1)) cap.rect(px, py, TILE_SIZE, line).fill(NAVY);
      if (!this.isWallAt(x, y + 1)) cap.rect(px, py + TILE_SIZE - line, TILE_SIZE, line).fill(NAVY);
      if (!this.isWallAt(x - 1, y)) cap.rect(px, py, line, TILE_SIZE).fill(NAVY);
      if (!this.isWallAt(x + 1, y)) cap.rect(px + TILE_SIZE - line, py, line, TILE_SIZE).fill(NAVY);
      this.view.addChild(cap);
    }

    // decoração fixada na face (janela/quadro/lousa)
    if (t === TileType.Wall) return;
    const piece =
      t === TileType.WallWindow
        ? IN.window
        : t === TileType.WallBoard
          ? IN.chalkboard
          : IN.arts[hash(x, y) % IN.arts.length];
    const decor = new Sprite(this.cut(this.tx.interiors, piece));
    decor.anchor.set(0.5);
    decor.position.set((x + 0.5) * TILE_SIZE, y * TILE_SIZE + 6);
    decor.zIndex = (y + 1) * TILE_SIZE + 1;
    this.props.push(decor);
  }

  // -------------------------------------------------------------- móveis

  private buildRugs(): void {
    const seen = new Set<string>();
    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        if (this.map.tiles[y][x] !== TileType.Rug || seen.has(`${x},${y}`)) continue;
        let w = 1;
        while (this.tileAt(x + w, y) === TileType.Rug) w++;
        let h = 1;
        while (this.tileAt(x, y + h) === TileType.Rug) h++;
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) seen.add(`${x + dx},${y + dy}`);
        }
        const piece = h >= 2 ? IN.rug3x2 : w >= 3 ? IN.rug3x1 : IN.rug2x1;
        const rug = new Sprite(this.cut(this.tx.interiors, piece));
        rug.anchor.set(0.5);
        rug.position.set((x + w / 2) * TILE_SIZE, (y + h / 2) * TILE_SIZE);
        this.view.addChild(rug);
      }
    }
  }

  private buildFurniture(): void {
    const seen = new Set<string>();
    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        if (seen.has(`${x},${y}`)) continue;
        const t = this.map.tiles[y][x];
        const runLen = (type: TileType): number => {
          let len = 1;
          while (this.tileAt(x + len, y) === type) len++;
          for (let i = 0; i < len; i++) seen.add(`${x + i},${y}`);
          return len;
        };
        switch (t) {
          case TileType.Sofa: {
            const len = runLen(t);
            this.addProp(len >= 3 ? IN.sofaBig : IN.sofaSmall, x, y, len);
            break;
          }
          case TileType.Table: {
            const len = runLen(t);
            if (len === 1) {
              this.addProp(IN.stool, x, y, 1);
            } else {
              this.addProp(IN.longDesk, x, y, len, { stretch: true });
            }
            break;
          }
          case TileType.Shelf: {
            const len = runLen(t);
            const piece = IN.shelves[hash(x, y) % IN.shelves.length];
            this.addProp(piece, x, y, len);
            break;
          }
          case TileType.Desk: {
            const len = runLen(t); // lousa de cavalete (run 2)
            this.addProp(IN.easel, x, y, len);
            break;
          }
          case TileType.Counter: {
            const len = runLen(t);
            this.addProp(IN.counters[hash(x, y) % IN.counters.length], x, y, len);
            break;
          }
          case TileType.Workstation:
            this.addProp(IN.workstations[hash(x, y) % IN.workstations.length], x, y, 1);
            break;
          case TileType.Chair:
            this.addProp(IN.chairs[hash(x, y) % IN.chairs.length], x, y, 1);
            break;
          case TileType.Fridge:
            this.addProp(IN.fridge, x, y, 1);
            break;
          case TileType.Globe:
            this.addProp(IN.globes[hash(x, y) % IN.globes.length], x, y, 1);
            break;
          case TileType.Plant:
            this.addProp(IN.plants[hash(x, y) % IN.plants.length], x, y, 1);
            break;
          default:
            break;
        }
      }
    }
  }

  private addProp(
    piece: Piece,
    tileX: number,
    tileY: number,
    runLen: number,
    opts: { stretch?: boolean } = {},
  ): void {
    const sprite = new Sprite(this.cut(this.tx.interiors, piece));
    if (opts.stretch) {
      sprite.width = runLen * TILE_SIZE;
      sprite.height = piece.h * ((runLen * TILE_SIZE) / piece.w);
    }
    sprite.anchor.set(0.5, 1);
    const baseY = (tileY + 1) * TILE_SIZE - 1;
    sprite.position.set((tileX + runLen / 2) * TILE_SIZE, baseY);
    sprite.zIndex = baseY;
    this.props.push(sprite);
  }

  private addGround(tex: Texture, x: number, y: number): void {
    const sprite = new Sprite(tex);
    sprite.position.set(x * TILE_SIZE, y * TILE_SIZE);
    this.view.addChild(sprite);
  }
}
