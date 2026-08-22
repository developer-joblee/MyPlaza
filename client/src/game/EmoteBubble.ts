import { Container, Sprite } from 'pixi.js';
import { EMOTE_DURATION_MS } from '@together/shared';
import { EMOTE_FRAME_S, type EmoteFrames } from './emotes';

/** Sobe estes px enquanto aparece; some no lugar (a subida é só na entrada). */
const RISE_PX = 6;
const FADE_IN_S = 0.15;
const FADE_OUT_S = 0.35;

/**
 * O balão de reação sobre a cabeça: aparece subindo, toca a intro (bolha
 * crescendo), pulsa o ícone e some sozinho depois de `EMOTE_DURATION_MS`.
 * Um por avatar, criado pelo Avatar na primeira reação (como o AwayIndicator);
 * um emote novo substitui o anterior no ato — reação velha não segura a nova.
 *
 * O passo de quadro é o mesmo mecanismo do `Avatar.update`/`AnimatedProp`
 * (acumulador + troca manual de textura), reimplementado aqui em poucas linhas
 * porque o envelope (alpha e subida) anda junto com o tempo do quadro.
 */
export class EmoteBubble {
  readonly view = new Container();
  private sprite = new Sprite();
  private frames: EmoteFrames | null = null;
  private elapsed = 0;
  private frameTimer = 0;
  private frameIndex = 0;

  constructor(private baseY: number) {
    this.sprite.anchor.set(0.5, 1);
    this.view.addChild(this.sprite);
    this.view.visible = false;
  }

  show(frames: EmoteFrames): void {
    this.frames = frames;
    this.elapsed = 0;
    this.frameTimer = 0;
    this.frameIndex = 0;
    this.sprite.texture = frames.frames[0];
    this.view.visible = true;
  }

  update(dt: number): void {
    if (!this.view.visible || !this.frames) return;
    this.elapsed += dt;

    const total = EMOTE_DURATION_MS / 1000;
    if (this.elapsed >= total) {
      this.view.visible = false;
      return;
    }

    // quadro: intro uma vez, depois o loop do ícone
    this.frameTimer += dt;
    if (this.frameTimer >= EMOTE_FRAME_S) {
      this.frameTimer %= EMOTE_FRAME_S;
      this.frameIndex++;
      const [loopStart, loopEnd] = this.frames.loop;
      if (this.frameIndex > loopEnd) this.frameIndex = loopStart;
      this.sprite.texture = this.frames.frames[this.frameIndex];
    }

    // envelope: sobe e aparece na entrada, esmaece no fim
    const fadeIn = Math.min(1, this.elapsed / FADE_IN_S);
    const fadeOut = Math.min(1, (total - this.elapsed) / FADE_OUT_S);
    this.view.alpha = Math.min(fadeIn, fadeOut);
    this.view.y = this.baseY - RISE_PX * fadeIn;
  }
}
