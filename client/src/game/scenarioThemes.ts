import type { ScenarioId } from '@together/shared';

/**
 * As tiras de animação do cenário (`/tiles/modern/anim/*.png`, copiadas pelo
 * `npm run atlas`). O recorte é do client: cada tira é uma fileira horizontal
 * de quadros `frameW`x`frameH` — a largura TEM de ser múltipla de `frameW`
 * (validado no load, porque uma tira trocada falharia em silêncio).
 * `loop` opcional: quadros antes dele tocam uma vez (intro).
 */
export interface AnimatedSpec {
  url: string;
  frameW: number;
  frameH: number;
  /** duração de cada quadro, em segundos (o resto do projeto usa frameS, não fps) */
  frameS: number;
  loop?: readonly [number, number];
}

export type AnimatedName = 'coffee' | 'aquarium' | 'tv';

export const ANIMATED_SPECS: Record<AnimatedName, AnimatedSpec> = {
  coffee: { url: '/tiles/modern/anim/coffee.png', frameW: 32, frameH: 64, frameS: 0.22 },
  aquarium: { url: '/tiles/modern/anim/aquarium.png', frameW: 64, frameH: 64, frameS: 0.28 },
  tv: { url: '/tiles/modern/anim/tv.png', frameW: 96, frameH: 64, frameS: 0.24 },
};

/** Arte de parede: um frame do atlas (estática) ou uma animação. */
export type WallArtRef = string | { anim: AnimatedName };

/**
 * A arte de cada cenário: qual frame do atlas (`furniture.json`, gerado por
 * `npm run atlas` a partir de `scripts/atlas.manifest.json`) cada papel usa.
 *
 * O `TileType` (shared) continua semântico — ele decide colisão e sentável nos
 * dois lados. O que muda por cenário é SÓ a arte, e ela mora aqui: um cenário
 * novo é uma entrada nova neste registro (mais os frames no manifest do atlas),
 * sem mexer no `ModernTilemap`.
 *
 * Arrays são variantes: o tilemap sorteia com hash(x,y) determinístico, então
 * todos os clients veem o mesmo móvel em cada tile.
 */
export interface ScenarioTheme {
  floors: {
    default: string;
    lounge: string;
    meeting: string;
    kitchen: string;
  };
  /** faixa de 32x64: friso + face + rodapé, para paredes com o sul aberto */
  wallFace: string;
  window: string;
  board: string;
  arts: readonly WallArtRef[];
  workstations: readonly string[];
  longDesk: string;
  stool: string;
  /** cadeiras por orientação — quem senta olha para o lado que o nome diz */
  chairsRight: readonly string[];
  chairsLeft: readonly string[];
  sofaBig: string;
  sofaSmall: string;
  shelves: readonly string[];
  easel: string;
  counters: readonly string[];
  fridge: string;
  globes: readonly string[];
  plants: readonly string[];
  rug3x2: string;
  rug3x1: string;
  rug2x1: string;
  coffeeMachine: AnimatedName;
  aquarium: AnimatedName;
}

