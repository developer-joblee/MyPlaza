import {
  Container,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  TextStyle,
  type FederatedPointerEvent,
  type Texture,
} from 'pixi.js';
import { PROXIMITY_RADIUS, TILE_SIZE } from '@together/shared';
import { AwayIndicator } from './AwayIndicator';
import { BoobleWhisper } from './BoobleWhisper';
import { EmoteBubble } from './EmoteBubble';
import type { EmoteFrames } from './emotes';
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
  /** criado só na primeira booble — ver setBooble */
  private whisper: BoobleWhisper | null = null;
  /** criado só na primeira reação — ver showEmote */
  private emoteBubble: EmoteBubble | null = null;

  private facing: Facing = 'down';
  private moving = false;
  /** null = de pé; senão, para que lado está sentado */
  private sitting: SitFacing | null = null;
  private away = false;
  private inBooble = false;
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

  /**
   * Numa booble: liga o balãozinho de cochicho ao lado da cabeça.
   *
   * Cuidado com o que este método NÃO é. Ele não é a pastilha "booble" que a
   * primeira versão da feature tinha aqui e que foi removida de propósito: uma
   * etiqueta por cabeça obriga quem olha a ler três rótulos e deduzir o grupo,
   * e *quem está com quem* é uma relação — quem responde isso é o círculo no
   * chão (`game/BoobleRings.ts`), desenhado pelo `Game`, que é quem tem as
   * posições de todo mundo. O balão responde outra coisa, que nenhum desenho
   * parado responde: **tem conversa acontecendo ali**. Por isso ele não tem
   * texto e não diz de qual booble a pessoa é.
   *
   * Quem chama é o `Game`, a partir de `setPlayerBooble` e do snapshot —
   * nunca a UI direto (ver `client/src/booble.ts`).
   */
  setBooble(inBooble: boolean): void {
    if (this.inBooble === inBooble) return;
    this.inBooble = inBooble;
    /**
     * Criado na primeira booble, e não no construtor, pela mesma razão do
     * `AwayIndicator`: a maioria dos avatares nunca entra numa, e o balão custa
     * cinco `Graphics` cada. Depois de criado ele só é escondido — entrar e
     * sair de booble é barato, e é o que acontece o tempo todo.
     */
    if (inBooble && !this.whisper) {
      this.whisper = new BoobleWhisper();
      this.view.addChild(this.whisper.view);
    }
    this.whisper?.setVisible(inBooble);
  }

  /**
   * Reação sobre a cabeça (balão de emote). Criado na primeira, como o
   * `AwayIndicator` — a maioria dos avatares nunca reage. Um emote novo
   * substitui o anterior; o balão some sozinho (`EMOTE_DURATION_MS`).
   * A posição sai do nome, como a pastilha de ausente, para encostar na cabeça
   * de qualquer personagem.
   */
  showEmote(frames: EmoteFrames): void {
    if (!this.emoteBubble) {
      this.emoteBubble = new EmoteBubble(this.label.y - this.label.height - 2);
      this.view.addChild(this.emoteBubble.view);
    }
    this.emoteBubble.show(frames);
  }

  /**
   * O que desenhar agora: o loop, o ritmo e uma intro opcional que toca uma vez
   * antes de o loop começar (hoje só o celular tem — tirar o aparelho do bolso).
   * A precedência é a mesma de sempre: ausente > sentado > andando > parado.
   * A intro depende de `frameIndex` ser zerado quando o estado liga — é o que
   * `setAway`/`setSitting` já fazem.
   */
  private resolvePose(): { loop: Texture[]; frameS: number; intro?: Texture[] } {
    if (this.away) {
      return {
        loop: this.frames.phone,
        frameS: this.frames.phoneFrameS,
        intro: this.frames.phoneIntro,
      };
    }
    if (this.sitting) {
      return { loop: this.frames.sit[this.sitting], frameS: this.frames.sitFrameS };
    }
    if (this.moving) {
      return { loop: this.frames.walk[this.facing], frameS: this.frames.walkFrameS };
    }
    return { loop: this.frames.idle[this.facing], frameS: this.frames.idleFrameS };
  }

  /** Avança a animação. Chamar a cada frame do ticker. */
  update(dt: number): void {
    const pose = this.resolvePose();
    this.frameTimer += dt;
    if (this.frameTimer >= pose.frameS) {
      this.frameTimer %= pose.frameS;
      this.frameIndex++;
    }
    const introLen = pose.intro?.length ?? 0;
    this.sprite.texture =
      pose.intro && this.frameIndex < introLen
        ? pose.intro[this.frameIndex]
        : pose.loop[(this.frameIndex - introLen) % pose.loop.length];
    this.awayIndicator?.update(dt);
    this.whisper?.update(dt);
    this.emoteBubble?.update(dt);
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
   * Liga o clique direito neste avatar (`null` desliga). É a única interação do
   * Pixi no projeto — o resto da entrada é teclado, na `window`.
   *
   * Três detalhes que não são opcionais:
   *
   * - **`hitArea` é obrigatória, não otimização.** Sem ela o Pixi testa pelos
   *   *bounds* do container, e o container do player local inclui o círculo de
   *   proximidade (`PROXIMITY_RADIUS`): clicar a cinco tiles de distância
   *   acertaria a pessoa. Com a área explícita, o alvo é o corpo do boneco.
   * - **A área é derivada do sprite**, não escrita à mão: cada personagem tem
   *   sua escala e sua âncora (`sprites.ts` normaliza isso), e um retângulo
   *   fixo descolaria no primeiro boneco com outra geometria.
   * - **`interactiveChildren = false`**: quem responde é o container, e varrer
   *   sprite, sombra, anéis, nome e indicador de ausente a cada teste é
   *   trabalho para chegar sempre à mesma resposta.
   */
  setContextMenuHandler(handler: ((e: FederatedPointerEvent) => void) | null): void {
    this.view.off('rightdown');
    if (!handler) {
      this.view.eventMode = 'none';
      this.view.hitArea = null;
      return;
    }
    const tex = this.frames.idle.down[0];
    const w = tex.width * this.frames.scale;
    const h = tex.height * this.frames.scale;
    this.view.hitArea = new Rectangle(
      -w / 2,
      FEET_Y - h * this.frames.anchorY,
      w,
      h,
    );
    this.view.interactiveChildren = false;
    this.view.eventMode = 'static';
    this.view.on('rightdown', handler);
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
    /**
     * O balão de cochicho está ligado. Sai daqui, e não do mapa de boobles do
     * `Game`, de propósito: é justamente a divergência entre os dois que este
     * campo existe para pegar (um avatar que ficou sem receber `setBooble` é
     * invisível a olho nu no meio de um grupo).
     */
    whispering: boolean;
    frameX: number;
    frameY: number;
  } {
    return {
      character: this.frames.id,
      facing: this.facing,
      sitting: this.sitting,
      away: this.away,
      whispering: this.inBooble,
      frameX: this.sprite.texture.frame.x,
      frameY: this.sprite.texture.frame.y,
    };
  }

  destroy(): void {
    this.view.destroy({ children: true });
  }
}
