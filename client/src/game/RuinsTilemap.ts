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
 * Instâncias dos props altos, extraídas pixel a pixel da cena original
 * ("Scene Overview" do pack). x/y em px do mundo; `base` é o offset do
 * pé do sprite (para o y-sort com os players).
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
    this.view.addChild(ground);

    for (const inst of PROP_INSTANCES) {
      const sprite = new Sprite(tx.props[inst.tex]);
      sprite.position.set(inst.x, inst.y);
      sprite.zIndex = inst.y + inst.base;
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
