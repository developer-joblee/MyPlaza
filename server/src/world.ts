import {
  BOOBLE_EXIT_RADIUS,
  BOOBLE_JOIN_RADIUS,
  BOOBLE_MAX_MEMBERS,
  CHAT_HISTORY_LIMIT,
  SCENARIOS,
  TILE_SIZE,
  audioZoneAt,
  distancePx,
  isSolid,
  parseMap,
  sitFacingAt,
  type CharacterId,
  type ChatMessage,
  type PlayerState,
  type ScenarioId,
  type WorldMap,
} from '@together/shared';

/** Posição restaurada do banco — ver `server/src/db.ts`. */
export interface ResumePosition {
  x: number;
  y: number;
  sitting: boolean;
}

export class World {
  readonly map: WorldMap;
  private readonly spawnTiles: ReadonlyArray<readonly [number, number]>;
  private readonly players = new Map<string, PlayerState>();
  private readonly chatHistory: ChatMessage[] = [];
  private spawnIndex = 0;
  private chatHydrated = false;

  /**
   * `key` identifica ESTE mundo; `scenarioId` diz qual mapa ele usa.
   *
   * Os dois existem separados porque duas empresas podem usar o mesmo cenário e
   * **não** podem se ver: antes o mundo era indexado pelo cenário, então o
   * Estúdio da empresa A e o da empresa B eram o mesmo lugar — inclusive a
   * mesma sala de voz. A chave é o `places.id` quando há banco, e um sintético
   * por cenário quando não há.
   */
  constructor(
    readonly key: string,
    readonly scenarioId: ScenarioId,
  ) {
    this.map = parseMap(scenarioId);
    this.spawnTiles = SCENARIOS[scenarioId].spawnTiles;
  }

  /** Quantas pessoas estão dentro agora — é o que a lotação compara. */
  get size(): number {
    return this.players.size;
  }

  /**
   * Entra no mundo. Com `resume`, tenta voltar para onde a pessoa parou; se
   * aquela posição não serve mais (ver `validResume`), cai no spawn normal.
   */
  addPlayer(
    id: string,
    name: string,
    color: number,
    character: CharacterId,
    resume?: ResumePosition | null,
  ): PlayerState {
    const at = (resume && this.validResume(resume)) || this.nextSpawn();
    const player: PlayerState = {
      id,
      name,
      color,
      character,
      x: at.x,
      y: at.y,
      sitting: at.sitting,
      away: false,
      boobleId: null,
    };
    this.players.set(id, player);
    return player;
  }

  private nextSpawn(): ResumePosition {
    const [tx, ty] = this.spawnTiles[this.spawnIndex % this.spawnTiles.length];
    this.spawnIndex++;
    return { x: tx * TILE_SIZE + TILE_SIZE / 2, y: ty * TILE_SIZE + TILE_SIZE / 2, sitting: false };
  }

  /**
   * A posição salva ainda é válida NESTE mapa?
   *
   * Existe porque a posição é gravada em pixels e o mapa é editável: mexer no
   * ASCII de `shared/src/scenarios.ts` pode transformar o chão de ontem na
   * parede de hoje, e restaurar às cegas prenderia a pessoa dentro dela.
   *
   * A regra tem uma exceção que parece contradição: tile de cadeira é `isSolid`
   * (ninguém atravessa uma cadeira), mas quem senta fica exatamente **em cima**
   * dela. Então um tile sólido é aceito quando é uma cadeira sentável e a pessoa
   * saiu sentada; qualquer outro sólido é recusado.
   */
  private validResume(resume: ResumePosition): ResumePosition | null {
    const { x, y, sitting } = resume;
    if (!isFinite(x) || !isFinite(y)) return null;
    if (x < 0 || y < 0 || x > this.map.widthPx || y > this.map.heightPx) return null;
    const tile = this.map.tiles[Math.floor(y / TILE_SIZE)]?.[Math.floor(x / TILE_SIZE)];
    if (tile === undefined) return null;
    if (isSolid(tile)) {
      return sitting && sitFacingAt(tile) !== null ? { x, y, sitting: true } : null;
    }
    // chão livre: a pessoa pode ter saído sentada de uma cadeira que virou chão
    return { x, y, sitting: false };
  }

  removePlayer(id: string): boolean {
    return this.players.delete(id);
  }

  movePlayer(id: string, x: number, y: number): PlayerState | undefined {
    const player = this.players.get(id);
    if (!player) return undefined;
    player.x = Math.max(0, Math.min(this.map.widthPx, x));
    player.y = Math.max(0, Math.min(this.map.heightPx, y));
    // andou => não está mais sentado (cobre o cliente que esquece de avisar)
    if (player.sitting && this.sitFacingUnder(player) === null) player.sitting = false;
    return player;
  }

