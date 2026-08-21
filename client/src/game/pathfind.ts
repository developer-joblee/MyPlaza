import { TILE_SIZE } from '@together/shared';

/**
 * Rota até alguém, em tiles, para a auto-caminhada do "ir até".
 *
 * Por que existe pathfinding aqui: andar em linha reta com o deslize por eixo que
 * o `LocalPlayer` já faz **não** chega. A sala de reunião do Estúdio tem uma
 * porta de dois tiles numa parede inteira, e sala fechada é justamente de onde
 * alguém chama — a reta bate na parede, o deslize encosta e para. O caso não é
 * exótico, é o caso comum da feature.
 *
 * O que este módulo decide é **por onde**; quem continua dono de **como** é o
 * código de movimento que já existe (`MOVE_SPEED * dt` com `collidesCircle`).
 * Por isso a caminhabilidade aqui é o MESMO predicado da colisão (`isSolidAt`) —
 * uma segunda noção de "livre" acabaria divergindo da colisão real, e o sintoma
 * seria um avatar tentando atravessar parede para sempre.
 */

/**
 * O que a rota precisa saber do cenário. É a forma que o `TilemapBase` já tem,
 * declarada como interface para o BFS poder ser exercitado com uma grade de
 * mentira, sem Pixi e sem navegador.
 */
export interface WalkGrid {
  isSolidAt(tileX: number, tileY: number): boolean;
  collidesCircle(x: number, y: number, radius: number): boolean;
}

export interface Point {
  x: number;
  y: number;
}

/** Passo de amostragem da linha reta entre dois waypoints. */
const LOS_STEP = TILE_SIZE / 4;

const NEIGHBORS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

const tileKey = (tx: number, ty: number) => `${tx},${ty}`;
const tileCenter = (tx: number, ty: number): Point => ({
  x: tx * TILE_SIZE + TILE_SIZE / 2,
  y: ty * TILE_SIZE + TILE_SIZE / 2,
});

/**
 * Existe reta livre entre dois pontos para um círculo de raio `radius`?
 *
 * Amostragem, não geometria exata: a colisão do jogo já é AABB de tiles
 * (conservadora), e um passo de 1/4 de tile é bem menor que o menor obstáculo
 * possível, que é um tile inteiro.
 */
function lineIsClear(grid: WalkGrid, a: Point, b: Point, radius: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const passos = Math.max(1, Math.ceil(dist / LOS_STEP));
  for (let i = 1; i <= passos; i++) {
    const t = i / passos;
    if (grid.collidesCircle(a.x + dx * t, a.y + dy * t, radius)) return false;
  }
  return true;
}

/**
 * Tira os waypoints intermediários enquanto a reta até o próximo estiver livre.
 *
 * Sem isto o avatar anda em escadinha ortogonal em campo aberto, porque o BFS é
 * de 4 direções — e escadinha é muito mais visível no olho do que parece na
 * descrição.
 */
function smooth(grid: WalkGrid, path: Point[], from: Point, radius: number): Point[] {
  const out: Point[] = [];
  let atual = from;
  let i = 0;
  while (i < path.length) {
    // o waypoint mais distante que ainda se alcança em linha reta
    let melhor = i;
    for (let j = path.length - 1; j > i; j--) {
      if (lineIsClear(grid, atual, path[j]!, radius)) {
        melhor = j;
        break;
      }
    }
    out.push(path[melhor]!);
    atual = path[melhor]!;
    i = melhor + 1;
  }
  return out;
}

/**
 * A rota de `from` até o mais perto que se consegue chegar de `to`, como uma
 * lista de pontos (centros de tile, exceto quando cortados pelo `smooth`).
 *
 * Devolve `[]` quando já não há para onde ir — o começo já é o ponto alcançável
 * mais próximo do alvo. Nunca devolve "não achei caminho": o BFS conhece a
 * distância de tudo o que alcançou, então quando o alvo é inalcançável (ou está
 * num tile **sólido**, que é o caso garantido de quem está *sentado* — cadeira é
 * sólida) a rota termina no tile alcançável mais perto dele. Um "não foi possível
 * ir até essa pessoa" seria uma mensagem que a interface não teria o que fazer
 * com.
 */
export function findPath(grid: WalkGrid, from: Point, to: Point, radius: number): Point[] {
  const startTx = Math.floor(from.x / TILE_SIZE);
  const startTy = Math.floor(from.y / TILE_SIZE);
  if (grid.isSolidAt(startTx, startTy)) return [];

  // BFS a partir de mim. Não precisa de limite artificial: fora do mapa conta
  // como sólido, então a busca é contida pelo próprio cenário (no maior deles,
  // as Ruínas, são 4060 tiles — sub-milissegundo, e roda no clique e no repath,
  // não por frame).
  const veioDe = new Map<string, string | null>([[tileKey(startTx, startTy), null]]);
  const fila: Array<[number, number]> = [[startTx, startTy]];
  let melhorTile: [number, number] = [startTx, startTy];
  let melhorDist = Math.hypot(tileCenter(startTx, startTy).x - to.x, tileCenter(startTx, startTy).y - to.y);

  for (let head = 0; head < fila.length; head++) {
    const [tx, ty] = fila[head]!;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = tx + dx;
      const ny = ty + dy;
      const key = tileKey(nx, ny);
      if (veioDe.has(key) || grid.isSolidAt(nx, ny)) continue;
      veioDe.set(key, tileKey(tx, ty));
      fila.push([nx, ny]);
      // o alvo é uma POSIÇÃO, não um tile: a proximidade é medida em px, senão
      // dois tiles empatariam e a escolha ficaria a critério da ordem da fila
      const centro = tileCenter(nx, ny);
      const dist = Math.hypot(centro.x - to.x, centro.y - to.y);
      if (dist < melhorDist) {
        melhorDist = dist;
        melhorTile = [nx, ny];
      }
    }
  }

  // reconstrói de trás para a frente, sem incluir o tile de partida
  const tiles: Array<[number, number]> = [];
  let cursor: string | null = tileKey(melhorTile[0], melhorTile[1]);
  const inicio = tileKey(startTx, startTy);
  while (cursor && cursor !== inicio) {
    const [cx, cy] = cursor.split(',').map(Number) as [number, number];
    tiles.push([cx, cy]);
    cursor = veioDe.get(cursor) ?? null;
  }
  tiles.reverse();
  if (tiles.length === 0) return [];

  return smooth(
    grid,
    tiles.map(([tx, ty]) => tileCenter(tx, ty)),
    from,
    radius,
  );
}
