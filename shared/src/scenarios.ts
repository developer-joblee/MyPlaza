import { TileType, buildMap, type WorldMap } from './map';

/**
 * Cenários disponíveis — todos do MESMO estilo de arte (Modern Interiors +
 * Modern Office, by LimeZu; um renderer só, temas em
 * `client/src/game/scenarioThemes.ts`). O projeto já teve mapas de três packs
 * diferentes e ficou num estilo só em 2026-08-21; `office` e `cafe` entraram
 * no mesmo dia, já no estilo unificado. União de propósito: mapa novo é uma
 * entrada nova aqui, e o resto (lobby, banco, seletor de tela) trata a lista
 * como plural.
 */
export type ScenarioId = 'studio' | 'office' | 'cafe';

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

export const DEFAULT_SCENARIO: ScenarioId = 'studio';

/**
 * Estúdio 36x24 (assets Modern Interiors, by LimeZu).
 * Paredes: `#` cega, `w` janela, `q` quadro/TV, `b` lousa de parede.
 * Pisos: `.` cinza, `h` carpete espinha-de-peixe (lounge), `t` azulejo
 * verde-água (reunião), `k` azulejo amarelo (copa), `r` tapete (caminhável).
 * Móveis: `s` sofá (run 2-3), `W` workstation (mesa+cadeira), `o` mesa
 * longa (run 4), `T` banqueta-mesa, `E` estante (run 2),
 * `L` lousa de cavalete (run 2), `K` balcão (run 2), `G` geladeira,
 * `g` globo, `P` planta.
 *
 * Cadeiras: `>` e `<` são **sentáveis** e o caractere aponta para onde a pessoa
 * fica virada. Como a arte de sentar do pack só tem perfil, as mesas ficam com
 * cadeira nas laterais (`>oooo<`, `>T<`) em vez de acima e abaixo — girar uma
 * cadeira é trocar o caractere. `c` seria a cadeira decorativa, sem sentar.
 */
const STUDIO_ROWS = [
  '####ww####ww####ww##########b#######',
  '#hhhhhhhh...............#tttttttLLt#',
  '#hhhhhhhh...............#tgtttttttt#',
  '#hssshhhh...W...W...W...#tt>oooo<tt#',
  '#hrrrhhhh...............#tttttttttt#',
  '#hrrrhhhh...............#tt>T<>T<tt#',
  '#hsshhhhh...............#tttttttttP#',
  '#hhhhhhhh...W...W...W...#tttttttttt#',
  '#hhhhhhhh...............##q##..#####',
  '#P..............................AA.#',
  '#..................................#',
  '#..........W...W...W...W...W.......#',
  '#..................................#',
  '#.................................P#',
  '#........................#.........#',
  '#........................#####..####',
  '#........................#kkkkkCKKG#',
  '#.g......................#kkkkkkkkk#',
  '#........................#kk>T<kkkk#',
  '#........................#kkkkkkkkk#',
  '#..rr....................#kkkkkkkkk#',
  '#........................#kkkkkkkkk#',
  '#.P........EE..EE........#Pkkkkkkkk#',
  '####################################',
];

/**
 * A legenda é UMA para todos os cenários (o vocabulário de tiles é o mesmo; o
 * que muda por cenário é a arte, via tema). Um cenário pode não usar um
 * caractere — a legenda maior não custa nada.
 */
const MODERN_CHAR_TO_TILE: Readonly<Record<string, TileType>> = {
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
  '>': TileType.ChairRight,
  '<': TileType.ChairLeft,
  E: TileType.Shelf,
  L: TileType.Desk,
  K: TileType.Counter,
  G: TileType.Fridge,
  g: TileType.Globe,
  P: TileType.Plant,
  C: TileType.CoffeeMachine,
  A: TileType.Aquarium,
};

/**
 * Escritório 40x24: recepção com sofás à esquerda, open space de workstations,
 * sala de reunião no topo direito e copa embaixo à direita (as duas são zonas).
 * No tema do office, `g` desenha impressora, `G` máquina de venda e `b`/`L` o
 * quadro branco.
 */
