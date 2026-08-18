export const SERVER_PORT = 3001;

export const TILE_SIZE = 32;

/** Velocidade do avatar em px/s */
export const MOVE_SPEED = 170;

/** Envios de posição por segundo (client -> server) */
export const TICK_RATE = 15;

/** Raio (px) dentro do qual o áudio conecta */
export const PROXIMITY_RADIUS = TILE_SIZE * 5;

/** Margem extra antes de considerar "fora de alcance" */
export const PROXIMITY_HYSTERESIS = TILE_SIZE * 1.5;

/** Tempo fora de alcance antes de fechar a conexão P2P */
export const DISCONNECT_GRACE_MS = 2000;

export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_MAX_LENGTH = 500;
export const NAME_MAX_LENGTH = 20;

/** Raio do círculo do avatar (px) */
export const AVATAR_RADIUS = 12;

/** Cores disponíveis para o avatar */
export const AVATAR_COLORS = [
  0xe63946, 0xf4a261, 0xe9c46a, 0x2a9d8f,
  0x457b9d, 0x8e7dbe, 0xef476f, 0x06d6a0,
] as const;
