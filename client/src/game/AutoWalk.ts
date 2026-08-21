import { AVATAR_RADIUS, BOOBLE_JOIN_RADIUS } from '@together/shared';
import { findPath, type Point, type WalkGrid } from './pathfind';

/**
 * A auto-caminhada do "ir até": leva o avatar local até o personagem de quem
 * chamou, contornando parede, enquanto essa pessoa continua andando.
 *
 * Devolve um **vetor contínuo** por frame, e não uma das oito direções do
 * teclado: com as oito o avatar chegaria em zigue-zague de 45° e ficaria
 * oscilando meio pixel em volta do destino para sempre. O `MOVE_SPEED * dt` do
 * `LocalPlayer` aceita qualquer vetor normalizado sem mudança nenhuma.
 *
 * Quem cancela é o `Game`: tecla de movimento, `E`, chegada, prazo, ou o alvo
 * saindo do mundo.
 */

/**
 * De quanto em quanto tempo a rota é recalculada. O alvo é uma pessoa e ela
 * continua andando (foi a escolha explícita: perseguir, não congelar o destino),
 * então a rota envelhece — mas recalcular por frame é BFS 60 vezes por segundo
 * para responder uma pergunta que muda devagar. Meio segundo a 170 px/s é ~2,5
 * tiles de erro no pior caso, e o vetor contínuo já corrige o resto.
 */
const REPATH_MS = 500;

/**
 * Teto de tempo da caminhada. Existe para o caso em que a pessoa que chamou sai
 * andando mais rápido do que se chega até ela (ou fica num canto onde a rota
 * oscila): sem prazo, o avatar seguiria para sempre e a única saída seria tocar
 * o teclado. Atravessar o maior cenário leva ~13s, então 20s é generoso.
 */
const TIMEOUT_MS = 20000;

/**
 * A que distância do alvo a caminhada termina — 2 tiles, o mesmo
 * `BOOBLE_JOIN_RADIUS`. Não é coincidência nem gosto: é exatamente o raio em que
 * a **booble** fica disponível, então o "ir até" desemboca na distância de
 * conversa em vez de parar em cima da pessoa (avatares não colidem, e terminar
 * sobreposto fica feio e não serve para nada).
 */
const STOP_RADIUS = BOOBLE_JOIN_RADIUS;

/** O mesmo raio efetivo que a colisão do `LocalPlayer` usa. */
const WALK_RADIUS = AVATAR_RADIUS - 2;

/** Perto o bastante de um waypoint para passar ao próximo. */
const WAYPOINT_EPS = 4;

export class AutoWalk {
  /** `socket.id` de quem estou indo encontrar; `null` = não estou caminhando. */
  private targetId: string | null = null;
  private path: Point[] = [];
  private repathAt = 0;
  private deadline = 0;

  get active(): boolean {
    return this.targetId !== null;
  }

  get target(): string | null {
    return this.targetId;
  }

  start(targetId: string): void {
    this.targetId = targetId;
    this.path = [];
    this.repathAt = 0; // recalcula no primeiro frame
    this.deadline = performance.now() + TIMEOUT_MS;
  }

  cancel(): void {
    this.targetId = null;
    this.path = [];
  }

  /**
   * O vetor de direção deste frame, ou `null` quando não há caminhada (ou ela
   * acabou de terminar — chegada, prazo, ou alvo que sumiu). Cancelar sozinho
   * aqui é de propósito: o `Game` não precisa repetir as três condições.
   *
   * `targetPos` é `null` quando o alvo não está mais no mundo.
   */
  step(from: Point, targetPos: Point | null, grid: WalkGrid): Point | null {
    if (!this.targetId) return null;
    const agora = performance.now();
    if (!targetPos || agora > this.deadline) {
      this.cancel();
      return null;
    }
    if (Math.hypot(targetPos.x - from.x, targetPos.y - from.y) <= STOP_RADIUS) {
      this.cancel();
      return null;
    }

    if (agora >= this.repathAt) {
      this.repathAt = agora + REPATH_MS;
      this.path = findPath(grid, from, targetPos, WALK_RADIUS);
    }

    // consome os waypoints já alcançados; a rota vazia com o alvo ainda longe
    // significa que não há como chegar mais perto — o BFS já devolve o melhor
    // alcançável, então insistir seria andar contra a parede
    while (this.path.length > 0) {
      const alvo = this.path[0]!;
      if (Math.hypot(alvo.x - from.x, alvo.y - from.y) > WAYPOINT_EPS) break;
      this.path.shift();
    }
    const proximo = this.path[0];
    if (!proximo) {
      this.cancel();
      return null;
    }

    const dx = proximo.x - from.x;
    const dy = proximo.y - from.y;
    const dist = Math.hypot(dx, dy) || 1;
    return { x: dx / dist, y: dy / dist };
  }
}
