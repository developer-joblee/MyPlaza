import type { ChatMessage, PlayerState, VoiceTokenResponse } from './types';
import type { CharacterId } from './constants';
import type { ScenarioId } from './scenarios';

export interface ServerToClientEvents {
  'world:snapshot': (players: PlayerState[], chat: ChatMessage[], scenarioId: ScenarioId) => void;
  'player:joined': (player: PlayerState) => void;
  'player:left': (id: string) => void;
  'player:moved': (id: string, x: number, y: number) => void;
  'chat:message': (msg: ChatMessage) => void;
}

export interface ClientToServerEvents {
  /** `character` é opcional: cliente antigo cai no personagem padrão */
  join: (name: string, color: number, scenarioId?: ScenarioId, character?: CharacterId) => void;
  move: (x: number, y: number) => void;
  'chat:send': (text: string) => void;
  /**
   * Pede credenciais de voz. Só por ack — sem payload, para o cliente não
   * poder influenciar sala nem identidade (ambas vêm do socket no servidor).
   */
  'voice:token': (ack: (res: VoiceTokenResponse) => void) => void;
}
