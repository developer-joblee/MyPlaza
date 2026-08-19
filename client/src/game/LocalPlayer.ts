import { AVATAR_RADIUS, MOVE_SPEED } from '@together/shared';
import { Avatar } from './Avatar';
import type { CharacterFrames } from './sprites';
import type { Keyboard } from './input';
import type { TilemapBase } from './TilemapBase';

export class LocalPlayer {
  readonly avatar: Avatar;
  x = 0;
  y = 0;

  constructor(frames: CharacterFrames, name: string, color: number) {
    // as frames já vêm resolvidas para o personagem escolhido (ver Game.create)
    this.avatar = new Avatar(frames, name, color, { showProximityRadius: true });
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.avatar.setPosition(x, y);
  }

  /** Move com colisão por eixo separado. Retorna true se a posição mudou. */
  update(dt: number, keyboard: Keyboard, tilemap: TilemapBase): boolean {
    const { x: ax, y: ay } = keyboard.axis;
    this.avatar.setMotion(ax, ay, ax !== 0 || ay !== 0);
    this.avatar.update(dt);
    if (ax === 0 && ay === 0) return false;

    const r = AVATAR_RADIUS - 2; // um pouco menor para não travar em quinas
    let moved = false;

    const nx = this.x + ax * MOVE_SPEED * dt;
    if (ax !== 0 && !tilemap.collidesCircle(nx, this.y, r)) {
      this.x = nx;
      moved = true;
    }
    const ny = this.y + ay * MOVE_SPEED * dt;
    if (ay !== 0 && !tilemap.collidesCircle(this.x, ny, r)) {
      this.y = ny;
      moved = true;
    }

    if (moved) this.avatar.setPosition(this.x, this.y);
    return moved;
  }
}
