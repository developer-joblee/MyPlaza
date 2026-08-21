import { Assets, Graphics, Rectangle, Sprite, Spritesheet, Texture } from 'pixi.js';
import { TILE_SIZE, TileType, isSolid, isWallLike, type ScenarioId, type WorldMap } from '@together/shared';
import { AnimatedProp } from './AnimatedProp';
import { TilemapBase } from './TilemapBase';
import {
  ANIMATED_SPECS,
  SCENARIO_THEMES,
  type AnimatedName,
  type ScenarioTheme,
  type WallArtRef,
} from './scenarioThemes';

const NAVY = 0x2b2b45;
const CAP_WHITE = 0xf2f1ed;

/** Hash determinístico para variação estável entre clients. */
function hash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return (h ^ (h >> 16)) >>> 0;
}

/** Tudo de que o renderer precisa: o atlas fatiado + as animações em quadros. */
export interface TileArt {
  sheet: Spritesheet;
  anim: Record<AnimatedName, Texture[]>;
}

let cached: TileArt | null = null;

/**
 * O atlas de tiles (um PNG + um JSON com os frames por nome) e as tiras de
 * animação, gerados por `npm run atlas` a partir das sheets master do pack
 * pago (ver `scripts/build-atlas.mjs` — as masters não podem ser carregadas
 * direto: a de interiores tem 34048px de altura, acima do MAX_TEXTURE_SIZE de
 * muitas GPUs). O `Assets.load` do JSON baixa o PNG junto e devolve a
 * `Spritesheet` fatiada; as tiras são recortadas aqui pelos `ANIMATED_SPECS`.
 */
export async function loadTileArt(): Promise<TileArt> {
  if (cached) return cached;
  const names = Object.keys(ANIMATED_SPECS) as AnimatedName[];
  const sheet = await Assets.load<Spritesheet>('/tiles/modern/furniture.json');
  sheet.textureSource.scaleMode = 'nearest'; // pixel art nítida
  const strips = await Promise.all(names.map((n) => Assets.load<Texture>(ANIMATED_SPECS[n].url)));
  const anim = {} as Record<AnimatedName, Texture[]>;
  names.forEach((name, i) => {
    const spec = ANIMATED_SPECS[name];
    const strip = strips[i];
    strip.source.scaleMode = 'nearest';
    // uma tira trocada (outro objeto no lugar) falharia em silêncio — a conta
    // de quadros é a única pista de que o PNG não é o esperado
    if (strip.width % spec.frameW !== 0 || strip.height !== spec.frameH) {
      throw new Error(
        `Tira "${name}" tem ${strip.width}x${strip.height} — esperado largura múltipla de ${spec.frameW} e altura ${spec.frameH}. Rode npm run atlas?`,
      );
    }
    anim[name] = Array.from({ length: strip.width / spec.frameW }, (_, f) =>
      new Texture({
        source: strip.source,
        frame: new Rectangle(f * spec.frameW, 0, spec.frameW, spec.frameH),
      }),
    );
  });
  cached = { sheet, anim };
  return cached;
}

/**
 * Renderer de cenário (32px nativo, escala 1), orientado a dados: a arte vem
 * do tema do cenário (`scenarioThemes.ts`), os frames vêm do atlas. Paredes
 * estilo Gather: face de 2 tiles nas paredes viradas para o sul (entra no
 * y-sort e oclui players atrás), "teto" branco com contorno navy nas demais.
 * Móveis são props y-sorted; tapetes/pisos na camada chão.
 */
export class ModernTilemap extends TilemapBase {
  private theme: ScenarioTheme;

  constructor(
    map: WorldMap,
    private art: TileArt,
    scenarioId: ScenarioId,
  ) {
    super(map);
    this.theme = SCENARIO_THEMES[scenarioId];
    this.build();
  }

  /**
   * Frame do atlas por nome. Falha ALTO se o nome não existir: o erro barato
   * no boot ("frame faltando") é melhor que o caro de produção (móvel
   * invisível que ninguém nota até esbarrar em colisão sem sprite).
   */
  private tex(name: string): Texture {
    const t = this.art.sheet.textures[name];
    if (!t) throw new Error(`Atlas de tiles não tem o frame "${name}" — rode npm run atlas?`);
    return t;
  }

  private isWallAt(x: number, y: number): boolean {
    const t = this.tileAt(x, y);
    return t === null || isWallLike(t);
  }

