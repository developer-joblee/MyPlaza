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

/** Tempo fora de alcance antes de cortar o vídeo de tela */
export const DISCONNECT_GRACE_MS = 2000;

/**
 * Raio de *subscrição* de áudio — bem maior que o audível de propósito.
 * `volumeForDistance()` já devolve 0 além de PROXIMITY_RADIUS, então a faixa
 * entre os dois fica assinada e inaudível: é pré-carregamento. Precisa ser
 * maior que (latência de subscrição × MOVE_SPEED): 240px de folga ÷ 170px/s
 * = 1,4s, contra ~0,8s de pior caso para assinar.
 */
export const AUDIO_SUBSCRIBE_RADIUS = PROXIMITY_RADIUS * 2.5;

/** Tempo fora do raio de subscrição antes de desassinar o áudio */
export const AUDIO_SUBSCRIBE_GRACE_MS = 8000;

/** Teto de streams de áudio assinados ao mesmo tempo (os mais próximos ganham) */
export const MAX_AUDIO_SUBSCRIPTIONS = 16;

/** Intervalo do tick que reconcilia subscrição e volume por distância */
export const VOICE_TICK_MS = 250;

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

/**
 * Personagens disponíveis. Aqui só moram os ids e os rótulos, porque isto é
 * protocolo: o servidor precisa validar a escolha e os outros clientes precisam
 * saber qual boneco desenhar. Como cada um é desenhado (spritesheet, tamanho do
 * quadro, recorte de cada direção) é assunto do cliente, em
 * `client/src/game/sprites.ts`.
 */
export const CHARACTERS = [
  { id: 'adam', label: 'Adam' },
  { id: 'alex', label: 'Alex' },
  { id: 'amelia', label: 'Amélia' },
  { id: 'bob', label: 'Bob' },
  { id: 'proto', label: 'Protótipo' },
] as const;

export type CharacterId = (typeof CHARACTERS)[number]['id'];

export const DEFAULT_CHARACTER: CharacterId = 'adam';

export function isCharacterId(value: unknown): value is CharacterId {
  return CHARACTERS.some((c) => c.id === value);
}
