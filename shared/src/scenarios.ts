import { TileType, buildMap, type WorldMap } from './map';

export type ScenarioId = 'office' | 'plaza' | 'ruins' | 'studio';

/**
 * Zona de áudio: dentro dela só se ouve quem também está dentro. Quem está
 * fora não ouve nada do que se fala lá, nem colado na parede — para ouvir,
 * precisa entrar.
 *
 * Para criar uma zona num mapa novo: desenhe um retângulo que cubra o piso da
 * sala **e a porta**. Incluir a porta é de propósito — quem para na soleira
 * conta como dentro, o que evita um limbo onde ninguém se ouve. As paredes
 * dentro do retângulo não incomodam, porque não são caminháveis.
 */
export interface AudioZone {
  /** curto e estável; aparece no diagnóstico */
  id: string;
  /** nome exibido para o jogador */
  label: string;
  /** retângulo em tiles, INCLUSIVO: [colInicial, linhaInicial, colFinal, linhaFinal] */
  rect: readonly [number, number, number, number];
}

export interface ScenarioDef {
  id: ScenarioId;
  label: string;
  description: string;
  theme: 'office' | 'garden' | 'ruins' | 'modern';
  rows: readonly string[];
  charToTile: Readonly<Record<string, TileType>>;
  defaultTile: TileType;
  spawnTiles: ReadonlyArray<readonly [number, number]>;
  /** Sem zonas (ou lista vazia) = o cenário todo funciona por proximidade. */
  audioZones?: readonly AudioZone[];
}

/**
 * Em que zona está este tile — `null` significa área aberta, onde vale a
 * proximidade normal. Duas pessoas se ouvem quando o resultado disto é igual
 * para as duas (inclusive quando é `null` nas duas: ambas na área aberta).
 */
export function audioZoneAt(
  scenarioId: ScenarioId,
  tileX: number,
  tileY: number,
): AudioZone | null {
  for (const zone of SCENARIOS[scenarioId].audioZones ?? []) {
    const [x0, y0, x1, y1] = zone.rect;
    if (tileX >= x0 && tileX <= x1 && tileY >= y0 && tileY <= y1) return zone;
  }
  return null;
}

export const DEFAULT_SCENARIO: ScenarioId = 'plaza';

/**
 * Escritório 30x20. `#` parede, `.` chão, `,` carpete (lounge/reunião),
 * `D` mesa de trabalho, `T` mesa de reunião, `P` planta.
 */
