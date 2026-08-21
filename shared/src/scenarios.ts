import { TileType, buildMap, type WorldMap } from './map';

/**
 * Cenários disponíveis. Hoje só o **Estúdio**: o projeto usou por um tempo mais
 * três mapas de packs diferentes (Praça/Sprout Lands, Ruínas/Cainos e um
 * Escritório procedural) e eles saíram quando se decidiu ficar num estilo só —
 * o Modern Interiors, do LimeZu. Continua sendo uma união de propósito: mapa
 * novo é uma entrada nova aqui, e todo o resto (lobby, banco, seletor de tela)
 * já trata a lista como plural.
 */
export type ScenarioId = 'studio';

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
  '#P.................................#',
  '#..................................#',
  '#..........W...W...W...W...W.......#',
  '#..................................#',
  '#.................................P#',
  '#..................................#',
  '#........................#####..####',
  '#........................#kkkkkkKKG#',
  '#.g......................#kkkkkkkkk#',
  '#........................#kk>T<kkkk#',
  '#........................#kkkkkkkkk#',
  '#..rr....................#kkkkkkkkk#',
  '#........................#kkkkkkkkk#',
  '#.P........EE..EE........#Pkkkkkkkk#',
  '####################################',
];

export const SCENARIOS: Record<ScenarioId, ScenarioDef> = {
  studio: {
    id: 'studio',
    label: 'Estúdio',
    description: 'Escritório moderno',
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
      '>': TileType.ChairRight,
      '<': TileType.ChairLeft,
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
};

export function isScenarioId(v: unknown): v is ScenarioId {
  return typeof v === 'string' && v in SCENARIOS;
}

export function parseMap(id: ScenarioId): WorldMap {
  const def = SCENARIOS[id];
  return buildMap(def.rows, def.charToTile, def.defaultTile, id);
}
