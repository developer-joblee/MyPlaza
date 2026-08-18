import { Avatar } from './Avatar';
import type { CharacterFrames } from './sprites';

/** Fator de suavização da interpolação (maior = converge mais rápido). */
const LERP_RATE = 12;
/** Distância mínima ao alvo (px) para considerar que está andando */
const MOVING_EPSILON = 3;

export class RemotePlayer {
  readonly avatar: Avatar;
  x = 0;
  y = 0;
  private targetX = 0;
  private targetY = 0;

  constructor(frames: CharacterFrames, name: string, color: number, x: number, y: number) {
    this.avatar = new Avatar(frames, name, color);
    this.x = this.targetX = x;
    this.y = this.targetY = y;
    this.avatar.setPosition(x, y);
  }

  setTarget(x: number, y: number): void {
    this.targetX = x;
    this.targetY = y;
  }

  update(dt: number): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;
    const moving = Math.hypot(dx, dy) > MOVING_EPSILON;
    this.avatar.setMotion(dx, dy, moving);
    this.avatar.update(dt);

    const t = 1 - Math.exp(-LERP_RATE * dt);
    this.x += dx * t;
    this.y += dy * t;
    this.avatar.setPosition(this.x, this.y);
  }
}
