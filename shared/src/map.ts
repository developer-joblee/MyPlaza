import { TILE_SIZE } from './constants';

export enum TileType {
  // Praça (Sprout Lands)
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
  // Escritório (render procedural)
  Floor = 14,
  Wall = 15,
  Desk = 16,
  Plant = 17,
  Carpet = 18,
  // Estúdio (Modern Interiors)
  FloorLounge = 19,
  FloorMeeting = 20,
  FloorKitchen = 21,
  Workstation = 22,
  Sofa = 23,
  Shelf = 24,
  Counter = 25,
  Fridge = 26,
  Globe = 27,
  WallWindow = 28,
  WallArt = 29,
  WallBoard = 30,
  /**
   * Cadeiras com orientação, e por isso sentáveis. Só existem de perfil porque
   * a arte de sentar do pack só tem perfil — ver `characterDefs.ts`. `Chair`
   * (sem orientação) continua existindo para as cadeiras decorativas, como as
   * de frente para a câmera.
   */
  ChairLeft = 31,
  ChairRight = 32,
}

/** Tiles que se comportam como parede (cap + face no tema modern). */
export function isWallLike(tile: TileType): boolean {
  return (
    tile === TileType.Wall ||
    tile === TileType.WallWindow ||
    tile === TileType.WallArt ||
    tile === TileType.WallBoard
  );
}

/**
 * Para que lado alguém sentado nesta cadeira fica virado, ou `null` se não dá
 * para sentar aqui. É a **única** fonte da direção de quem senta: o cliente usa
 * para escolher a pose e o servidor para validar o pedido, então os dois
 * concordam sem precisar transmitir direção nenhuma pela rede.
 */
export function sitFacingAt(tile: TileType): 'left' | 'right' | null {
  if (tile === TileType.ChairLeft) return 'left';
  if (tile === TileType.ChairRight) return 'right';
  return null;
}

export interface WorldMap {
  cols: number;
  rows: number;
  widthPx: number;
  heightPx: number;
  tiles: TileType[][];
}

export function buildMap(
  rows: readonly string[],
  charToTile: Readonly<Record<string, TileType>>,
  defaultTile: TileType,
  mapName: string,
): WorldMap {
  const rowCount = rows.length;
  const cols = rows[0].length;
  const tiles: TileType[][] = rows.map((row, y) => {
    if (row.length !== cols) {
      throw new Error(`Mapa '${mapName}': linha ${y} tem ${row.length} colunas, esperado ${cols}`);
    }
    return [...row].map((ch) => charToTile[ch] ?? defaultTile);
  });
  return { cols, rows: rowCount, widthPx: cols * TILE_SIZE, heightPx: rowCount * TILE_SIZE, tiles };
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
    case TileType.ChairLeft:
    case TileType.ChairRight:
    case TileType.House:
    case TileType.Wall:
    case TileType.Desk:
    case TileType.Plant:
    case TileType.Workstation:
    case TileType.Sofa:
    case TileType.Shelf:
    case TileType.Counter:
    case TileType.Fridge:
    case TileType.Globe:
    case TileType.WallWindow:
    case TileType.WallArt:
    case TileType.WallBoard:
      return true;
    default:
      return false;
  }
}
