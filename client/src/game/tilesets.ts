import { Assets, Rectangle, Texture } from 'pixi.js';

/**
 * Peças de um tileset "blob" do Sprout Lands (Grass.png e Tilled_Dirt_Wide_v2
 * compartilham o mesmo layout): 9-slice + cápsulas 1-tile + cantos internos.
 */
export interface BlobSet {
  tl: Texture; t: Texture; tr: Texture;
  l: Texture; c: Texture; r: Texture;
  bl: Texture; b: Texture; br: Texture;
  vTop: Texture; vMid: Texture; vBot: Texture;
  hL: Texture; hM: Texture; hR: Texture;
  island: Texture; cross: Texture;
  /** canto interno: falta o diagonal indicado */
  iNW: Texture; iNE: Texture; iSW: Texture; iSE: Texture;
}

export interface Tilesets {
  grassPlain: Texture[];
  grassDecor: Texture[];
  grassBlob: BlobSet;
  dirtBlob: BlobSet;
  water: Texture[];
  /** índice = bitmask de vizinhos cerca: U=1 R=2 D=4 L=8 */
  fence: Texture[];
  trees: Texture[];
  bush: Texture;
  rock: Texture;
  sunflower: Texture;
  flowers: Texture[];
  table: Texture;
  chairs: Texture[];
  rugBig: Texture;
  rugsSmall: Texture[];
  house: Texture;
  bridgeH: Texture;
}

const T16 = 16;

function px(sheet: Texture, x: number, y: number, w: number, h: number): Texture {
  return new Texture({ source: sheet.source, frame: new Rectangle(x, y, w, h) });
}

/** Recorta uma célula do grid 16px. */
function cell(sheet: Texture, cx: number, cy: number): Texture {
  return px(sheet, cx * T16, cy * T16, T16, T16);
}

function makeBlob(sheet: Texture): BlobSet {
  return {
    tl: cell(sheet, 0, 0), t: cell(sheet, 1, 0), tr: cell(sheet, 2, 0),
    l: cell(sheet, 0, 1), c: cell(sheet, 1, 1), r: cell(sheet, 2, 1),
    bl: cell(sheet, 0, 2), b: cell(sheet, 1, 2), br: cell(sheet, 2, 2),
    vTop: cell(sheet, 3, 0), vMid: cell(sheet, 3, 1), vBot: cell(sheet, 3, 2),
    hL: cell(sheet, 0, 3), hM: cell(sheet, 1, 3), hR: cell(sheet, 2, 3),
    island: cell(sheet, 1, 4), cross: cell(sheet, 5, 1),
    iSE: cell(sheet, 4, 0), iSW: cell(sheet, 6, 0),
    iNE: cell(sheet, 4, 2), iNW: cell(sheet, 6, 2),
  };
}

let cached: Tilesets | null = null;

export async function loadTilesets(): Promise<Tilesets> {
  if (cached) return cached;
  const names = [
    'grass', 'dirt', 'water', 'fences', 'biome', 'furniture', 'house', 'bridge',
  ] as const;
  const sheets = Object.fromEntries(
    await Promise.all(
      names.map(async (n) => [n, await Assets.load<Texture>(`/tiles/${n}.png`)] as const),
    ),
  ) as Record<(typeof names)[number], Texture>;
  for (const s of Object.values(sheets)) s.source.scaleMode = 'nearest';

  const { grass, dirt, water, fences, biome, furniture, house, bridge } = sheets;

  // cerca: tabela bitmask (U=1 R=2 D=4 L=8) -> célula (cx, cy)
  const fenceCells: Array<[number, number]> = [
    [0, 3], // 0  isolada
    [0, 2], // 1  U
    [1, 3], // 2  R
    [1, 2], // 3  U|R
    [0, 0], // 4  D
    [0, 1], // 5  U|D
    [1, 0], // 6  R|D
    [1, 1], // 7  U|R|D
    [3, 3], // 8  L
    [3, 2], // 9  U|L
    [2, 3], // 10 R|L
    [2, 2], // 11 U|R|L
    [3, 0], // 12 D|L
    [3, 1], // 13 U|D|L
    [2, 0], // 14 R|D|L
    [2, 1], // 15 todas
  ];

  cached = {
    grassPlain: [cell(grass, 0, 5), cell(grass, 1, 5), cell(grass, 2, 5)],
    grassDecor: [cell(grass, 3, 5), cell(grass, 4, 5), cell(grass, 5, 5), cell(grass, 3, 6), cell(grass, 4, 6)],
    grassBlob: makeBlob(grass),
    dirtBlob: makeBlob(dirt),
    water: [cell(water, 0, 0), cell(water, 1, 0), cell(water, 2, 0), cell(water, 3, 0)],
    fence: fenceCells.map(([cx, cy]) => cell(fences, cx, cy)),
    // bboxes medidas por varredura de alpha das sheets
    trees: [px(biome, 52, 1, 24, 31), px(biome, 20, 1, 24, 31)],
    bush: px(biome, 64, 49, 16, 14),
    rock: px(biome, 128, 18, 16, 12),
    sunflower: px(biome, 128, 34, 16, 45),
    flowers: [
      px(biome, 114, 37, 11, 9),
      px(biome, 99, 39, 9, 6),
      px(biome, 114, 52, 11, 9),
      px(biome, 100, 4, 10, 11),
    ],
    table: px(furniture, 49, 49, 14, 14),
    chairs: [px(furniture, 67, 33, 10, 13), px(furniture, 83, 33, 10, 13), px(furniture, 99, 33, 10, 13)],
    rugBig: px(furniture, 0, 82, 48, 13),
    rugsSmall: [px(furniture, 52, 82, 24, 13), px(furniture, 84, 82, 24, 13), px(furniture, 116, 82, 24, 13)],
    house: px(house, 0, 0, 48, 48),
    bridgeH: px(bridge, 34, 0, 43, 32),
  };
  return cached;
}
