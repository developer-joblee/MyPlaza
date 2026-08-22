import {
  BODY_IDS,
  EYES_IDS,
  HAIR_IDS,
  OUTFIT_IDS,
  appearanceKey,
  type Appearance,
} from '@together/shared';

/**
 * Composição das camadas do Character Generator em uma spritesheet única.
 *
 * ZERO PixiJS de propósito: é canvas 2D puro, então a tela de entrada desenha
 * o preview animado com o MESMO compositor sem arrastar o renderizador — e as
 * texturas do jogo nascem de um canvas, que o Pixi re-sobe sozinho se o
 * contexto WebGL cair (um RenderTexture perderia o conteúdo).
 *
 * A ordem de composição é a do pack (CHARACTER_GENERATOR.txt):
 * BODY + EYES + OUTFIT + HAIRSTYLE (+ ACCESSORY, reservado).
 */

/** Dimensão da grade útil das sheets (o Body tem paleta extra à direita, ignorada). */
export const SHEET_W = 896;
export const SHEET_H = 656;

const urlFor = (layer: 'body' | 'eyes' | 'outfit' | 'hair', id: string): string =>
  `/characters/v2/${layer}/${id}.png`;

const images = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

async function loadImage(url: string): Promise<void> {
  const img = new Image();
  img.src = url;
  await img.decode(); // rejeita se o PNG não existir — melhor que camada invisível
  images.set(url, img);
}

/**
 * Pré-carrega TODAS as camadas curadas (~51 PNGs, ~2 MB). Tudo de uma vez pelo
 * mesmo motivo das sheets antigas: `addRemote` é síncrono, então compor a
 * aparência de quem entra não pode esperar rede.
 */
export function loadCuratedLayers(): Promise<void> {
  if (!loading) {
    const urls = [
      ...BODY_IDS.map((id) => urlFor('body', id)),
      ...EYES_IDS.map((id) => urlFor('eyes', id)),
      ...OUTFIT_IDS.map((id) => urlFor('outfit', id)),
      ...HAIR_IDS.map((id) => urlFor('hair', id)),
    ];
    loading = Promise.all(urls.map(loadImage)).then(() => undefined);
  }
  return loading;
}

const composed = new Map<string, HTMLCanvasElement>();

/**
 * A spritesheet composta desta aparência. Síncrono — exige `loadCuratedLayers`
 * resolvido (o `Game.create` garante). Cache por chave: avatares iguais
 * compartilham o canvas, e portanto a textura.
 */
export function composeAppearance(a: Appearance): HTMLCanvasElement {
  const key = appearanceKey(a);
  const hit = composed.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W;
  canvas.height = SHEET_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d indisponível');
  ctx.imageSmoothingEnabled = false;

  const draw = (layer: 'body' | 'eyes' | 'outfit' | 'hair', id: string): void => {
    const img = images.get(urlFor(layer, id));
    if (!img) throw new Error(`camada não carregada: ${layer}/${id} — loadCuratedLayers rodou?`);
    // sempre em (0,0): as camadas compartilham a grade; o excesso do Body
    // (paleta em x>=896) fica fora do canvas
    ctx.drawImage(img, 0, 0);
  };

  draw('body', a.body);
  draw('eyes', a.eyes);
  draw('outfit', a.outfit);
  if (a.hair) draw('hair', a.hair);

  composed.set(key, canvas);
  return canvas;
}
