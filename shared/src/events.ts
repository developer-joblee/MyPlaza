import type { ChatMessage, PlayerState, SignalPayload } from './types';
import type { ScenarioId } from './scenarios';

export interface ServerToClientEvents {
  'world:snapshot': (players: PlayerState[], chat: ChatMessage[], scenarioId: ScenarioId) => void;
  'player:joined': (player: PlayerState) => void;
  'player:left': (id: string) => void;
  'player:moved': (id: string, x: number, y: number) => void;
  'chat:message': (msg: ChatMessage) => void;
  'rtc:signal': (payload: SignalPayload) => void;
}

export interface ClientToServerEvents {
  join: (name: string, color: number, scenarioId?: ScenarioId) => void;
  move: (x: number, y: number) => void;
  'chat:send': (text: string) => void;
  'rtc:signal': (payload: Omit<SignalPayload, 'from'>) => void;
}
