import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { PROXIMITY_RADIUS, TILE_SIZE } from '@together/shared';
import { AwayIndicator } from './AwayIndicator';
import type { CharacterFrames, Facing, SitFacing } from './sprites';

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
 * Não sabe qual personagem está desenhando: escala, ancoragem e ritmo de
 * animação vêm todos do `CharacterFrames`, que já normalizou o layout da
 * spritesheet (ver `sprites.ts`). Adicionar um personagem novo não mexe aqui.
 */
export class Avatar {
  readonly view = new Container();
  private sprite: Sprite;
  private shadow: Graphics;
  private speakingRing: Graphics;
  /** só o player local tem: o círculo de alcance de voz */
  private proximityRing: Graphics | null = null;
  private label: Text;
  /** criado só na primeira ausência — ver setAway */
  private awayIndicator: AwayIndicator | null = null;

  private facing: Facing = 'down';
  private moving = false;
  /** null = de pé; senão, para que lado está sentado */
  private sitting: SitFacing | null = null;
  private away = false;
  /** empurra o avatar para a frente na ordenação por y (ver setSitting) */
  private zBias = 0;
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

    this.shadow = new Graphics().ellipse(0, -1, 8, 3.5).fill({ color: 0x000000, alpha: 0.22 });
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
    this.view.zIndex = y + this.zBias;
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

  /**
   * Senta (virado para `facing`) ou levanta (`null`). A sombra some ao sentar:
   * ela é uma elipse no chão, e sentado os pés não estão no chão.
   */
  setSitting(facing: SitFacing | null): void {
    if (this.sitting === facing) return;
    this.sitting = facing;
    this.shadow.visible = facing === null;
    /**
     * Sentado, o avatar tem de desenhar NA FRENTE da cadeira. Os props são
     * ancorados na base do tile (zIndex = base), e o avatar fica no centro
     * dele, então sem viés a cadeira cobriria a pessoa inteira. Um tile de
     * viés passa na frente dos props da própria fileira sem passar na frente
     * dos da fileira seguinte, que de fato estão mais perto da câmera.
     */
    this.zBias = facing === null ? 0 : TILE_SIZE;
    this.view.zIndex = this.view.position.y + this.zBias;
    // recomeça a animação, senão a pose entra num quadro qualquer do ciclo
    this.frameIndex = 0;
    this.frameTimer = 0;
  }

  get isSitting(): boolean {
    return this.sitting !== null;
  }

  /**
   * Ausente: mexendo no celular. Ganha das outras poses de propósito — é a
   * informação mais útil para quem olha (a pessoa não está ali), e vale mesmo
   * se ela ficou ausente sentada.
   *
   * Além da pose, liga o `AwayIndicator`: a telinha com o feed rolando e a
   * pastilha "ausente" acima do nome. Local, remotos e o snapshot de entrada
   * passam todos por aqui, então os três casos ficam cobertos de uma vez.
   */
  setAway(away: boolean): void {
    if (this.away === away) return;
    this.away = away;
    this.frameIndex = 0;
    this.frameTimer = 0;
    /**
     * Criado na primeira ausência, não no construtor: a maioria dos avatares
     * nunca fica ausente, e o indicador custa um `Text` e sete `Graphics` cada.
     * A posição sai do próprio nome, para a pastilha encostar nele em qualquer
     * personagem (o `labelY` varia por sheet).
     */
    if (away && !this.awayIndicator) {
      this.awayIndicator = new AwayIndicator(this.label.y - this.label.height);
      this.view.addChild(this.awayIndicator.view);
    }
    this.awayIndicator?.setVisible(away);
  }

  /*
   * A booble NÃO desenha nada no avatar de propósito.
   *
   * A primeira versão tinha uma pastilha "booble" aqui, no molde da de ausente.
   * Ela foi trocada por um círculo no chão em volta do GRUPO
   * (`game/BoobleRings.ts`), porque a informação que importa numa booble é
   * "quem está com quem", e isso é uma relação — uma pastilha por cabeça obriga
   * quem olha a ler três etiquetas e concluir o grupo por conta própria. O
   * círculo cresce quando alguém entra, então também mostra o tamanho.
   *
   * Por isso o avatar não sabe da booble: quem sabe é o `Game`, que tem as
   * posições de todo mundo — que é o que um desenho de grupo precisa.
   */

  /** Avança a animação. Chamar a cada frame do ticker. */
  update(dt: number): void {
    const set = this.away
      ? this.frames.phone
      : this.sitting
        ? this.frames.sit[this.sitting]
        : this.moving
          ? this.frames.walk[this.facing]
          : this.frames.idle[this.facing];
    const frameDuration = this.away
      ? this.frames.phoneFrameS
      : this.sitting
        ? this.frames.sitFrameS
        : this.moving
          ? this.frames.walkFrameS
          : this.frames.idleFrameS;
    this.frameTimer += dt;
    if (this.frameTimer >= frameDuration) {
      this.frameTimer %= frameDuration;
      this.frameIndex++;
    }
    this.sprite.texture = set[this.frameIndex % set.length];
    this.awayIndicator?.update(dt);
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
   * Qual quadro está na tela agora. Existe porque erros de recorte são
   * invisíveis a olho nu: sentado para a esquerda e para a direita são poses
   * distintas na sheet, e comparar `frameX` é o que separa "está certo" de
   * "está desenhando a pose errada com aparência plausível".
   */
  debugFrame(): {
    character: string;
    facing: Facing;
    sitting: SitFacing | null;
    away: boolean;
    frameX: number;
    frameY: number;
  } {
    return {
      character: this.frames.id,
      facing: this.facing,
      sitting: this.sitting,
      away: this.away,
      frameX: this.sprite.texture.frame.x,
      frameY: this.sprite.texture.frame.y,
    };
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
