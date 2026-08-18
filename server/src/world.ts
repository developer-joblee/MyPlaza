import {
  CHAT_HISTORY_LIMIT,
  SPAWN_TILES,
  TILE_SIZE,
  parseMap,
  type ChatMessage,
  type PlayerState,
} from '@together/shared';

const map = parseMap();
const players = new Map<string, PlayerState>();
const chatHistory: ChatMessage[] = [];
let spawnIndex = 0;

export function addPlayer(id: string, name: string, color: number): PlayerState {
  const [tx, ty] = SPAWN_TILES[spawnIndex % SPAWN_TILES.length];
  spawnIndex++;
  const player: PlayerState = {
    id,
    name,
    color,
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
  players.set(id, player);
  return player;
}

export function removePlayer(id: string): boolean {
  return players.delete(id);
}

export function movePlayer(id: string, x: number, y: number): PlayerState | undefined {
  const player = players.get(id);
  if (!player) return undefined;
  player.x = Math.max(0, Math.min(map.widthPx, x));
  player.y = Math.max(0, Math.min(map.heightPx, y));
  return player;
}

export function getPlayers(): PlayerState[] {
  return [...players.values()];
}

export function hasPlayer(id: string): boolean {
  return players.has(id);
}

export function addChatMessage(msg: ChatMessage): void {
  chatHistory.push(msg);
  if (chatHistory.length > CHAT_HISTORY_LIMIT) {
    chatHistory.splice(0, chatHistory.length - CHAT_HISTORY_LIMIT);
  }
}

export function getChatHistory(): ChatMessage[] {
  return chatHistory;
}