  /**
   * Em que zona de áudio (sala fechada) cai esta posição — `null` é área
   * aberta. É a MESMA função que o cliente usa (`audioZoneAt`, em `shared/`),
   * então servidor e cliente nunca discordam sobre onde a sala começa.
   *
   * Existe para o servidor poder registrar visita de sala sem evento novo no
   * protocolo: ele já tem a posição e o cenário, que é tudo que a conta precisa.
   */
  zoneKeyAt(x: number, y: number): string | null {
    const zone = audioZoneAt(
      this.scenarioId,
      Math.floor(x / TILE_SIZE),
      Math.floor(y / TILE_SIZE),
    );
    return zone?.id ?? null;
  }

  /** Para que lado sentaria quem está nesta posição, ou null se não dá. */
  sitFacingUnder(player: PlayerState): 'left' | 'right' | null {
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor(player.y / TILE_SIZE);
    const tile = this.map.tiles[ty]?.[tx];
    return tile === undefined ? null : sitFacingAt(tile);
  }

  /**
   * Marca sentado/de pé. Recusa (devolve undefined) quem pede para sentar sem
   * estar num tile de cadeira sentável — a validação vive aqui porque o mundo é
   * quem tem o mapa.
   */
  setSitting(id: string, sitting: boolean): PlayerState | undefined {
    const player = this.players.get(id);
    if (!player) return undefined;
    if (sitting && this.sitFacingUnder(player) === null) return undefined;
    if (player.sitting === sitting) return undefined; // nada mudou, não retransmite
    player.sitting = sitting;
    return player;
  }

  /** Ausente/presente. Não há o que validar: é intenção do usuário. */
  setAway(id: string, away: boolean): PlayerState | undefined {
    const player = this.players.get(id);
    if (!player || player.away === away) return undefined;
    player.away = away;
    return player;
  }

  // ------------------------------------------------------------------ booble
  //
  // A booble é um grupo ad-hoc que prioriza o áudio de quem está dentro. Ela
  // mora aqui, e não num mapa próprio, porque *é* o conjunto de players com o
  // mesmo `boobleId` — sem lista paralela não há segunda fonte de verdade para
  // dessincronizar. O servidor é dono da FILIAÇÃO (é quem tem as posições, logo
  // é quem pode impor o raio); quem decide volume é cada cliente.
  //
  // Os três mutadores seguem o contrato do resto da classe, com uma diferença:
  // devolvem uma LISTA, porque uma mudança de booble pode alterar mais de um
  // player de uma vez. Lista vazia = nada mudou = não retransmite.

  /** Quem está nesta booble. `null` não é booble nenhuma, é a ausência de uma. */
  boobleMembers(boobleId: string): PlayerState[] {
    return [...this.players.values()].filter((p) => p.boobleId === boobleId);
  }

  private distanceBetween(a: PlayerState, b: PlayerState): number {
    return distancePx(a.x, a.y, b.x, b.y);
  }

  /**
   * Tira alguém da booble em que está.
   *
   * **Dissolve a booble se sobrar uma pessoa só**: uma booble de um não prioriza
   * nada — ela apenas baixaria a sala inteira a 7% para quem ficou, que é o
   * oposto do que a feature promete. Por isso pode devolver dois players.
   */
  leaveBooble(id: string): PlayerState[] {
    const player = this.players.get(id);
    if (!player || player.boobleId === null) return [];
    const previous = player.boobleId;
    player.boobleId = null;
    const changed = [player];
    const remaining = this.boobleMembers(previous);
    if (remaining.length === 1) {
      remaining[0].boobleId = null;
      changed.push(remaining[0]);
    }
    return changed;
  }

  /**
   * Entra na booble do alvo, criando uma com os dois se ele não tiver nenhuma.
   *
   * Todas as recusas devolvem lista vazia, e nenhuma responde nada a quem
   * pediu — a lista completa e o porquê de cada uma estão no JSDoc de
   * `booble:join` em `shared/src/events.ts`.
   */
  joinBooble(id: string, targetId: string): PlayerState[] {
    const player = this.players.get(id);
    const target = this.players.get(targetId);
    if (!player || !target || player === target) return [];
    // ausente não fala nem ouve: entrar seria segurar uma vaga em silêncio
    if (player.away || target.away) return [];
    // já estamos na mesma: nada a fazer (e nada a retransmitir)
    if (player.boobleId !== null && player.boobleId === target.boobleId) return [];
    if (this.distanceBetween(player, target) > BOOBLE_JOIN_RADIUS) return [];
    /**
     * Mesma zona só para ENTRAR. Permanecer não exige, e a assimetria é o ponto:
     * se desse para entrar atravessando a parede, quem está fora de uma sala
     * fechada puxaria quem está dentro, e morre a promessa "para ouvir, precisa
     * entrar". Formada a booble, ela atravessa a porta com as pessoas.
     */
    if (this.zoneKeyAt(player.x, player.y) !== this.zoneKeyAt(target.x, target.y)) return [];

    const existing = target.boobleId;
    const size = existing === null ? 2 : this.boobleMembers(existing).length + 1;
    if (size > BOOBLE_MAX_MEMBERS) return [];

    // sai da anterior primeiro — o que pode dissolvê-la, e isso também é mudança
    const changed = this.leaveBooble(id);
    if (existing === null) {
      const boobleId = crypto.randomUUID();
      target.boobleId = boobleId;
      player.boobleId = boobleId;
      if (!changed.includes(target)) changed.push(target);
    } else {
      player.boobleId = existing;
    }
    if (!changed.includes(player)) changed.push(player);
    return changed;
  }

