import { Container, Graphics } from 'pixi.js';
import { TILE_SIZE } from '@together/shared';

/**
 * O círculo no chão em volta de quem está numa **booble**.
 *
 * Uma booble tem várias pessoas, então isto NÃO pode viver dentro de um
 * `Avatar` como a pastilha de ausente: é uma camada própria, no mundo, abaixo
 * dos avatares — um decalque de chão, como a sombra e o anel de "falando".
 *
 * O círculo é **descritivo, não normativo**: ele envolve as posições reais dos
 * membros (centroide + o membro mais distante + folga), então ele cresce quando
 * alguém entra e encolhe quando alguém sai, sem número mágico de "raio da booble
 * com N pessoas". Quem decide de fato quem está dentro é o servidor, por
 * `BOOBLE_EXIT_RADIUS`; se o desenho tivesse uma forma própria, ele mentiria em
 * qualquer arranjo que não fosse uma roda perfeita.
 *
 * Elipse e não círculo pela mesma razão que a sombra é elipse: o mapa é visto de
 * cima em perspectiva, e um círculo redondo lê como bolha flutuando em vez de
 * marca no chão.
 *
 * Tudo em `Graphics`: nenhum asset novo (os packs do projeto são em parte
 * não-comerciais e todo asset exige crédito no README).
 */

/** Violeta da booble — o MESMO valor de `--violet` no `styles.css`. */
const VIOLET = 0x8e7dbe;

/** Achatamento da elipse: a mesma proporção do anel de "falando" (13×6). */
const FLATTEN = 0.46;

/**
 * Folga entre o membro mais distante e a borda, para o círculo envolver o corpo
 * e não passar pelo meio dele. Meia largura de avatar mais um respiro.
 */
const PAD = 22;

/** Piso do raio: com duas pessoas colada uma na outra, ainda tem de ler como bolha. */
const MIN_RADIUS = TILE_SIZE * 1.25;

/** A elipse acompanha os pés, não o centro lógico — ver `Avatar.FEET_Y`. */
const FEET_Y = 14;

/** Sua booble aparece mais forte que as dos outros; as duas aparecem. */
const SELF_FILL = 0.1;
const SELF_STROKE = 0.5;
const OTHER_FILL = 0.05;
const OTHER_STROKE = 0.26;

export interface RingMember {
  x: number;
  y: number;
}

export class BoobleRings {
  readonly view = new Container();
  /** um `Graphics` por booble, reaproveitado entre frames */
  private rings = new Map<string, Graphics>();

  /**
   * Redesenha todos os círculos. Chamar a cada frame: as posições dos remotos
   * são interpoladas, então o círculo tem de seguir o movimento — mas só existe
   * `Graphics` para booble que existe, e o caso comum é nenhuma.
   */
  update(groups: Map<string, RingMember[]>, selfBooble: string | null): void {
    for (const [id, g] of this.rings) {
      if (!groups.has(id)) {
        g.destroy();
        this.rings.delete(id);
      }
    }

    for (const [id, members] of groups) {
      let g = this.rings.get(id);
      if (!g) {
        g = new Graphics();
        this.rings.set(id, g);
        this.view.addChild(g);
      }

      let cx = 0;
      let cy = 0;
      for (const m of members) {
        cx += m.x;
        cy += m.y;
      }
      cx /= members.length;
      cy /= members.length;

      let spread = 0;
      for (const m of members) spread = Math.max(spread, Math.hypot(m.x - cx, m.y - cy));
      const rx = Math.max(MIN_RADIUS, spread + PAD);

      const self = id === selfBooble;
      g.clear()
        .ellipse(cx, cy + FEET_Y, rx, rx * FLATTEN)
        .fill({ color: VIOLET, alpha: self ? SELF_FILL : OTHER_FILL })
        .stroke({ width: 2, color: VIOLET, alpha: self ? SELF_STROKE : OTHER_STROKE });
    }
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.rings.clear();
  }
}
