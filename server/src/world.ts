import {
  CHAT_HISTORY_LIMIT,
  SCENARIOS,
  TILE_SIZE,
  parseMap,
  sitFacingAt,
  type CharacterId,
  type ChatMessage,
  type PlayerState,
  type ScenarioId,
  type WorldMap,
} from '@together/shared';

export class World {
  readonly map: WorldMap;
  private readonly spawnTiles: ReadonlyArray<readonly [number, number]>;
  private readonly players = new Map<string, PlayerState>();
  private readonly chatHistory: ChatMessage[] = [];
  private spawnIndex = 0;

  constructor(readonly scenarioId: ScenarioId) {
    this.map = parseMap(scenarioId);
    this.spawnTiles = SCENARIOS[scenarioId].spawnTiles;
  }

  addPlayer(id: string, name: string, color: number, character: CharacterId): PlayerState {
    const [tx, ty] = this.spawnTiles[this.spawnIndex % this.spawnTiles.length];
    this.spawnIndex++;
    const player: PlayerState = {
      id,
      name,
      color,
      character,
      x: tx * TILE_SIZE + TILE_SIZE / 2,
      y: ty * TILE_SIZE + TILE_SIZE / 2,
      sitting: false,
      away: false,
    };
    this.players.set(id, player);
    return player;
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
}

const worlds = new Map<ScenarioId, World>();

export function getWorld(id: ScenarioId): World {
  let world = worlds.get(id);
  if (!world) {
    world = new World(id);
    worlds.set(id, world);
  }
  return world;
}