  /**
   * Sai da booble quem se afastou de **todos** os outros membros. Chamado depois
   * de cada movimento: é aqui que a regra de distância é imposta, e é a única
   * forma de sair sem clicar.
   *
   * Compara contra o membro mais próximo, não contra todos, porque uma roda de
   * quatro pessoas é mais larga que um raio — exigir proximidade de todo mundo
   * dissolveria a booble por geometria em vez de por intenção. E usa só
   * distância, **sem** zona: é isto que faz a booble atravessar a parede.
   */
  evictFarBooble(id: string): PlayerState[] {
    const player = this.players.get(id);
    if (!player || player.boobleId === null) return [];
    const others = this.boobleMembers(player.boobleId).filter((p) => p !== player);
    if (others.some((o) => this.distanceBetween(player, o) <= BOOBLE_EXIT_RADIUS)) return [];
    return this.leaveBooble(id);
  }

  getPlayers(): PlayerState[] {
    return [...this.players.values()];
  }

  hasPlayer(id: string): boolean {
    return this.players.has(id);
  }

  getPlayer(id: string): PlayerState | undefined {
    return this.players.get(id);
  }

  addChatMessage(msg: ChatMessage): void {
    this.chatHistory.push(msg);
    if (this.chatHistory.length > CHAT_HISTORY_LIMIT) {
      this.chatHistory.splice(0, this.chatHistory.length - CHAT_HISTORY_LIMIT);
    }
  }

  getChatHistory(): ChatMessage[] {
    return this.chatHistory;
  }

  /**
   * Semeia o histórico com o que veio do banco, uma vez por mundo (o primeiro
   * `join` naquele cenário depois do boot). Ignora chamadas seguintes: a partir
   * daí a memória é a versão mais nova, e reaplicar duplicaria mensagens.
   */
  hydrateChat(messages: ChatMessage[]): void {
    if (this.chatHydrated) return;
    this.chatHydrated = true;
    if (messages.length === 0) return;
    const known = new Set(this.chatHistory.map((m) => m.id));
    this.chatHistory.unshift(...messages.filter((m) => !known.has(m.id)));
    if (this.chatHistory.length > CHAT_HISTORY_LIMIT) {
      this.chatHistory.splice(0, this.chatHistory.length - CHAT_HISTORY_LIMIT);
    }
  }

  get isChatHydrated(): boolean {
    return this.chatHydrated;
  }
}

const worlds = new Map<string, World>();

/**
 * O mundo de uma chave de local, criando na primeira vez.
 *
 * Indexado por LOCAL, não por cenário: é o que isola uma empresa da outra. Ver
 * o comentário do construtor.
 */
export function getWorld(key: string, scenarioId: ScenarioId): World {
  let world = worlds.get(key);
  if (!world) {
    world = new World(key, scenarioId);
    worlds.set(key, world);
  }
  return world;
}

/**
 * Quantas pessoas estão neste mundo agora, sem criá-lo se não existir.
 *
 * É isto que o lobby mostra e o que a lotação compara — e sai da MEMÓRIA, não
 * de `sessions` no banco: sessão que não fechou por queda de conexão contaria
 * gente que já saiu, e um mundo apareceria cheio e vazio ao mesmo tempo.
 *
 * Mundo que ninguém abriu desde o boot simplesmente não existe aqui, e zero é a
 * resposta certa.
 */
export function worldOnlineCount(key: string): number {
  return worlds.get(key)?.size ?? 0;
}

/**
 * Chave de mundo para quem roda sem banco: um mundo por cenário, que é
 * exatamente o comportamento anterior. Prefixada para nunca colidir com um
 * uuid de `places.id`.
 */
export function scenarioWorldKey(scenarioId: ScenarioId): string {
  return `scenario-${scenarioId}`;
}
