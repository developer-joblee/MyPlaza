import { Assets, Rectangle, Texture } from 'pixi.js';
import { CHARACTERS, type CharacterId } from '@together/shared';
import {
  CHARACTER_DEFS,
  byFacing,
  type CharacterDef,
  type Facing,
  type SheetSlice,
  type SitFacing,
} from './characterDefs';

export type { Facing, SitFacing } from './characterDefs';

/**
 * O que o Avatar consome: as direções já resolvidas, com a spritesheet fatiada.
 * Toda a irregularidade de layout (passos de célula diferentes entre andar e
 * sentar, figura deslocada dentro da célula) morre no loader — o Avatar só pede
 * `walk[facing]` ou `sit[facing]` e desenha.
 */
export interface CharacterFrames {
  id: CharacterId;
  idle: Record<Facing, Texture[]>;
  walk: Record<Facing, Texture[]>;
  /** só perfil: o pack não tem sentar de frente nem de costas */
  sit: Record<SitFacing, Texture[]>;
  scale: number;
  labelY: number;
  anchorY: number;
  idleFrameS: number;
  walkFrameS: number;
  sitFrameS: number;
}

function cut(source: Texture, def: CharacterDef, slice: SheetSlice): Texture[] {
  const stride = slice.stride ?? def.frameW;
  const offsetX = slice.offsetX ?? 0;
  return slice.cols.map(
    (col) =>
      new Texture({
        source: source.source,
        frame: new Rectangle(
          col * stride + offsetX,
          slice.row * def.frameH,
          def.frameW,
          def.frameH,
        ),
      }),
  );
}

/**
 * Cache em nível de módulo: as texturas são compartilhadas entre sessões (sair
 * e voltar) e entre players que escolheram o mesmo boneco. É por isso que
 * `Game.destroy()` usa `texture: false` — destruí-las aqui quebraria a próxima
 * sessão e todos os outros avatares.
 */
const cache = new Map<CharacterId, CharacterFrames>();

export async function loadCharacterFrames(id: CharacterId): Promise<CharacterFrames> {
  const hit = cache.get(id);
  if (hit) return hit;

  const def = CHARACTER_DEFS[id];
  const sheet = await Assets.load<Texture>(def.sheet);
  sheet.source.scaleMode = 'nearest'; // pixel art nítida

  const frames: CharacterFrames = {
    id,
    idle: byFacing((f) => cut(sheet, def, def.idle[f])),
    walk: byFacing((f) => cut(sheet, def, def.walk[f])),
    sit: {
      left: cut(sheet, def, def.sit.left),
      right: cut(sheet, def, def.sit.right),
    },
    scale: def.scale,
    labelY: def.labelY,
    anchorY: def.anchorY,
    idleFrameS: def.idleFrameS,
    walkFrameS: def.walkFrameS,
    sitFrameS: def.sitFrameS,
  };
  cache.set(id, frames);
  return frames;
}

/**
 * Carrega todos os personagens de uma vez. As sheets são pequenas (17 KB cada)
 * e pré-carregar evita ter de lidar com carregamento assíncrono no meio do
 * `addRemote`, quando alguém entra com um boneco ainda não carregado.
 */
export async function loadAllCharacterFrames(): Promise<Map<CharacterId, CharacterFrames>> {
  await Promise.all(CHARACTERS.map((c) => loadCharacterFrames(c.id)));
  return cache;
}
