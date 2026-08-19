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

/** Deslocamento dos pés em relação ao centro lógico (posição de colisão) */
const FEET_Y = 14;

/**
 * Visual compartilhado entre o player local e os remotos.
 *
 * Não sabe qual personagem está desenhando: escala, ancoragem, espelhamento e
 * ritmo de animação vêm todos do `CharacterFrames`, que já normalizou os packs
 * (ver `sprites.ts`). Adicionar um personagem novo não mexe neste arquivo.
 */
export class Avatar {
  readonly view = new Container();
  private sprite: Sprite;
  private shadow: Sprite | Graphics;
  private speakingRing: Graphics;
  /** só o player local tem: o círculo de alcance de voz */
  private proximityRing: Graphics | null = null;
  private label: Text;

  private facing: Facing = 'down';
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
      this.proximityRing = new Graphics()
        .circle(0, 0, PROXIMITY_RADIUS)
        .fill({ color: 0xffffff, alpha: 0.05 })
        .stroke({ width: 1.5, color: 0xffffff, alpha: 0.18 });
      this.view.addChild(this.proximityRing);
    }

    // anel "falando" no chão, sob a sombra
    this.speakingRing = new Graphics()
      .ellipse(0, FEET_Y - 1, 13, 6)
      .stroke({ width: 2.5, color: 0x3ddc84, alpha: 0.95 });
    this.speakingRing.visible = false;
    this.view.addChild(this.speakingRing);

    // o Protótipo tem sombra desenhada na arte; os do LimeZu não, então
    // ganham uma elipse — a única diferença de montagem entre os packs
    if (frames.shadow) {
      const s = new Sprite(frames.shadow);
      s.anchor.set(0.5, 30 / 32);
      s.scale.set(frames.scale);
      s.alpha = 0.8;
      this.shadow = s;
    } else {
      this.shadow = new Graphics().ellipse(0, -1, 8, 3.5).fill({ color: 0x000000, alpha: 0.22 });
    }
    this.shadow.position.set(0, FEET_Y);
    this.view.addChild(this.shadow);

    this.sprite = new Sprite(frames.idle.down[0]);
    this.sprite.anchor.set(0.5, frames.anchorY); // pés do personagem
    this.sprite.position.set(0, FEET_Y);
    this.sprite.scale.set(frames.scale);
    this.view.addChild(this.sprite);

    this.label = new Text({ text: name, style: NAME_STYLE });
    this.label.anchor.set(0.5, 1);
    this.label.y = frames.labelY;
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
      this.facing = dx < 0 ? 'left' : 'right';
    } else {
      this.facing = dy < 0 ? 'up' : 'down';
    }
  }

  /** Avança a animação. Chamar a cada frame do ticker. */
  update(dt: number): void {
    const set = this.moving ? this.frames.walk[this.facing] : this.frames.idle[this.facing];
    const frameDuration = this.moving ? this.frames.walkFrameS : this.frames.idleFrameS;
    this.frameTimer += dt;
    if (this.frameTimer >= frameDuration) {
      this.frameTimer %= frameDuration;
      this.frameIndex++;
    }
    this.sprite.texture = set[this.frameIndex % set.length];
    const scale = this.frames.scale;
    this.sprite.scale.x = this.frames.mirror[this.facing] ? -scale : scale;
  }

  /**
   * Dentro de uma zona de áudio o círculo mentiria (o alcance passa a ser a
   * sala, não um raio), então ele é escondido.
   */
  setProximityVisible(visible: boolean): void {
    if (this.proximityRing) this.proximityRing.visible = visible;
  }

  setSpeaking(speaking: boolean): void {
    this.speakingRing.visible = speaking;
  }

  /**
   * Qual quadro está na tela agora. Existe porque um lado invertido é invisível
   * a olho nu: quando esquerda e direita usam a mesma imagem espelhada, a tela
   * fica certa mesmo com o recorte errado. Comparar `frameX` entre andar para os
   * dois lados é o que separa os dois casos.
   */
  debugFrame(): {
    character: string;
    facing: Facing;
    frameX: number;
    frameY: number;
    scaleX: number;
  } {
    return {
      character: this.frames.id,
      facing: this.facing,
      frameX: this.sprite.texture.frame.x,
      frameY: this.sprite.texture.frame.y,
      scaleX: this.sprite.scale.x,
    };
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
