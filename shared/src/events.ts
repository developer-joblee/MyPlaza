import type { ChatMessage, PlayerState, VoiceTokenResponse } from './types';
import type { CharacterId } from './constants';
import type { ScenarioId } from './scenarios';

export interface ServerToClientEvents {
  'world:snapshot': (players: PlayerState[], chat: ChatMessage[], scenarioId: ScenarioId) => void;
  'player:joined': (player: PlayerState) => void;
  'player:left': (id: string) => void;
  'player:moved': (id: string, x: number, y: number) => void;
  'player:sat': (id: string, sitting: boolean) => void;
  'player:away': (id: string, away: boolean) => void;
  'chat:message': (msg: ChatMessage) => void;
}

export interface ClientToServerEvents {
  /** `character` é opcional: cliente antigo cai no personagem padrão */
  join: (name: string, color: number, scenarioId?: ScenarioId, character?: CharacterId) => void;
  move: (x: number, y: number) => void;
  /**
   * Sentar ou levantar. O servidor confere se o jogador está de fato num tile
   * de cadeira sentável antes de aceitar `true` — um cliente adulterado não
   * senta no meio do corredor.
   */
  sit: (sitting: boolean) => void;
  /** Ficar ausente ou voltar. Sem validação: é só intenção do usuário. */
  away: (away: boolean) => void;
  'chat:send': (text: string) => void;
  /**
   * Pede credenciais de voz. Só por ack — sem payload, para o cliente não
   * poder influenciar sala nem identidade (ambas vêm do socket no servidor).
   */
  'voice:token': (ack: (res: VoiceTokenResponse) => void) => void;
}
