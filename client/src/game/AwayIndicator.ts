import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * O que aparece no avatar de quem está ausente, além da pose do celular:
 *
 * - uma **mini-tela ao lado da cabeça** com o feed rolando em loop, que é o que
 *   dá movimento à ausência (a pose do celular sozinha é quase parada e, de
 *   longe, some no meio do idle das outras pessoas);
 * - uma **pastilha "ausente"** acima do nome, que é a leitura sem ambiguidade —
 *   a mesma palavra que o HUD usa na lista.
 *
 * Tudo é `Graphics` e `Text`: nenhum asset novo (os packs do projeto são em
 * parte não-comerciais e todo asset exige crédito no README) e nenhuma
 * dependência nova.
 *
 * Vive em coordenadas locais do `Avatar.view`, ou seja, em pixels do mundo:
 * acompanha o zoom da câmera igual ao nome, sem código de escala próprio.
 */

/** Paleta, espelhando `--amber` e o painel do `styles.css`. */
const AMBER = 0xf4a261;
const INK = 0x181a22;

/** A telinha, em pixels do mundo. O corpo ocupa x -16..16 (16px a 2x). */
const SCREEN_X = 15;
const SCREEN_TOP = -30;
const SCREEN_W = 13;
const SCREEN_H = 18;
const SCREEN_PAD = 1.5;

/** Distância entre dois cards do feed e velocidade da rolagem (px/s). */
const CARD_PITCH = 6;
const FEED_SPEED = 14;

const CONTENT_X = SCREEN_X + SCREEN_PAD;
const CONTENT_Y = SCREEN_TOP + SCREEN_PAD;
const CONTENT_W = SCREEN_W - SCREEN_PAD * 2;
const CONTENT_H = SCREEN_H - SCREEN_PAD * 2;
/**
 * Um card a mais do que cabe na tela: o de cima está saindo enquanto o extra
 * já entrou por baixo, que é o que faz o loop não ter buraco.
 */
const CARD_COUNT = Math.ceil(CONTENT_H / CARD_PITCH) + 1;

const PILL_STYLE = new TextStyle({
  fontFamily: 'system-ui, sans-serif',
  fontSize: 9,
  fontWeight: '800',
  letterSpacing: 1,
  fill: AMBER,
});

/** Respiro entre a pastilha e o nome, e o padding interno dela. */
const PILL_GAP = 3;
const PILL_PAD_X = 5;
const PILL_PAD_Y = 2;

export class AwayIndicator {
  readonly view = new Container();
  private feed = new Container();
  private cards: Graphics[] = [];
  private offset = 0;

  /** @param bottomY onde a base da pastilha encosta (logo acima do nome). */
  constructor(bottomY: number) {
    this.view.visible = false;

    // ---- a telinha ------------------------------------------------------
    const glow = new Graphics()
      .roundRect(SCREEN_X - 2, SCREEN_TOP - 2, SCREEN_W + 4, SCREEN_H + 4, 5)
      .fill({ color: AMBER, alpha: 0.1 });
    const frame = new Graphics()
      .roundRect(SCREEN_X, SCREEN_TOP, SCREEN_W, SCREEN_H, 3)
      .fill({ color: INK, alpha: 0.92 })
      .stroke({ width: 1, color: AMBER, alpha: 0.55 });
    this.view.addChild(glow, frame);

    for (let i = 0; i < CARD_COUNT; i++) {
      const card = new Graphics()
        // miniatura do post
        .roundRect(0, 0, 3.5, 3.5, 1)
        .fill({ color: AMBER, alpha: 0.85 })
        // duas linhas de texto
        .roundRect(4.5, 0.3, CONTENT_W - 4.5, 1.2, 0.6)
        .fill({ color: 0xffffff, alpha: 0.75 })
        .roundRect(4.5, 2.3, CONTENT_W - 6.5, 1.2, 0.6)
        .fill({ color: 0xffffff, alpha: 0.4 });
      this.cards.push(card);
      this.feed.addChild(card);
    }
    this.feed.position.set(CONTENT_X, CONTENT_Y);

    /**
     * A máscara é irmã do feed (e não filha), porque ela vive nas coordenadas
     * do indicador enquanto o feed já está deslocado para dentro da tela.
     */
    const mask = new Graphics()
      .roundRect(CONTENT_X, CONTENT_Y, CONTENT_W, CONTENT_H, 1.5)
      .fill({ color: 0xffffff });
    this.feed.mask = mask;
    this.view.addChild(mask, this.feed);

    // ---- a pastilha "ausente" -------------------------------------------
    const bottom = bottomY - PILL_GAP;
    const label = new Text({ text: 'ausente', style: PILL_STYLE });
    label.resolution = 2;
    label.anchor.set(0.5, 1);
    label.y = bottom - PILL_PAD_Y;

    const w = label.width + PILL_PAD_X * 2;
    const h = label.height + PILL_PAD_Y * 2;
    // raio = metade da altura (cápsula). `roundRect` do Pixi não limita o raio:
    // um valor maior que a metade da menor dimensão deforma o desenho.
    const pill = new Graphics()
      .roundRect(-w / 2, bottom - h, w, h, h / 2)
      .fill({ color: INK, alpha: 0.85 })
      .stroke({ width: 1, color: AMBER, alpha: 0.45 });
    this.view.addChild(pill, label);
  }

  setVisible(visible: boolean): void {
    if (this.view.visible === visible) return;
    this.view.visible = visible;
    // recomeça do topo: reaparecer no meio da rolagem parece glitch
    this.offset = 0;
    this.layoutCards();
  }

  /** Avança a rolagem. Chamar a cada frame do ticker. */
  update(dt: number): void {
    if (!this.view.visible) return;
    this.offset = (this.offset + FEED_SPEED * dt) % CARD_PITCH;
    this.layoutCards();
  }

  private layoutCards(): void {
    for (let i = 0; i < this.cards.length; i++) {
      this.cards[i].y = i * CARD_PITCH - this.offset;
    }
  }
}