const OFFICE_ROWS = [
  '##############################',
  '#,,,,,,.......#..............#',
  '#,,,,,,.......#....TTTT......#',
  '#,,,,,,.......#....TTTT......#',
  '#............................#',
  '#.............#..............#',
  '######..#######....P.........#',
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

/**
 * Praça da equipe, 40x26 (assets Sprout Lands, by Cup Nooble).
 * `#` cerca, `.` grama, `~` água, `=` ponte, `-` trilha de terra,
 * `T` árvore, `B` arbusto, `R` pedra, `F` flores (caminhável),
 * `S` girassol, `o` mesa, `c` cadeira, `r` tapete (caminhável),
 * `H` casinha (footprint sólido; o sprite se estende para cima).
 */
const PLAZA_ROWS = [
  '########################################',
  '#..............................~~~.....#',
  '#..T........................T..~~~.F...#',
  '#..............................~~~..T..#',
  '#..............................~~~.....#',
  '#..HHH.........................~~~.....#',
  '#.........---------------------===.....#',
  '#..rrr..S.-....................===.rr..#',
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
  '#...~~~........rr..............~~~.....#',
  '#...~~~~......rr...............~~~..R..#',
  '#....~~~.......................~~~.....#',
  '#...................T..........~~~.....#',
  '#..B...........................~~~...T.#',
  '#..............................~~~.....#',
  '########################################',
];

/**
 * Ruínas 58x70 (assets Pixel Art Top Down - Basic, by Cainos).
 * O visual é a própria cena do pack ("Scene Overview") renderizada como
 * imagem de chão, desenhada em 2x — a arte é de 16px/tile, então 1 tile de
 * arte = 1 célula desta grade = TILE_SIZE na tela, como nos outros cenários.
 * Esta grade define somente colisão: `#` sólido, `.` livre. Foi derivada por
 * template matching de cada tile da cena contra os tilesets do pack (grama e
 * pedra = livre; muro, props e estruturas = sólido), com as escadarias e o
 * vão do arco liberados e as bases dos props altos marcadas sólidas.
 */
const RUINS_ROWS = [
  '##########################################################',
  '##########################################################',
  '######################.######........#####################',
  '#####################...#####...###..#####################',
  '####################....###...#####....###################',
  '####################.....##...######...###################',
  '####################.....##...######...###################',
  '###################......##............#...###############',
  '#################.....#....####....####.....##############',
  '#################....###...####....####.....##############',
  '#################....###...####....####...#..#############',
  '#################...........###....###...#...#############',
  '#################.........###...............##############',
  '#################.........###...........##################',
  '#################.......................####...###########',
  '#################..............................###########',
  '###########....................................###########',
  '###########....................................###########',
  '###########....###.............................###########',
  '###########....###.............................###########',
  '#########........................................#########',
  '#########......................###...............#########',
  '###...###..####.##.###.........###...............#########',
  '##....###..####.######.........###...............#########',
  '##.....##...###.##.###...........................#########',
  '##.....##........................................#########',
  '##.....##............................#..#........#########',
  '###.#####............................#..#........#########',
  '#...##...............................#..#........#########',
  '#..###...............................#..#........#########',
  '#....................######....#####.....####....##......#',
  '#....................######....#####.....####............#',
  '#................##########....#####......###............#',
  '#.................................##.....................#',
  '#............#######.....................................#',
  '#............#######.....................................#',
  '#............#######.....................................#',
  '#..................#.....................................#',
  '#..................#.............................##......#',
  '#..................###.................###.......##......#',
  '#########..........###.................#####.....##......#',
  '#########..........###....................##..........####',
  '#########......##..........#######........##..###.....####',
  '#########......##..........##...##........##..###........#',
  '#########.................................##..############',
  '#########........................................#########',
  '#########........................................#########',
  '#########........................................#########',
  '#########........................................#########',
  '#########................##......................#########',
  '#########................##......................#########',
  '#########..........................###........############',
  '########...........................###........###....#####',
  '######.##............................................#####',
  '#####...######.########################......#######.#####',
  '#####....#####.########################......#######.#####',
  '#####.....####.#######################........##.....#####',
  '#####.....####.....#####.#####...##...........##.....#####',
  '#####................................................#####',
  '#####................................................#####',
  '#####...........................#....................#####',
  '#####................................................#####',
  '############################....#............#############',
  '#############################...........####.#############',
  '#############################.###.......####.#############',
  '#############################...........####.#############',
  '##########################################################',
  '##########################################################',
  '##########################################################',
  '##########################################################',
];

/**
 * Estúdio 36x24 (assets Modern Interiors, by LimeZu).
 * Paredes: `#` cega, `w` janela, `q` quadro/TV, `b` lousa de parede.
 * Pisos: `.` cinza, `h` carpete espinha-de-peixe (lounge), `t` azulejo
 * verde-água (reunião), `k` azulejo amarelo (copa), `r` tapete (caminhável).
 * Móveis: `s` sofá (run 2-3), `W` workstation (mesa+cadeira), `o` mesa
 * longa (run 4), `T` banqueta-mesa, `c` cadeira, `E` estante (run 2),
 * `L` lousa de cavalete (run 2), `K` balcão (run 2), `G` geladeira,
 * `g` globo, `P` planta.
 */
const STUDIO_ROWS = [
  '####ww####ww####ww##########b#######',
  '#hhhhhhhh...............#tttttttLLt#',
  '#hhhhhhhh...............#tgtttttttt#',
  '#hssshhhh...W...W...W...#tttccccttt#',
  '#hrrrhhhh...............#tttoooottt#',
  '#hrrrhhhh...............#tttccccttt#',
  '#hsshhhhh...............#tttttttttP#',
  '#hhhhhhhh...W...W...W...#tttttttttt#',
  '#hhhhhhhh...............##q##..#####',
  '#P.................................#',
  '#..................................#',
  '#..........W...W...W...W...W.......#',
  '#..................................#',
  '#.................................P#',
  '#..................................#',
  '#........................#####..####',
  '#........................#kkkkkkKKG#',
  '#.g......................#kkkkkkkkk#',
  '#........................#kkcTckkkk#',
  '#........................#kkkkkkkkk#',
  '#..rr....................#kkkkkkkkk#',
  '#........................#kkkkkkkkk#',
  '#.P........EE..EE........#Pkkkkkkkk#',
  '####################################',
];

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  office: {
    id: 'office',
    label: 'Escritório',
    description: 'Salas, mesas e lounge',
    theme: 'office',
    rows: OFFICE_ROWS,
    charToTile: {
      '.': TileType.Floor,
      '#': TileType.Wall,
      D: TileType.Desk,
      T: TileType.Table,
      P: TileType.Plant,
      ',': TileType.Carpet,
    },
    defaultTile: TileType.Floor,
    // Área do lounge.
    spawnTiles: [
      [2, 2], [3, 2], [4, 2], [2, 3], [3, 3], [4, 3], [5, 2], [5, 3],
    ],
  },
  plaza: {
    id: 'plaza',
    label: 'Praça',
    description: 'Jardim ao ar livre',
    theme: 'garden',
    rows: PLAZA_ROWS,
    charToTile: {
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
    },
    defaultTile: TileType.Grass,
    // Tapetes em frente à casinha.
    spawnTiles: [
      [3, 7], [4, 7], [5, 7], [3, 8], [4, 8], [5, 8], [3, 9], [4, 9], [5, 9],
    ],
  },
  studio: {
    id: 'studio',
    label: 'Estúdio',
    description: 'Escritório moderno',
    theme: 'modern',
    rows: STUDIO_ROWS,
    charToTile: {
      '.': TileType.Floor,
      h: TileType.FloorLounge,
      t: TileType.FloorMeeting,
      k: TileType.FloorKitchen,
      r: TileType.Rug,
      '#': TileType.Wall,
      w: TileType.WallWindow,
      q: TileType.WallArt,
      b: TileType.WallBoard,
      s: TileType.Sofa,
      W: TileType.Workstation,
      o: TileType.Table,
      T: TileType.Table,
      c: TileType.Chair,
      E: TileType.Shelf,
      L: TileType.Desk,
      K: TileType.Counter,
      G: TileType.Fridge,
      g: TileType.Globe,
      P: TileType.Plant,
    },
    defaultTile: TileType.Floor,
    // Tapete do lounge.
    spawnTiles: [
      [2, 4], [3, 4], [4, 4], [2, 5], [3, 5], [4, 5],
    ],
    /**
     * As duas salas fechadas do Estúdio. Cada retângulo inclui a linha da porta
     * (linha 8 na reunião, linha 15 na copa), então quem para na soleira já
     * conta como dentro.
     *
     * O lounge (piso `h`) de propósito NÃO é zona: ele é só um piso diferente,
     * sem parede separando do open space — acusticamente é o mesmo ambiente.
     */
    audioZones: [
      { id: 'reuniao', label: 'Sala de reunião', rect: [25, 1, 34, 8] },
      { id: 'copa', label: 'Copa', rect: [26, 15, 34, 22] },
    ],
  },
  ruins: {
    id: 'ruins',
    label: 'Ruínas',
    description: 'Ruínas antigas de pedra',
    theme: 'ruins',
    rows: RUINS_ROWS,
    charToTile: {
      '.': TileType.Floor,
      '#': TileType.Wall,
    },
    defaultTile: TileType.Floor,
    // Gramado central aberto, ao sul do muro do meio.
    spawnTiles: [
      [28, 35], [29, 35], [30, 35], [28, 36], [29, 36], [30, 36], [31, 35], [31, 36],
    ],
  },
};

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && v in SCENARIOS;
}

export function parseMap(id: ScenarioId): WorldMap {
  const def = SCENARIOS[id];
  return buildMap(def.rows, def.charToTile, def.defaultTile, id);
}
