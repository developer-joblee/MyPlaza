import { Assets, Rectangle, Texture } from 'pixi.js';
import { EMOTES, type EmoteId } from '@together/shared';

/**
 * As tiras de emote (`/emotes/{id}.png`, geradas por `npm run assets:characters`):
 * 8 quadros de 32x32 — 0-5 a intro (bolha crescendo, toca uma vez) e 6-7 o
 * ícone pulsando (loop). Mesmo formato de recorte do resto do projeto.
 */
export interface EmoteFrames {
  frames: Texture[];
  /** faixa do loop nos índices de `frames` — o que vem antes é intro */
  loop: readonly [number, number];
}

export const EMOTE_FRAME_S = 0.12;

const cache = new Map<EmoteId, EmoteFrames>();
let loading: Promise<void> | null = null;

/** Pré-carrega as 6 tiras (~2 KB cada). Chamado no `Game.create`. */
export function loadEmoteFrames(): Promise<void> {
  if (!loading) {
    loading = Promise.all(
      EMOTES.map(async ({ id }) => {
        const strip = await Assets.load<Texture>(`/emotes/${id}.png`);
        strip.source.scaleMode = 'nearest';
        if (strip.width !== 8 * 32 || strip.height !== 32) {
          throw new Error(`Tira de emote "${id}" tem ${strip.width}x${strip.height} — esperado 256x32`);
        }
        const frames = Array.from(
          { length: 8 },
          (_, i) =>
            new Texture({ source: strip.source, frame: new Rectangle(i * 32, 0, 32, 32) }),
        );
        cache.set(id, { frames, loop: [6, 7] });
      }),
    ).then(() => undefined);
  }
  return loading;
}

/** null só se o preload não rodou (ou id de um servidor mais novo). */
export function emoteFrames(id: EmoteId): EmoteFrames | null {
  return cache.get(id) ?? null;
}
