import { Container, Sprite, Texture } from 'pixi.js';
import { TILE_SIZE, TileType, isSolid, type WorldMap } from '@together/shared';
import type { BlobSet, Tilesets } from './tilesets';

const SCALE = 2; // tiles de 16px -> 32px
const WATER_FRAME_S = 0.4;

type InsideFn = (x: number, y: number) => boolean;

/** Hash determinístico para variação visual estável entre clients. */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}

export class Tilemap {
  /** camada de chão (abaixo dos players) */
  readonly view = new Container();
  /** sprites altos para o layer com y-sort do Game */
  readonly props: Sprite[] = [];

  private waterSprites: Sprite[] = [];
  private waterTimer = 0;
  private waterFrame = 0;

  constructor(
    private map: WorldMap,
    private ts: Tilesets,
  ) {
    this.build();
  }

  // ------------------------------------------------------------- colisão

  private tileAt(x: number, y: number): TileType | null {
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

  // ------------------------------------------------------------- render

  private build(): void {
    const { map } = this;
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        this.buildGround(x, y);
      }
    }
    this.buildRugs();
    this.buildBridges();
    this.buildHouse();
    for (let y = 0; y < map.rows; y++) {
      for (let x = 0; x < map.cols; x++) {
        this.buildProp(x, y);
      }
    }
  }

  private isWater = (x: number, y: number): boolean => this.tileAt(x, y) === TileType.Water;

  /** "terra" = tudo que não é água (fora do mapa conta como terra: sem borda). */
  private isLand = (x: number, y: number): boolean => !this.isWater(x, y);

  private isTrail = (x: number, y: number): boolean => {
    const t = this.tileAt(x, y);
    return t === TileType.Path || t === TileType.Bridge;
  };

  private buildGround(x: number, y: number): void {
    const t = this.map.tiles[y][x];

    if (t === TileType.Water || t === TileType.Bridge) {
      this.addWater(x, y);
      return; // sprite da ponte é desenhado por região em buildBridges()
    }

    // terra: base de grama (com borda se encostar na água)
    const nearWater = this.anyNeighbor(x, y, this.isWater);
    if (nearWater) {
      this.addWater(x, y);
      this.addTile(this.blobPiece(this.ts.grassBlob, x, y, this.isLand), x, y);
    } else {
      const h = hash(x, y);
      const tex =
        h % 100 < 78
          ? this.ts.grassPlain[h % this.ts.grassPlain.length]
          : this.ts.grassDecor[h % this.ts.grassDecor.length];
      this.addTile(tex, x, y);
    }

    if (t === TileType.Path) {
      this.addTile(this.blobPiece(this.ts.dirtBlob, x, y, this.isTrail), x, y);
    } else if (t === TileType.Fence) {
      const mask =
        (this.tileAt(x, y - 1) === TileType.Fence ? 1 : 0) |
        (this.tileAt(x + 1, y) === TileType.Fence ? 2 : 0) |
        (this.tileAt(x, y + 1) === TileType.Fence ? 4 : 0) |
        (this.tileAt(x - 1, y) === TileType.Fence ? 8 : 0);
      this.addTile(this.ts.fence[mask], x, y);
    } else if (t === TileType.Flower) {
      const tex = this.ts.flowers[hash(x, y) % this.ts.flowers.length];
      this.addCentered(tex, x, y);
    }
  }

  private buildProp(x: number, y: number): void {
    const t = this.map.tiles[y][x];
    switch (t) {
      case TileType.Tree:
        this.addProp(this.ts.trees[hash(x, y) % this.ts.trees.length], x, y);
        break;
      case TileType.Bush:
        this.addProp(this.ts.bush, x, y);
        break;
      case TileType.Rock:
        this.addProp(this.ts.rock, x, y);
        break;
      case TileType.Sunflower:
        this.addProp(this.ts.sunflower, x, y);
        break;
      case TileType.Table:
        this.addProp(this.ts.table, x, y);
        break;
      case TileType.Chair:
        this.addProp(this.ts.chairs[hash(x, y) % this.ts.chairs.length], x, y);
        break;
      default:
        break;
    }
  }

  /** Tapetes: runs horizontais de `r` viram um sprite centrado por run/linha. */
  private buildRugs(): void {
    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        if (this.map.tiles[y][x] !== TileType.Rug) continue;
        if (this.tileAt(x - 1, y) === TileType.Rug) continue; // não é início do run
        let len = 1;
        while (this.tileAt(x + len, y) === TileType.Rug) len++;
        const tex = len >= 3 ? this.ts.rugBig : this.ts.rugsSmall[y % this.ts.rugsSmall.length];
        const sprite = new Sprite(tex);
        sprite.scale.set(SCALE);
        sprite.anchor.set(0.5);
        sprite.position.set(
          (x + len / 2) * TILE_SIZE,
          (y + 0.5) * TILE_SIZE,
        );
        this.view.addChild(sprite);
        x += len - 1;
      }
    }
  }

  /** Pontes: cada região conexa de `=` recebe um sprite esticado no bbox. */
  private buildBridges(): void {
    const seen = new Set<string>();
    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        if (this.map.tiles[y][x] !== TileType.Bridge || seen.has(`${x},${y}`)) continue;
        let minX = x, maxX = x, minY = y, maxY = y;
        const queue: Array<[number, number]> = [[x, y]];
        seen.add(`${x},${y}`);
        while (queue.length) {
          const [cx, cy] = queue.pop()!;
          minX = Math.min(minX, cx); maxX = Math.max(maxX, cx);
          minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]] as const) {
            if (this.tileAt(nx, ny) === TileType.Bridge && !seen.has(`${nx},${ny}`)) {
              seen.add(`${nx},${ny}`);
              queue.push([nx, ny]);
            }
          }
        }
        const sprite = new Sprite(this.ts.bridgeH);
        sprite.position.set(minX * TILE_SIZE, minY * TILE_SIZE);
        sprite.width = (maxX - minX + 1) * TILE_SIZE;
        sprite.height = (maxY - minY + 1) * TILE_SIZE;
        this.view.addChild(sprite);
      }
    }
  }

  /** Casinha: um sprite único ancorado na base do footprint `H`. */
  private buildHouse(): void {
    let minX = Infinity, maxY = -Infinity;
    let found = false;
    for (let y = 0; y < this.map.rows; y++) {
      for (let x = 0; x < this.map.cols; x++) {
        if (this.map.tiles[y][x] === TileType.House) {
          found = true;
          minX = Math.min(minX, x);
          maxY = Math.max(maxY, y);
        }
      }
    }
    if (!found) return;
    const sprite = new Sprite(this.ts.house);
    sprite.scale.set(SCALE);
    sprite.anchor.set(0, 1);
    sprite.position.set(minX * TILE_SIZE, (maxY + 1) * TILE_SIZE);
    sprite.zIndex = (maxY + 1) * TILE_SIZE;
    this.props.push(sprite);
  }

  // -------------------------------------------------------- helpers

  private addTile(tex: Texture, x: number, y: number): void {
    const sprite = new Sprite(tex);
    sprite.scale.set(SCALE);
    sprite.position.set(x * TILE_SIZE, y * TILE_SIZE);
    this.view.addChild(sprite);
  }

  private addCentered(tex: Texture, x: number, y: number): void {
    const sprite = new Sprite(tex);
    sprite.scale.set(SCALE);
    sprite.anchor.set(0.5);
    sprite.position.set((x + 0.5) * TILE_SIZE, (y + 0.5) * TILE_SIZE);
    this.view.addChild(sprite);
  }

  private addWater(x: number, y: number): void {
    const sprite = new Sprite(this.ts.water[0]);
    sprite.scale.set(SCALE);
    sprite.position.set(x * TILE_SIZE, y * TILE_SIZE);
    this.view.addChild(sprite);
    this.waterSprites.push(sprite);
  }

  private addProp(tex: Texture, x: number, y: number): void {
    const sprite = new Sprite(tex);
    sprite.scale.set(SCALE);
    sprite.anchor.set(0.5, 1);
    const baseY = (y + 1) * TILE_SIZE - 2;
    sprite.position.set((x + 0.5) * TILE_SIZE, baseY);
    sprite.zIndex = baseY;
    this.props.push(sprite);
  }

  private anyNeighbor(x: number, y: number, pred: InsideFn): boolean {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if ((dx !== 0 || dy !== 0) && pred(x + dx, y + dy)) return true;
      }
    }
    return false;
  }

  /** Escolhe a peça do blob para o tile (x,y) dado o predicado "dentro da região". */
  private blobPiece(blob: BlobSet, x: number, y: number, inside: InsideFn): Texture {
    const n = inside(x, y - 1), s = inside(x, y + 1);
    const w = inside(x - 1, y), e = inside(x + 1, y);
    const nw = inside(x - 1, y - 1), ne = inside(x + 1, y - 1);
    const sw = inside(x - 1, y + 1), se = inside(x + 1, y + 1);

    // runs de 1 tile de largura (cápsulas)
    if (!n && !s) {
      if (!e && !w) return blob.island;
      if (e && w) return blob.hM;
      return e ? blob.hL : blob.hR;
    }
    if (!e && !w) {
      if (n && s) return blob.vMid;
      return s ? blob.vTop : blob.vBot;
    }

    // 9-slice
    if (!n) {
      if (!w) return blob.tl;
      if (!e) return blob.tr;
      return blob.t;
    }
    if (!s) {
      if (!w) return blob.bl;
      if (!e) return blob.br;
      return blob.b;
    }
    if (!w) return blob.l;
    if (!e) return blob.r;

    // interior: cantos internos pelos diagonais
    const missing = [!nw, !ne, !sw, !se].filter(Boolean).length;
    if (missing >= 2) return blob.cross;
    if (!nw) return blob.iNW;
    if (!ne) return blob.iNE;
    if (!sw) return blob.iSW;
    if (!se) return blob.iSE;
    return blob.c;
  }

  /** Anima a água. Chamar a cada frame do ticker. */
  animate(dt: number): void {
    this.waterTimer += dt;
    if (this.waterTimer < WATER_FRAME_S) return;
    this.waterTimer %= WATER_FRAME_S;
    this.waterFrame = (this.waterFrame + 1) % this.ts.water.length;
    const tex = this.ts.water[this.waterFrame];
    for (const sprite of this.waterSprites) sprite.texture = tex;
  }
}
