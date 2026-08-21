import { Rectangle, Texture } from 'pixi.js';
import { appearanceKey, type Appearance } from '@together/shared';
import {
  GENERATOR_DEF,
  byFacing,
  type CharacterDef,
  type Facing,
  type SheetSlice,
  type SitFacing,
} from './characterDefs';
import { composeAppearance, loadCuratedLayers } from './composeCharacter';

export type { Facing, SitFacing } from './characterDefs';
export { loadCuratedLayers } from './composeCharacter';

/**
 * O que o Avatar consome: as direções já resolvidas, com a spritesheet fatiada.
 * Toda a irregularidade de layout morre no loader — o Avatar só pede
 * `walk[facing]` ou `sit[facing]` e desenha.
 */
export interface CharacterFrames {
  /** a `appearanceKey` — identifica a combinação, para debug e cache */
  id: string;
  idle: Record<Facing, Texture[]>;
  walk: Record<Facing, Texture[]>;
  /** só perfil: o pack não tem sentar de frente nem de costas */
  sit: Record<SitFacing, Texture[]>;
  /** celular (pose de ausente), só de frente: a intro toca uma vez… */
  phoneIntro: Texture[];
  /** …e este é o loop que fica (ver characterDefs para o porquê do corte) */
  phone: Texture[];
  scale: number;
  labelY: number;
  anchorY: number;
  idleFrameS: number;
  walkFrameS: number;
  sitFrameS: number;
  phoneFrameS: number;
}

function cut(source: Texture, def: CharacterDef, slice: SheetSlice): Texture[] {
  return slice.cols.map(
    (col) =>
      new Texture({
        source: source.source,
        frame: new Rectangle(col * def.frameW, slice.row * def.frameH, def.frameW, def.frameH),
      }),
  );
}

/**
 * Cache em nível de módulo: as texturas são compartilhadas entre sessões (sair
 * e voltar) e entre players com a mesma aparência. É por isso que
 * `Game.destroy()` usa `texture: false` — destruí-las aqui quebraria a próxima
 * sessão e todos os outros avatares.
 */
const cache = new Map<string, CharacterFrames>();

/**
 * As texturas desta aparência. SÍNCRONO de propósito: `addRemote` não pode
 * esperar rede quando alguém entra, então as camadas curadas são pré-carregadas
 * de uma vez (`loadCuratedLayers`, no `Game.create`) e a composição é canvas 2D
 * puro. A textura nasce do canvas composto — fonte que o Pixi re-sobe sozinho
 * se o contexto WebGL cair.
 */
export function framesForAppearance(appearance: Appearance): CharacterFrames {
  const key = appearanceKey(appearance);
  const hit = cache.get(key);
  if (hit) return hit;

  const def = GENERATOR_DEF;
  const sheet = Texture.from(composeAppearance(appearance));
  sheet.source.scaleMode = 'nearest'; // pixel art nítida

  const frames: CharacterFrames = {
    id: key,
    idle: byFacing((f) => cut(sheet, def, def.idle[f])),
    walk: byFacing((f) => cut(sheet, def, def.walk[f])),
    sit: {
      left: cut(sheet, def, def.sit.left),
      right: cut(sheet, def, def.sit.right),
    },
    phoneIntro: cut(sheet, def, def.phoneIntro),
    phone: cut(sheet, def, def.phone),
    scale: def.scale,
    labelY: def.labelY,
    anchorY: def.anchorY,
    idleFrameS: def.idleFrameS,
    walkFrameS: def.walkFrameS,
    sitFrameS: def.sitFrameS,
    phoneFrameS: def.phoneFrameS,
  };
  cache.set(key, frames);
  return frames;
}
