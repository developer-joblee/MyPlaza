import { Assets, Rectangle, Texture } from 'pixi.js';
import { CHARACTERS, type CharacterId } from '@together/shared';
import {
  CHARACTER_DEFS,
  byFacing,
  type CharacterDef,
  type Facing,
  type SheetSlice,
} from './characterDefs';

export type { Facing } from './characterDefs';

/**
 * O que o Avatar consome. É sempre esta forma, venha de qual pack vier: as
 * quatro direções já resolvidas, com o espelhamento marcado onde a spritesheet
 * não tem o lado. Assim o Avatar não precisa de nenhum `if` por personagem, e
 * os dois formatos incompatíveis de sheet (16x32 com 4 direções do LimeZu e
 * 32x32 com 3 do Protótipo) morrem aqui.
 */
export interface CharacterFrames {
  id: CharacterId;
  idle: Record<Facing, Texture[]>;
  walk: Record<Facing, Texture[]>;
  /** espelhar na horizontal (a sheet não tem esse lado desenhado) */
  mirror: Record<Facing, boolean>;
  /** sombra própria; null = o Avatar desenha uma elipse */
  shadow: Texture | null;
  scale: number;
  labelY: number;
  anchorY: number;
  idleFrameS: number;
  walkFrameS: number;
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
 * e voltar) e entre players que escolheram o mesmo boneco. É por isso que
 * `Game.destroy()` usa `texture: false` — destruí-las aqui quebraria a próxima
 * sessão e todos os outros avatares.
 */
const cache = new Map<CharacterId, CharacterFrames>();

export async function loadCharacterFrames(id: CharacterId): Promise<CharacterFrames> {
  const hit = cache.get(id);
  if (hit) return hit;

  const def = CHARACTER_DEFS[id];
  const [walkSheet, idleSheet, shadow] = await Promise.all([
    Assets.load<Texture>(def.sheet),
    def.idleSheet ? Assets.load<Texture>(def.idleSheet) : Promise.resolve(null),
    def.shadowSheet ? Assets.load<Texture>(def.shadowSheet) : Promise.resolve(null),
  ]);

  // pixel art nítida
  for (const t of [walkSheet, idleSheet, shadow]) {
    if (t) t.source.scaleMode = 'nearest';
  }

  const build = (which: 'idle' | 'walk', source: Texture) =>
    byFacing((f) => cut(source, def, def[which][f]));

  const frames: CharacterFrames = {
    id,
    // sem idleSheet o idle vive na mesma sheet da caminhada (caso do LimeZu)
    idle: build('idle', idleSheet ?? walkSheet),
    walk: build('walk', walkSheet),
    mirror: byFacing((f) => def.walk[f].mirror === true),
    shadow,
    scale: def.scale,
    labelY: def.labelY,
    anchorY: def.anchorY,
    idleFrameS: def.idleFrameS,
    walkFrameS: def.walkFrameS,
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
