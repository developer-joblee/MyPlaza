import { TILE_SIZE } from './constants';

/**
 * Vocabulário de tiles do Estúdio (Modern Interiors, by LimeZu) — o único
 * estilo do projeto.
 *
 * Os valores são de uso interno: nada é gravado no banco nem transmitido pela
 * rede em termos de `TileType` (posição vai em pixels), e client e server
 * constroem o mapa da MESMA fonte, este módulo. Então renumerar aqui é seguro —
 * foi o que se fez ao remover os tiles dos três cenários antigos (Praça,
 * Ruínas e o Escritório procedural), que deixaram buracos no enum.
 */
export enum TileType {
  // pisos caminháveis
  Floor = 0,
  FloorLounge = 1,
  FloorMeeting = 2,
  FloorKitchen = 3,
  Rug = 4,
  // paredes (ver `isWallLike`)
  Wall = 5,
  WallWindow = 6,
  WallArt = 7,
  WallBoard = 8,
  // móveis e props
  Table = 9,
  Chair = 10,
  Desk = 11,
  Plant = 12,
  Workstation = 13,
  Sofa = 14,
  Shelf = 15,
  Counter = 16,
  Fridge = 17,
  Globe = 18,
  /**
   * Cadeiras com orientação, e por isso sentáveis. Só existem de perfil porque
   * a arte de sentar do pack só tem perfil — ver `characterDefs.ts`. `Chair`
   * (sem orientação) continua existindo para as cadeiras decorativas, como as
   * de frente para a câmera.
   */
  ChairLeft = 19,
  ChairRight = 20,
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
    case TileType.Table:
    case TileType.Chair:
    case TileType.ChairLeft:
    case TileType.ChairRight:
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

/**
 * Distância em pixels do mundo entre duas posições.
 *
 * Trivial, e é justamente por isso que estava copiada: `Math.hypot` inline no
 * `Game` (duas vezes) e um terceiro lugar quando o servidor passou a precisar
 * saber quem está perto para entregar um som do soundboard. Uma verdade só sobre
 * "perto" — o mesmo movimento que `audioZoneAt` já sofreu, pela mesma razão:
 * servidor e cliente não podem discordar sobre a geometria.
 */
export function distancePx(ax: number, ay: number, bx: number, by: number): number {
  return Math.hypot(bx - ax, by - ay);
}
