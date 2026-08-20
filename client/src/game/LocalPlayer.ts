import { AVATAR_RADIUS, MOVE_SPEED, TILE_SIZE } from '@together/shared';
import { Avatar } from './Avatar';
import type { CharacterFrames, SitFacing } from './sprites';
import type { Keyboard } from './input';
import type { SittableSpot, TilemapBase } from './TilemapBase';

/** O que mudou neste tick e precisa ser avisado a quem está fora do Game. */
export interface LocalUpdate {
  moved: boolean;
  /** virou de pé <-> sentado neste tick (para emitir ao servidor) */
  sittingChanged: boolean;
  /** cadeira ao alcance agora, para a dica "E para sentar" */
  nearbyChair: SittableSpot | null;
}

export class LocalPlayer {
  readonly avatar: Avatar;
  x = 0;
  y = 0;
  /** null = de pé; senão, o lado para onde está virado sentado */
  sitting: SitFacing | null = null;
  /** de onde a pessoa veio ao sentar, para levantar de volta no mesmo lugar */
  private standTarget: { x: number; y: number } | null = null;

  constructor(frames: CharacterFrames, name: string, color: number) {
    // as frames já vêm resolvidas para o personagem escolhido (ver Game.create)
    this.avatar = new Avatar(frames, name, color, { showProximityRadius: true });
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.avatar.setPosition(x, y);
  }

  /** Move com colisão por eixo separado, ou trata a cadeira se estiver sentado. */
  update(dt: number, keyboard: Keyboard, tilemap: TilemapBase): LocalUpdate {
    const interact = keyboard.consumeInteract();
    let sittingChanged = false;

    if (this.sitting) {
      // qualquer tecla de movimento também levanta: é o reflexo natural de
      // quem quer sair da cadeira, e evita a sensação de avatar travado
      if (interact || keyboard.moving) {
        this.standUp(tilemap);
        sittingChanged = true;
      } else {
        this.avatar.setMotion(0, 0, false);
        this.avatar.update(dt);
        return { moved: false, sittingChanged, nearbyChair: null };
      }
    }

    const chair = tilemap.sittableNear(this.x, this.y);
    if (!sittingChanged && interact && chair) {
      this.sitDown(chair);
      this.avatar.update(dt);
      return { moved: true, sittingChanged: true, nearbyChair: null };
    }

    const { x: ax, y: ay } = keyboard.axis;
    this.avatar.setMotion(ax, ay, ax !== 0 || ay !== 0);
    this.avatar.update(dt);
    if (ax === 0 && ay === 0) {
      return { moved: sittingChanged, sittingChanged, nearbyChair: chair };
    }

    const r = AVATAR_RADIUS - 2; // um pouco menor para não travar em quinas
    let moved = sittingChanged;

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
    // a cadeira ao alcance muda conforme anda, então é recalculada depois de mover
    return { moved, sittingChanged, nearbyChair: tilemap.sittableNear(this.x, this.y) };
  }

  private sitDown(chair: SittableSpot): void {
    this.standTarget = { x: this.x, y: this.y };
    this.sitting = chair.facing;
    this.avatar.setSitting(chair.facing);
    // a posição vai para o centro da cadeira: é ela que os outros clientes usam
    // para descobrir a direção, então tem de cair dentro do tile certo
    this.setPosition(
      chair.tileX * TILE_SIZE + TILE_SIZE / 2,
      chair.tileY * TILE_SIZE + TILE_SIZE / 2,
    );
  }

  private standUp(tilemap: TilemapBase): void {
    const tileX = Math.floor(this.x / TILE_SIZE);
    const tileY = Math.floor(this.y / TILE_SIZE);
    this.sitting = null;
    this.avatar.setSitting(null);
    // de volta para onde estava; se aquele ponto virou parede (mapa mudou) ou
    // não existe, procura um vizinho livre, e em último caso fica na cadeira
    const alvo = this.standTarget;
    if (alvo && !tilemap.collidesCircle(alvo.x, alvo.y, AVATAR_RADIUS - 2)) {
      this.setPosition(alvo.x, alvo.y);
    } else {
      const livre = tilemap.freeTileNear(tileX, tileY);
      if (livre) this.setPosition(livre.x, livre.y);
    }
    this.standTarget = null;
  }
}
