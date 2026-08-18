import {
  CHAT_HISTORY_LIMIT,
  SCENARIOS,
  TILE_SIZE,
  parseMap,
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

  addPlayer(id: string, name: string, color: number): PlayerState {
    const [tx, ty] = this.spawnTiles[this.spawnIndex % this.spawnTiles.length];
    this.spawnIndex++;
    const player: PlayerState = {
      id,
      name,
      color,
      x: tx * TILE_SIZE + TILE_SIZE / 2,
      y: ty * TILE_SIZE + TILE_SIZE / 2,
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
