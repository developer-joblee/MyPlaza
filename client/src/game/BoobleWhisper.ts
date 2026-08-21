import { Container, Graphics } from 'pixi.js';
import { VIOLET } from './BoobleRings';

/**
 * O balãozinho de **cochicho** ao lado da cabeça de quem está numa booble.
 *
 * O círculo no chão (`BoobleRings`) responde *quem está com quem* — é uma
 * relação, e por isso é um desenho de grupo. Ele não responde a outra pergunta,
 * que é a que faz alguém de longe olhar para lá: *está acontecendo coisa ali?*
 * Um decalque parado no chão lê como marcação de cenário; três pontinhos em
 * onda leem como conversa. É por isso que este indicador é por pessoa mesmo
 * havendo um desenho de grupo — os dois dizem coisas diferentes.
 *
 * **Ele não é um badge de filiação.** A primeira versão da booble tinha uma
 * pastilha "booble" por cabeça e ela foi removida de propósito (ver o histórico
 * em `docs/features/booble.md`): três etiquetas obrigam quem olha a inferir o
 * grupo sozinho, e o círculo já faz isso melhor. Este balão não tem texto, não
 * tem nome e não diz de qual booble a pessoa é — ele só diz "aqui se cochicha".
 *
 * Ele **não** acompanha quem está de fato falando: isso já é o anel verde do
 * `Avatar`, e piscar junto com a voz faria o balão aparecer e sumir a cada
 * frase, que é o oposto de "tem conversa rolando aqui".
 *
 * Tudo em `Graphics`: nenhum asset novo (os packs do projeto são em parte
 * não-comerciais e todo asset exige crédito no README) e nenhuma dependência.
 * Vive em coordenadas locais do `Avatar.view`, ou seja, em pixels do mundo —
 * acompanha o zoom da câmera junto com o avatar, sem código de escala próprio.
 */

/** Mesmo fundo do `AwayIndicator`: o balão tem de ler sobre qualquer chão. */
const INK = 0x181a22;

/**
 * Corpo do balão, ao lado da cabeça — mesma faixa de coordenadas da telinha do
 * `AwayIndicator` (que é fixa e funciona em todos os personagens). Não colide
 * com ela na prática: ficar ausente **sai** da booble.
 */
const CX = 15;
const BOTTOM = -26;
const W = 18;
const H = 11;

/** A cauda: dois pontos descendo para o ombro, que é o que faz ler como fala. */
const TAIL = [
  { x: -7, y: 2, r: 1.7 },
  { x: -9.5, y: 5, r: 1 },
];

/** Os três pontos de dentro. `RISE` é a altura do salto de cada um. */
const DOT_R = 1.5;
const DOT_GAP = 5;
const DOT_RISE = 1.7;

/**
 * Um ciclo da onda e o atraso entre pontos. `PERIOD / 7` deixa a onda correndo
 * da esquerda para a direita sem os três subirem juntos (que lê como pulso de
 * carregamento, não como conversa).
 */
const PERIOD = 1.15;
const DOT_DELAY = PERIOD / 7;

/**
 * Fase inicial de cada balão criado. Sem isto, um grupo inteiro cochicha em
 * uníssono — e coisa viva não bate ponto. Um contador em vez de `Math.random`
 * porque o resultado fica reproduzível entre execuções.
 */
let phaseSeed = 0;

export class BoobleWhisper {
  readonly view = new Container();
  private dots: Graphics[] = [];
  /** onde cada ponto repousa; o salto é medido a partir daqui */
  private restY: number;
  private readonly seed: number;
  private t: number;

  constructor() {
    this.view.visible = false;
    // 0.618 (razão áurea) espalha as fases sem repetir a cada 2 ou 3 avatares
    this.seed = (phaseSeed++ * PERIOD * 0.618) % PERIOD;
    this.t = this.seed;

    const top = BOTTOM - H;
    this.restY = BOTTOM - H / 2;

    const tail = new Graphics();
    for (const t of TAIL) tail.circle(CX + t.x, BOTTOM + t.y, t.r);
    tail.fill({ color: INK, alpha: 0.85 }).stroke({ width: 1, color: VIOLET, alpha: 0.5 });

    // raio = metade da altura (cápsula): `roundRect` do Pixi não limita o raio,
    // e um valor maior que a metade da menor dimensão deforma o desenho.
    const body = new Graphics()
      .roundRect(CX - W / 2, top, W, H, H / 2)
      .fill({ color: INK, alpha: 0.85 })
      .stroke({ width: 1, color: VIOLET, alpha: 0.55 });

    this.view.addChild(tail, body);

    for (let i = 0; i < 3; i++) {
      const dot = new Graphics().circle(0, 0, DOT_R).fill({ color: VIOLET });
      dot.position.set(CX + (i - 1) * DOT_GAP, this.restY);
      this.dots.push(dot);
      this.view.addChild(dot);
    }
    this.layoutDots();
  }

  setVisible(visible: boolean): void {
    if (this.view.visible === visible) return;
    this.view.visible = visible;
    // volta à fase de origem: reaparecer no meio da onda parece glitch, e
    // recomeçar em zero faria todo mundo que entra junto entrar em uníssono
    this.t = this.seed;
    this.layoutDots();
  }

  /** Avança a onda. Chamar a cada frame do ticker. */
  update(dt: number): void {
    if (!this.view.visible) return;
    this.t = (this.t + dt) % PERIOD;
    this.layoutDots();
  }

  private layoutDots(): void {
    for (let i = 0; i < this.dots.length; i++) {
      const wave = Math.sin(((this.t - i * DOT_DELAY) / PERIOD) * Math.PI * 2);
      // só a metade de cima da senoide: os pontos sobem e voltam a repousar,
      // não afundam no balão
      const lift = Math.max(0, wave);
      this.dots[i].y = this.restY - lift * DOT_RISE;
      this.dots[i].alpha = 0.4 + lift * 0.6;
    }
  }
}
