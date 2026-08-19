import { Assets, Sprite, Texture } from 'pixi.js';
import type { WorldMap } from '@together/shared';
import { TilemapBase } from './TilemapBase';

const PROP_NAMES = [
  'tree0', 'tree1', 'tree2', 'statue', 'grave2', 'stele_resh', 'pillar',
  'lantern1', 'lantern2', 'monu1', 'monu2', 'altar', 'tablet', 'tomb',
] as const;

type PropName = (typeof PROP_NAMES)[number];

export interface RuinsTextures {
  ground: Texture;
  props: Record<PropName, Texture>;
}

/**
 * A arte do pack é de 16px/tile e a cena é usada 1:1 como imagem de chão.
 * Desenhamos em 2x para que 1 tile de arte = TILE_SIZE (32px) na tela, igual
 * aos outros cenários — assim a grade de colisão casa 1:1 com a arte e o
 * avatar fica na proporção certa.
 */
const ART_SCALE = 2;

/**
 * Instâncias dos props altos, extraídas pixel a pixel da cena original
 * ("Scene Overview" do pack). x/y/base em px da ARTE (escala 1), convertidos
 * para o mundo por ART_SCALE; `base` é o offset do pé do sprite (y-sort).
 */
const PROP_INSTANCES: Array<{ tex: PropName; x: number; y: number; base: number }> = [
  { tex: 'tree0', x: 613, y: 107, base: 131 },
  { tex: 'tree0', x: 449, y: 911, base: 131 },
  { tex: 'tree0', x: 250, y: 397, base: 131 },
  { tex: 'tree1', x: 24, y: 344, base: 128 },
  { tex: 'tree1', x: 309, y: 35, base: 128 },
  { tex: 'tree2', x: 841, y: 572, base: 112 },
  { tex: 'tree2', x: 375, y: 697, base: 112 },
  { tex: 'statue', x: 250, y: 246, base: 68 },
  { tex: 'grave2', x: 304, y: 602, base: 62 },
  { tex: 'stele_resh', x: 239, y: 647, base: 53 },
  { tex: 'pillar', x: 734, y: 637, base: 73 },
  { tex: 'pillar', x: 734, y: 771, base: 73 },
  { tex: 'lantern1', x: 632, y: 601, base: 57 },
  { tex: 'lantern2', x: 784, y: 591, base: 57 },
  { tex: 'monu1', x: 793, y: 844, base: 53 },
  { tex: 'monu2', x: 565, y: 790, base: 53 },
  { tex: 'monu2', x: 510, y: 320, base: 53 },
  { tex: 'altar', x: 479, y: 45, base: 68 },
  { tex: 'tablet', x: 419, y: 169, base: 49 },
  { tex: 'tomb', x: 653, y: 1014, base: 33 },
];

/**
 * Cenário das ruínas: o chão é a cena inteira do pack como uma única
 * imagem (32px/tile nativos, escala 1); os props altos são sobrepostos
 * nas mesmas posições para o y-sort ocluir os players corretamente.
 */
export class RuinsTilemap extends TilemapBase {
  constructor(map: WorldMap, tx: RuinsTextures) {
    super(map);

    const ground = new Sprite(tx.ground);
    ground.scale.set(ART_SCALE);
    this.view.addChild(ground);
    // sem cacheAsTexture: o chão já é um único sprite (1 draw call), e cachear
    // 1856x2240 na resolução do renderer custaria dezenas de MB de VRAM em troca
    // de nada.

    for (const inst of PROP_INSTANCES) {
      const sprite = new Sprite(tx.props[inst.tex]);
      sprite.scale.set(ART_SCALE);
      sprite.position.set(inst.x * ART_SCALE, inst.y * ART_SCALE);
      sprite.zIndex = (inst.y + inst.base) * ART_SCALE;
      this.props.push(sprite);
    }
  }
}

let cached: RuinsTextures | null = null;

export async function loadRuinsTextures(): Promise<RuinsTextures> {
  if (cached) return cached;
  const [ground, ...propTex] = await Promise.all([
    Assets.load<Texture>('/tiles/ruins/ground.png'),
    ...PROP_NAMES.map((n) => Assets.load<Texture>(`/tiles/ruins/${n}.png`)),
  ]);
  const props = Object.fromEntries(
    PROP_NAMES.map((n, i) => [n, propTex[i]]),
  ) as Record<PropName, Texture>;
  for (const t of [ground, ...propTex]) t.source.scaleMode = 'nearest';
  cached = { ground, props };
  return cached;
}
