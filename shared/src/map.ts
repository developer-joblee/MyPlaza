import { TILE_SIZE } from './constants';

export enum TileType {
  Floor = 0,
  Wall = 1,
  Desk = 2,
  Table = 3,
  Plant = 4,
  Carpet = 5,
}

const CHAR_TO_TILE: Record<string, TileType> = {
  '.': TileType.Floor,
  '#': TileType.Wall,
  D: TileType.Desk,
  T: TileType.Table,
  P: TileType.Plant,
  ',': TileType.Carpet,
};

/**
 * Escritório 30x20. `#` parede, `.` chão, `,` carpete (lounge/reunião),
 * `D` mesa de trabalho, `T` mesa de reunião, `P` planta.
 */
const MAP_ROWS = [
  '##############################',
  '#,,,,,,.......#..............#',
  '#,,,,,,.......#....TTTT......#',
  '#,,,,,,.......#....TTTT......#',
  '#..............,.............#',
  '#.............#..............#',
  '######..######......P........#',
  '#.............######..########',
  '#..DD...DD....#..............#',
  '#..DD...DD....#...,,,,,,,,...#',
  '#.............#...,,TTTT,,...#',
  '#..DD...DD.......,,TTTT,,....#',
  '#..DD...DD....#...,,,,,,,,...#',
  '#.............#..............#',
  '######..############..########',
  '#.............#..............#',
  '#..DD...DD............DD.....#',
  '#..DD...DD....#......DD......#',
  '#......P......#..........P...#',
  '##############################',
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
    return [...row].map((ch) => CHAR_TO_TILE[ch] ?? TileType.Floor);
  });
  return { cols, rows, widthPx: cols * TILE_SIZE, heightPx: rows * TILE_SIZE, tiles };
}

export function isSolid(tile: TileType): boolean {
  return (
    tile === TileType.Wall ||
    tile === TileType.Desk ||
    tile === TileType.Table ||
    tile === TileType.Plant
  );
}

/** Tiles (col, row) onde novos players nascem — área do lounge. */
export const SPAWN_TILES: ReadonlyArray<readonly [number, number]> = [
  [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [5, 2], [5, 3],
];