export const SCENARIO_THEMES: Record<ScenarioId, ScenarioTheme> = {
  studio: {
    floors: {
      default: 'floor/gray',
      lounge: 'floor/herringbone',
      meeting: 'floor/teal',
      kitchen: 'floor/yellow',
    },
    wallFace: 'wall/face',
    window: 'studio/window',
    board: 'studio/chalkboard',
    /**
     * O Estúdio tem UM `q` no mapa (a parede sul da sala de reunião), e ele é a
     * TV de telejornal animada. Os quadros estáticos (planner, fogo, praia)
     * continuam no atlas para o dia em que houver mais paredes com arte.
     */
    arts: [{ anim: 'tv' }],
    workstations: ['studio/workstation_1', 'studio/workstation_2'],
    longDesk: 'studio/long_desk',
    stool: 'studio/stool',
    chairsRight: ['studio/chair_right_1', 'studio/chair_right_2'],
    chairsLeft: ['studio/chair_left_1', 'studio/chair_left_2'],
    sofaBig: 'studio/sofa_big',
    sofaSmall: 'studio/sofa_small',
    shelves: ['studio/shelf_1', 'studio/shelf_2'],
    easel: 'studio/easel',
    counters: ['studio/counter_1', 'studio/counter_2'],
    fridge: 'studio/fridge',
    globes: ['studio/globe_1', 'studio/globe_2'],
    plants: ['studio/plant_1', 'studio/plant_2', 'studio/plant_3'],
    rug3x2: 'studio/rug_3x2',
    rug3x1: 'studio/rug_3x1',
    rug2x1: 'studio/rug_2x1',
    coffeeMachine: 'coffee',
    aquarium: 'aquarium',
  },
  /**
   * Escritório: mobília do Estúdio (é um escritório também) com pisos próprios
   * e três papéis ressignificados — `g` vira impressora, `G` máquina de venda e
   * `b` o quadro branco do Modern Office. Os `q` usam os quadros estáticos que
   * o Estúdio deixou de usar quando ganhou a TV.
   */
  office: {
    floors: {
      default: 'office/floor_carpet',
      lounge: 'office/floor_carpet',
      meeting: 'office/floor_meeting',
      kitchen: 'office/floor_cream',
    },
    wallFace: 'wall/face',
    window: 'studio/window',
    board: 'office/whiteboard',
    arts: ['studio/art_planner', 'studio/art_fire', 'studio/art_beach'],
    workstations: ['studio/workstation_1', 'studio/workstation_2'],
    longDesk: 'studio/long_desk',
    stool: 'studio/stool',
    chairsRight: ['studio/chair_right_1', 'studio/chair_right_2'],
    chairsLeft: ['studio/chair_left_1', 'studio/chair_left_2'],
    sofaBig: 'studio/sofa_big',
    sofaSmall: 'studio/sofa_small',
    shelves: ['studio/shelf_1', 'studio/shelf_2'],
    easel: 'office/whiteboard',
    counters: ['studio/counter_1', 'studio/counter_2'],
    fridge: 'office/vending',
    globes: ['office/printer'],
    plants: ['studio/plant_1', 'studio/plant_2', 'studio/plant_3'],
    rug3x2: 'studio/rug_3x2',
    rug3x1: 'studio/rug_3x1',
    rug2x1: 'studio/rug_2x1',
    coffeeMachine: 'coffee',
    aquarium: 'aquarium',
  },
  /**
   * Café: salão de madeira, cozinha clara atrás do balcão e a sala reservada
   * com o piso quente do lounge. `L` (Desk) vira a estação de café sobre o
   * balcão — a máquina animada (`C`) fica na cozinha.
   */
  cafe: {
    floors: {
      default: 'cafe/floor_wood',
      lounge: 'floor/herringbone',
      meeting: 'cafe/floor_checker',
      kitchen: 'office/floor_cream',
    },
    wallFace: 'wall/face',
    window: 'studio/window',
    board: 'studio/chalkboard',
    arts: ['studio/art_fire', 'studio/art_beach'],
    workstations: ['studio/workstation_1', 'studio/workstation_2'],
    longDesk: 'studio/long_desk',
    stool: 'studio/stool',
    chairsRight: ['studio/chair_right_1', 'studio/chair_right_2'],
    chairsLeft: ['studio/chair_left_1', 'studio/chair_left_2'],
    sofaBig: 'studio/sofa_big',
    sofaSmall: 'studio/sofa_small',
    shelves: ['studio/shelf_1', 'studio/shelf_2'],
    easel: 'cafe/coffee_station',
    counters: ['studio/counter_1', 'studio/counter_2'],
    fridge: 'studio/fridge',
    globes: ['studio/globe_1', 'studio/globe_2'],
    plants: ['studio/plant_1', 'studio/plant_2', 'studio/plant_3'],
    rug3x2: 'studio/rug_3x2',
    rug3x1: 'studio/rug_3x1',
    rug2x1: 'studio/rug_2x1',
    coffeeMachine: 'coffee',
    aquarium: 'aquarium',
  },
};
