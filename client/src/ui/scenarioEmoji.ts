import type { ScenarioId } from '@together/shared';

/**
 * Emoji por cenário. Ficava dentro do `JoinScreen`; saiu para cá quando o lobby
 * passou a mostrar os mesmos cenários — dois mapas iguais em telas diferentes
 * divergiriam no primeiro cenário novo.
 */
export const SCENARIO_EMOJI: Record<ScenarioId, string> = {
  office: '🏢',
  plaza: '🌳',
  ruins: '🏛️',
  studio: '🛋️',
};
