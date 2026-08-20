import { TILE_SIZE } from '@together/shared';
import { Avatar } from './Avatar';
import type { CharacterFrames } from './sprites';
import type { TilemapBase } from './TilemapBase';

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
  private sitting = false;

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

  setSitting(sitting: boolean): void {
    this.sitting = sitting;
  }

  update(dt: number, tilemap: TilemapBase): void {
    const dx = this.targetX - this.x;
    const dy = this.targetY - this.y;

    if (this.sitting) {
      /**
       * A direção sai do tile de **destino**, não da posição interpolada: o
       * evento de sentar e o de posição são independentes, então quando o
       * "sentou" chega o avatar pode ainda estar deslizando para a cadeira.
       * Usar o destino faz a pose entrar na hora e no lado certo. Enquanto o
       * destino ainda não for uma cadeira, continua de pé em vez de adivinhar.
       */
      const facing = tilemap.sitFacingAtTile(
        Math.floor(this.targetX / TILE_SIZE),
        Math.floor(this.targetY / TILE_SIZE),
      );
      this.avatar.setSitting(facing);
    } else {
      this.avatar.setSitting(null);
      this.avatar.setMotion(dx, dy, Math.hypot(dx, dy) > MOVING_EPSILON);
    }

    this.avatar.update(dt);

    const t = 1 - Math.exp(-LERP_RATE * dt);
    this.x += dx * t;
    this.y += dy * t;
    this.avatar.setPosition(this.x, this.y);
  }
}