const OFFICE_ROWS = [
  '####ww####ww####ww####ww##ww####b#######',
  '#......................#ttttttttttttLLt#',
  '#..W...W...W...W.......#tgttttttttttttt#',
  '#......................#tt>oooo<ttttttt#',
  '#..W...W...W...W.......#ttttttttttttttt#',
  '#......................#tt>T<>T<ttttttt#',
  '#..W...W...W...W.......#tttttttttttttPt#',
  '#......................#ttttttttttttttt#',
  '#......................###q##..#########',
  '#......................................#',
  '#..W...W...W...W...W...W............P.g#',
  '#......................................#',
  '#..W...W...W...W...W...W.............g.#',
  '#......................................#',
  '#.ss.rr................................#',
  '#.ss.rr...................####..########',
  '#.........................#kkkkkkkKKGCk#',
  '#.........................#kkkkkkkkkkkk#',
  '#.........................#kk>T<kkkkkkk#',
  '#.........................#kkkkkkkkkkkk#',
  '#.EE..EE..................#kkkkkkkkkkkk#',
  '#.........................#kkGkkkkkkkkk#',
  '#.P.......................#Pkkkkkkkkkkk#',
  '########################################',
];

/**
 * Café 30x20: balcão com estação de café ao fundo à esquerda (cozinha em piso
 * claro atrás), mesas com banquetas no salão (piso de madeira), lounge de
 * sofás embaixo e uma sala reservada no topo direito (zona), com piso quente.
 */
const CAFE_ROWS = [
  '####ww####ww####ww####ww######',
  '#...................#hhhhhhhh#',
  '#...................#hsshhhhh#',
  '#...................#hhhhhhhh#',
  '#...................#h>T<hhhh#',
  '#...................#hhhhhhhP#',
  '#....................#####..##',
  '#............................#',
  '#kkkkkkkk....................#',
  '#kkCGkkkk....................#',
  '#KKLLKKkk....................#',
  '#............................#',
  '#..>T<...>T<...>T<...........#',
  '#............................#',
  '#..>T<...>T<...>T<......rr...#',
  '#............................#',
  '#.ss......................P..#',
  '#.ss.........................#',
  '#.P..........................#',
  '##############################',
];

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  studio: {
    id: 'studio',
    label: 'Estúdio',
    description: 'Escritório moderno',
    rows: STUDIO_ROWS,
    charToTile: MODERN_CHAR_TO_TILE,
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
  office: {
    id: 'office',
    label: 'Escritório',
    description: 'Open space com reunião e copa',
    rows: OFFICE_ROWS,
    charToTile: MODERN_CHAR_TO_TILE,
    defaultTile: TileType.Floor,
    // corredor livre da recepção (linhas 9 e 11 são todas de piso)
    spawnTiles: [
      [2, 9], [3, 9], [4, 9], [2, 11], [3, 11], [4, 11],
    ],
    // mesmas regras do Estúdio: o retângulo cobre o piso E a linha da porta
    audioZones: [
      { id: 'reuniao', label: 'Sala de reunião', rect: [23, 1, 39, 8] },
      { id: 'copa', label: 'Copa', rect: [26, 15, 39, 22] },
    ],
  },
  cafe: {
    id: 'cafe',
    label: 'Café',
    description: 'Balcão, mesas e sala reservada',
    rows: CAFE_ROWS,
    charToTile: MODERN_CHAR_TO_TILE,
    defaultTile: TileType.Floor,
    // salão, na frente das mesas
    spawnTiles: [
      [12, 17], [13, 17], [14, 17], [12, 18], [13, 18], [14, 18],
    ],
    audioZones: [{ id: 'reservada', label: 'Sala reservada', rect: [20, 1, 29, 6] }],
  },
};

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && v in SCENARIOS;
}

export function parseMap(id: ScenarioId): WorldMap {
  const def = SCENARIOS[id];
  return buildMap(def.rows, def.charToTile, def.defaultTile, id);
}
