import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { PROXIMITY_RADIUS } from '@together/shared';
import type { CharacterFrames, Facing } from './sprites';

const NAME_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  fontWeight: '600',
  fill: 0xffffff,
  stroke: { color: 0x22242e, width: 3 },
});

const SCALE = 1.5;
/** Deslocamento dos pés em relação ao centro lógico (posição de colisão) */
const FEET_Y = 14;
const WALK_FRAME_S = 0.12;
const IDLE_FRAME_S = 0.45;
/** A linha "side" da spritesheet olha para a ESQUERDA */
const SHEET_SIDE_FACES_LEFT = true;
const FRAME_DISPLAY_H = 32 * SCALE;

/** Visual compartilhado entre o player local e os remotos. */
export class Avatar {
  readonly view = new Container();
  private sprite: Sprite;
  private shadow: Sprite;
  private speakingRing: Graphics;
  private label: Text;

  private facing: Facing = 'down';
  private flipX = false;
  private moving = false;
  private frameTimer = 0;
  private frameIndex = 0;

  constructor(
    private frames: CharacterFrames,
    name: string,
    color: number,
    opts: { showProximityRadius?: boolean } = {},
  ) {
    if (opts.showProximityRadius) {
      const radius = new Graphics()
        .circle(0, 0, PROXIMITY_RADIUS)
        .fill({ color: 0xffffff, alpha: 0.05 })
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.18 });
      this.view.addChild(radius);
    }

    // anel "falando" no chão, sob a sombra
    this.speakingRing = new Graphics()
      .ellipse(0, FEET_Y - 1, 13, 6)
      .stroke({ width: 2.5, color: 0x3ddc84, alpha: 0.95 });
    this.speakingRing.visible = false;
    this.view.addChild(this.speakingRing);

    this.shadow = new Sprite(frames.shadow);
    this.shadow.anchor.set(0.5, 30 / 32);
    this.shadow.position.set(0, FEET_Y);
    this.shadow.scale.set(SCALE);
    this.shadow.alpha = 0.8;
    this.view.addChild(this.shadow);

    this.sprite = new Sprite(frames.idle.down[0]);
    this.sprite.anchor.set(0.5, 30 / 32); // pés do personagem
    this.sprite.position.set(0, FEET_Y);
    this.sprite.scale.set(SCALE);
    this.view.addChild(this.sprite);

    this.label = new Text({ text: name, style: NAME_STYLE });
    this.label.anchor.set(0.5, 1);
    this.label.y = FEET_Y - FRAME_DISPLAY_H - 4;
    this.label.resolution = 2;
    this.label.tint = color;
    this.view.addChild(this.label);
  }

  setPosition(x: number, y: number): void {
    this.view.position.set(x, y);
    this.view.zIndex = y;
  }

  /** Atualiza direção/estado de movimento a partir do vetor de deslocamento. */
  setMotion(dx: number, dy: number, moving: boolean): void {
    this.moving = moving;
    if (!moving) return;
    if (Math.abs(dx) >= Math.abs(dy)) {
      this.facing = 'side';
      this.flipX = SHEET_SIDE_FACES_LEFT ? dx > 0 : dx < 0;
    } else {
      this.facing = dy < 0 ? 'up' : 'down';
      this.flipX = false;
    }
  }

  /** Avança a animação. Chamar a cada frame do ticker. */
  update(dt: number): void {
    const set = this.moving ? this.frames.walk[this.facing] : this.frames.idle[this.facing];
    const frameDuration = this.moving ? WALK_FRAME_S : IDLE_FRAME_S;
    this.frameTimer += dt;
    if (this.frameTimer >= frameDuration) {
      this.frameTimer %= frameDuration;
      this.frameIndex++;
    }
    this.sprite.texture = set[this.frameIndex % set.length];
    this.sprite.scale.x = this.flipX ? -SCALE : SCALE;
  }

  setSpeaking(speaking: boolean): void {
    this.speakingRing.visible = speaking;
  }
}
