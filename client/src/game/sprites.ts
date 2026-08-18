import { Assets, Rectangle, Texture } from 'pixi.js';

export type Facing = 'down' | 'side' | 'up';

export interface CharacterFrames {
  idle: Record<Facing, Texture[]>;
  walk: Record<Facing, Texture[]>;
  shadow: Texture;
}

const FRAME = 32;
/** Ordem das linhas nas spritesheets do Prototype_Character */
const ROWS: Facing[] = ['down', 'side', 'up'];

function slice(sheet: Texture, cols: number): Record<Facing, Texture[]> {
  const out = {} as Record<Facing, Texture[]>;
  ROWS.forEach((facing, row) => {
    out[facing] = Array.from(
      { length: cols },
      (_, col) =>
        new Texture({
          source: sheet.source,
          frame: new Rectangle(col * FRAME, row * FRAME, FRAME, FRAME),
        }),
    );
  });
  return out;
}

let cached: CharacterFrames | null = null;

export async function loadCharacterFrames(): Promise<CharacterFrames> {
  if (cached) return cached;
  const [idle, walk, shadow] = await Promise.all([
    Assets.load<Texture>('/characters/default/idle.png'),
    Assets.load<Texture>('/characters/default/walk.png'),
    Assets.load<Texture>('/characters/default/shadow.png'),
  ]);
  // pixel art nítida
  for (const t of [idle, walk, shadow]) t.source.scaleMode = 'nearest';
  cached = { idle: slice(idle, 2), walk: slice(walk, 4), shadow };
  return cached;
}
