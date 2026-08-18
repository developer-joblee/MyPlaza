import { TILE_SIZE } from './constants';

export enum TileType {
  Grass = 0,
  Water = 1,
  Bridge = 2,
  Path = 3,
  Fence = 4,
  Tree = 5,
  Bush = 6,
  Rock = 7,
  Flower = 8,
  Sunflower = 9,
  Table = 10,
  Chair = 11,
  Rug = 12,
  House = 13,
}

const CHAR_TO_TILE: Record<string, TileType> = {
  '.': TileType.Grass,
  '~': TileType.Water,
  '=': TileType.Bridge,
  '-': TileType.Path,
  '#': TileType.Fence,
  T: TileType.Tree,
  B: TileType.Bush,
  R: TileType.Rock,
  F: TileType.Flower,
  S: TileType.Sunflower,
  o: TileType.Table,
  c: TileType.Chair,
  r: TileType.Rug,
  H: TileType.House,
};

/**
 * Jardim da equipe, 40x26 (assets Sprout Lands, by Cup Nooble).
 * `#` cerca, `.` grama, `~` água, `=` ponte, `-` trilha de terra,
 * `T` árvore, `B` arbusto, `R` pedra, `F` flores (caminhável),
 * `S` girassol, `o` mesa, `c` cadeira, `r` tapete (caminhável),
 * `H` casinha (footprint sólido; o sprite se estende para cima).
 */
const MAP_ROWS = [
  '########################################',
  '#..............................~~~.....#',
  '#..T........................T..~~~.F...#',
  '#..............................~~~..T..#',
  '#..............................~~~.....#',
  '#..HHH.........................===.....#',
  '#.........---------------------===.....#',
  '#..rrr..S.-....................~~~.rr..#',
  '#..rrr....-....................~~~.rr..#',
  '#..rrr....-....................~~~.oc..#',
  '#.........-....................~~~.c...#',
  '#.B.......-....T...............~~~.....#',
  '#.........-....................~~~..T..#',
  '#.R.......-.........F..........~~~.....#',
  '#.........-....................~~~.F...#',
  '#.........-....................~~~.....#',
  '#.S.......-..coc..coc..........~~~..B..#',
  '#.........-....................===.....#',
  '#.........---------------------===.F...#',
  '#....~~........rr..............~~~.....#',
  '#...~~~~......rr...............~~~..R..#',
  '#....~~........................~~~.....#',
  '#...................T..........~~~.....#',
  '#..B...........................~~~...T.#',
  '#..............................~~~.....#',
  '########################################',
];

export interface WorldMap {
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  tiles: TileType[][];
}

export function parseMap(): WorldMap {
  const rows = MAP_ROWS.length;
  const cols = MAP_ROWS[0].length;
  const tiles: TileType[][] = MAP_ROWS.map((row, y) => {
    if (row.length !== cols) {
      throw new Error(`Linha ${y} do mapa tem ${row.length} colunas, esperado ${cols}`);
    }
    return [...row].map((ch) => CHAR_TO_TILE[ch] ?? TileType.Grass);
  });
  return { cols, rows, widthPx: cols * TILE_SIZE, heightPx: rows * TILE_SIZE, tiles };
}

export function isSolid(tile: TileType): boolean {
  switch (tile) {
    case TileType.Water:
    case TileType.Fence:
    case TileType.Tree:
    case TileType.Bush:
    case TileType.Rock:
    case TileType.Sunflower:
    case TileType.Table:
    case TileType.Chair:
    case TileType.House:
      return true;
    default:
      return false;
  }
}

/** Tiles (col, row) onde novos players nascem — tapetes em frente à casinha. */
export const SPAWN_TILES: ReadonlyArray<readonly [number, number]> = [
  [3, 7], [4, 7], [5, 7], [3, 8], [4, 8], [5, 8], [3, 9], [4, 9], [5, 9],
];