  private floorTexFor(t: TileType): Texture {
    switch (t) {
      case TileType.FloorLounge:
        return this.tex(this.theme.floors.lounge);
      case TileType.FloorMeeting:
        return this.tex(this.theme.floors.meeting);
      case TileType.FloorKitchen:
        return this.tex(this.theme.floors.kitchen);
      default:
        return this.tex(this.theme.floors.default);
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
    return this.tex(this.theme.floors.default);
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
    this.view.cacheAsTexture(true);
  }

  // ------------------------------------------------------------- paredes

  private buildWall(x: number, y: number, t: TileType): void {
    const southOpen = y + 1 < this.map.rows && !this.isWallAt(x, y + 1);

    if (southOpen) {
      // face de 64px cobre o tile da parede + o de cima, entra no y-sort
      const face = new Sprite(this.tex(this.theme.wallFace));
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

    // decoração fixada na face (janela/quadro/lousa/TV)
    if (t === TileType.Wall) return;
    const ref: WallArtRef =
      t === TileType.WallWindow
        ? this.theme.window
        : t === TileType.WallBoard
          ? this.theme.board
          : this.theme.arts[hash(x, y) % this.theme.arts.length];
    if (typeof ref === 'object') {
      // arte animada (TV): ancorada na base da face, para o quadro — que pode
      // ser mais largo que o tile — ficar rente à parede em vez de invadir o chão
      const prop = this.makeAnimated(ref.anim);
      prop.sprite.anchor.set(0.5, 1);
      prop.sprite.position.set((x + 0.5) * TILE_SIZE, (y + 1) * TILE_SIZE);
      prop.sprite.zIndex = (y + 1) * TILE_SIZE + 1;
      this.props.push(prop.sprite);
      return;
    }
    const decor = new Sprite(this.tex(ref));
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
        const name = h >= 2 ? this.theme.rug3x2 : w >= 3 ? this.theme.rug3x1 : this.theme.rug2x1;
        const rug = new Sprite(this.tex(name));
        rug.anchor.set(0.5);
        rug.position.set((x + w / 2) * TILE_SIZE, (y + h / 2) * TILE_SIZE);
        this.view.addChild(rug);
      }
    }
  }

  private buildFurniture(): void {
    const seen = new Set<string>();
    const th = this.theme;
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
        const pick = (names: readonly string[]): string => names[hash(x, y) % names.length];
        switch (t) {
          case TileType.Sofa: {
            const len = runLen(t);
            this.addProp(len >= 3 ? th.sofaBig : th.sofaSmall, x, y, len);
            break;
          }
          case TileType.Table: {
            const len = runLen(t);
            if (len === 1) {
              this.addProp(th.stool, x, y, 1);
            } else {
              this.addProp(th.longDesk, x, y, len, { stretch: true });
            }
            break;
          }
          case TileType.Shelf: {
            const len = runLen(t);
            this.addProp(pick(th.shelves), x, y, len);
            break;
          }
          case TileType.Desk: {
            const len = runLen(t); // lousa de cavalete (run 2)
            this.addProp(th.easel, x, y, len);
            break;
          }
          case TileType.Counter: {
            const len = runLen(t);
            this.addProp(pick(th.counters), x, y, len);
            break;
          }
          case TileType.Workstation:
            this.addProp(pick(th.workstations), x, y, 1);
            break;
          // A cadeira sentável não sorteia orientação: ela usa o que aponta
          // para o mesmo lado que a pessoa vai ficar virada. Duas cores por
          // orientação, e o hash escolhe só entre elas — girar é trocar o
          // char no mapa.
          case TileType.ChairRight:
            this.addProp(pick(th.chairsRight), x, y, 1);
            break;
          case TileType.ChairLeft:
            this.addProp(pick(th.chairsLeft), x, y, 1);
            break;
          case TileType.Fridge:
            this.addProp(th.fridge, x, y, 1);
            break;
          case TileType.Globe:
            this.addProp(pick(th.globes), x, y, 1);
            break;
          case TileType.Plant:
            this.addProp(pick(th.plants), x, y, 1);
            break;
          case TileType.CoffeeMachine:
            this.addAnimatedProp(th.coffeeMachine, x, y, runLen(t));
            break;
          case TileType.Aquarium: {
            const len = runLen(t); // 2 tiles em run (`AA`) = um aquário
            this.addAnimatedProp(th.aquarium, x, y, len);
            break;
          }
          default:
            break;
        }
      }
    }
  }

  private addProp(
    frameName: string,
    tileX: number,
    tileY: number,
    runLen: number,
    opts: { stretch?: boolean } = {},
  ): void {
    const tex = this.tex(frameName);
    const sprite = new Sprite(tex);
    if (opts.stretch) {
      sprite.width = runLen * TILE_SIZE;
      sprite.height = tex.height * ((runLen * TILE_SIZE) / tex.width);
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

  /** Cria o prop e o registra para o `animate` do `TilemapBase` avançar. */
  private makeAnimated(name: AnimatedName): AnimatedProp {
    const spec = ANIMATED_SPECS[name];
    const prop = new AnimatedProp(this.art.anim[name], spec.frameS, spec.loop);
    this.animatedProps.push(prop);
    return prop;
  }

  /** Como `addProp`, mas animado: mesma âncora, mesmo y-sort. */
  private addAnimatedProp(name: AnimatedName, tileX: number, tileY: number, runLen: number): void {
    const prop = this.makeAnimated(name);
    const sprite = prop.sprite;
    sprite.anchor.set(0.5, 1);
    const baseY = (tileY + 1) * TILE_SIZE - 1;
    sprite.position.set((tileX + runLen / 2) * TILE_SIZE, baseY);
    sprite.zIndex = baseY;
    this.props.push(sprite);
  }
}
