import { PROXIMITY_RADIUS } from '@together/shared';

/** Volume total até 40% do raio, depois rampa linear até 0 no limite. */
export function volumeForDistance(distance: number): number {
  const fullUntil = PROXIMITY_RADIUS * 0.4;
  if (distance <= fullUntil) return 1;
  const v = 1 - (distance - fullUntil) / (PROXIMITY_RADIUS - fullUntil);
  return Math.max(0, Math.min(1, v));
}
