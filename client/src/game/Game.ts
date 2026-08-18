import { Application, Container } from 'pixi.js';
import { TICK_RATE, parseMap, type PlayerState } from '@together/shared';
import type { AppSocket } from '../net/socket';
import { Keyboard } from './input';
import { Tilemap } from './Tilemap';
import { LocalPlayer } from './LocalPlayer';
import { RemotePlayer } from './RemotePlayer';
import { loadCharacterFrames, type CharacterFrames } from './sprites';

const CAMERA_LERP_RATE = 8;
const SEND_INTERVAL = 1 / TICK_RATE;

export class Game {
  private app: Application;
  private world = new Container();
  private playersLayer = new Container();
  private tilemap: Tilemap;
  private keyboard = new Keyboard();
  private local: LocalPlayer;
  private remotes = new Map<string, RemotePlayer>();
  private sendAccumulator = 0;
  private lastSent = { x: NaN, y: NaN };
  private camX = 0;
  private camY = 0;
  private cameraSnapped = false;
  private unbinders: Array<() => void> = [];

  private constructor(
    app: Application,
    private socket: AppSocket,
    private frames: CharacterFrames,
    selfName: string,
    selfColor: number,
  ) {
    this.app = app;
    this.tilemap = new Tilemap(parseMap());
    this.local = new LocalPlayer(frames, selfName, selfColor);

    this.playersLayer.sortableChildren = true;
    this.world.addChild(this.tilemap.view, this.playersLayer);
    this.playersLayer.addChild(this.local.avatar.view);
    this.app.stage.addChild(this.world);

    this.keyboard.attach();
    this.bindSocket();
    this.app.ticker.add(this.tick);
  }

  static async create(
    container: HTMLElement,
    socket: AppSocket,
    selfName: string,
    selfColor: number,
  ): Promise<Game> {
    const app = new Application();
    const [frames] = await Promise.all([
      loadCharacterFrames(),
      app.init({
        resizeTo: container,
        backgroundColor: 0x1f2129,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      }),
    ]);
    container.appendChild(app.canvas);
    return new Game(app, socket, frames, selfName, selfColor);
  }

  private bindSocket(): void {
    const onSnapshot = (players: PlayerState[]) => {
      // reset completo (cobre também reconexões)
      for (const remote of this.remotes.values()) remote.avatar.view.destroy();
      this.remotes.clear();

      for (const p of players) {
        if (p.id === this.socket.id) {
          this.local.setPosition(p.x, p.y);
          this.cameraSnapped = false;
        } else {
          this.addRemote(p);
        }
      }
    };
    const onJoined = (p: PlayerState) => {
      if (p.id !== this.socket.id) this.addRemote(p);
    };
    const onLeft = (id: string) => {
      const remote = this.remotes.get(id);
      if (remote) {
        remote.avatar.view.destroy();
        this.remotes.delete(id);
      }
    };
    const onMoved = (id: string, x: number, y: number) => {
      this.remotes.get(id)?.setTarget(x, y);
    };

    this.socket.on('world:snapshot', onSnapshot);
    this.socket.on('player:joined', onJoined);
    this.socket.on('player:left', onLeft);
    this.socket.on('player:moved', onMoved);
    this.unbinders.push(() => {
      this.socket.off('world:snapshot', onSnapshot);
      this.socket.off('player:joined', onJoined);
      this.socket.off('player:left', onLeft);
      this.socket.off('player:moved', onMoved);
    });
  }

  private addRemote(p: PlayerState): void {
    const remote = new RemotePlayer(this.frames, p.name, p.color, p.x, p.y);
    this.remotes.set(p.id, remote);
    this.playersLayer.addChild(remote.avatar.view);
  }

  private tick = () => {
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.1);

    const moved = this.local.update(dt, this.keyboard, this.tilemap);
    for (const remote of this.remotes.values()) remote.update(dt);

    // envio de posição com throttle
    this.sendAccumulator += dt;
    if (this.sendAccumulator >= SEND_INTERVAL) {
      this.sendAccumulator = 0;
      const x = Math.round(this.local.x);
      const y = Math.round(this.local.y);
      if ((moved || x !== this.lastSent.x || y !== this.lastSent.y) && this.socket.connected) {
        if (x !== this.lastSent.x || y !== this.lastSent.y) {
          this.lastSent = { x, y };
          this.socket.emit('move', x, y);
        }
      }
    }

    this.updateCamera(dt);
  };

  private updateCamera(dt: number): void {
    const screenW = this.app.renderer.width / this.app.renderer.resolution;
    const screenH = this.app.renderer.height / this.app.renderer.resolution;
    const map = this.tilemap;
    void map;

    const targetX = this.local.x;
    const targetY = this.local.y;

    if (!this.cameraSnapped) {
      this.camX = targetX;
      this.camY = targetY;
      this.cameraSnapped = true;
    } else {
      const t = 1 - Math.exp(-CAMERA_LERP_RATE * dt);
      this.camX += (targetX - this.camX) * t;
      this.camY += (targetY - this.camY) * t;
    }

    this.world.position.set(
      Math.round(screenW / 2 - this.camX),
      Math.round(screenH / 2 - this.camY),
    );
  }

  /** Distância (px) do player local a cada player remoto. */
  getDistances(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, remote] of this.remotes) {
      out.set(id, Math.hypot(remote.x - this.local.x, remote.y - this.local.y));
    }
    return out;
  }

  setSpeaking(id: string, speaking: boolean): void {
    if (id === this.socket.id) {
      this.local.avatar.setSpeaking(speaking);
    } else {
      this.remotes.get(id)?.avatar.setSpeaking(speaking);
    }
  }

  destroy(): void {
    for (const unbind of this.unbinders) unbind();
    this.keyboard.detach();
    this.app.ticker.remove(this.tick);
    this.app.destroy(true, { children: true, texture: true });
  }
}
