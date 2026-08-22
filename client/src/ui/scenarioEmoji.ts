import { SCENARIOS, type ScenarioId } from '@together/shared';

/**
 * Emoji por cenário. Ficava dentro do `JoinScreen`; saiu para cá quando o lobby
 * passou a mostrar os mesmos cenários — dois mapas iguais em telas diferentes
 * divergiriam no primeiro cenário novo.
 */
export const SCENARIO_EMOJI: Record<ScenarioId, string> = {
  studio: '🛋️',
  office: '🏢',
  cafe: '☕',
};

/**
 * Cenários oferecidos na tela, em ordem. Vale a pena existir por causa do
 * `MULTIPLE_SCENARIOS`: hoje há um cenário só, e um seletor de uma opção é
 * ruído — as telas escondem o seletor e usam o único. Entrando um mapa novo em
 * `shared/src/scenarios.ts`, o seletor reaparece nas duas sem mexer em nenhuma.
 */
export const SCENARIO_LIST = Object.values(SCENARIOS);
export const MULTIPLE_SCENARIOS = SCENARIO_LIST.length > 1;
