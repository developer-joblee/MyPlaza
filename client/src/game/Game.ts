import { Application, Container } from 'pixi.js';
import { SCENARIOS, TICK_RATE, TILE_SIZE, parseMap, type PlayerState, type ScenarioId } from '@together/shared';
import type { AppSocket } from '../net/socket';
import { useStore } from '../state/store';
import { Keyboard } from './input';
import { TilemapBase } from './TilemapBase';
import { Tilemap } from './Tilemap';
import { OfficeTilemap } from './OfficeTilemap';
import { RuinsTilemap, loadRuinsTextures, type RuinsTextures } from './RuinsTilemap';
import { ModernTilemap, loadModernTextures, type ModernTextures } from './ModernTilemap';
import { LocalPlayer } from './LocalPlayer';
import { RemotePlayer } from './RemotePlayer';
import { loadCharacterFrames, type CharacterFrames } from './sprites';
import { loadTilesets, type Tilesets } from './tilesets';

const CAMERA_LERP_RATE = 8;
const SEND_INTERVAL = 1 / TICK_RATE;
const ZOOM_LERP_RATE = 10;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

export class Game {
  private app: Application;
  private world = new Container();
  private playersLayer = new Container();
  private tilemap: TilemapBase;
  private keyboard = new Keyboard();
  private local: LocalPlayer;
  private remotes = new Map<string, RemotePlayer>();
  private sendAccumulator = 0;
  private lastSent = { x: NaN, y: NaN };
  private camX = 0;
  private camY = 0;
  private cameraSnapped = false;
  private zoom = 1;
  private targetZoom = 1;
  private unbinders: Array<() => void> = [];

  private constructor(
    app: Application,
    private socket: AppSocket,
    private frames: CharacterFrames,
    themeAssets: Tilesets | RuinsTextures | ModernTextures | null,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
  ) {
    this.app = app;
    const map = parseMap(scenarioId);
    const theme = SCENARIOS[scenarioId].theme;
    this.tilemap =
      theme === 'garden'
        ? new Tilemap(map, themeAssets as Tilesets)
        : theme === 'ruins'
          ? new RuinsTilemap(map, themeAssets as RuinsTextures)
          : theme === 'modern'
            ? new ModernTilemap(map, themeAssets as ModernTextures)
            : new OfficeTilemap(map);
    this.local = new LocalPlayer(frames, selfName, selfColor);

    this.playersLayer.sortableChildren = true;
    this.world.addChild(this.tilemap.view, this.playersLayer);
    this.playersLayer.addChild(this.local.avatar.view);
    for (const prop of this.tilemap.props) this.playersLayer.addChild(prop);
    this.app.stage.addChild(this.world);

    this.keyboard.attach();
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.bindSocket();
    this.app.ticker.add(this.tick);

    (window as unknown as Record<string, unknown>).__togetherPos = () => this.selfPosition;
  }

  /** Posição do player local, em px do mundo e em tiles. Debug no console. */
  get selfPosition(): { x: number; y: number; tileX: number; tileY: number } {
    return {
      x: Math.round(this.local.x),
      y: Math.round(this.local.y),
      tileX: Math.floor(this.local.x / TILE_SIZE),
      tileY: Math.floor(this.local.y / TILE_SIZE),
    };
  }

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.exp(-e.deltaY * 0.0012));
  };

  static async create(
    container: HTMLElement,
    socket: AppSocket,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
  ): Promise<Game> {
    const app = new Application();
    const theme = SCENARIOS[scenarioId].theme;
    const [frames, themeAssets] = await Promise.all([
      loadCharacterFrames(),
      // o escritório é procedural — não carrega texturas de tiles
      theme === 'garden'
        ? loadTilesets()
        : theme === 'ruins'
          ? loadRuinsTextures()
          : theme === 'modern'
            ? loadModernTextures()
            : Promise.resolve(null),
      app.init({
        resizeTo: container,
        backgroundColor: 0x1f2129,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      }),
    ]);
    container.appendChild(app.canvas);
    return new Game(app, socket, frames, themeAssets, selfName, selfColor, scenarioId);
  }

  private bindSocket(): void {
    const onSnapshot = (players: PlayerState[]) => {
      // reset completo (cobre também reconexões)
      for (const remote of this.remotes.values()) remote.avatar.destroy();
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
        remote.avatar.destroy();
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
    this.tilemap.animate(dt);

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

    const zt = 1 - Math.exp(-ZOOM_LERP_RATE * dt);
    this.zoom += (this.targetZoom - this.zoom) * zt;

    this.world.scale.set(this.zoom);
    this.world.position.set(
      Math.round(screenW / 2 - this.camX * this.zoom),
      Math.round(screenH / 2 - this.camY * this.zoom),
    );
  }

  /** Define o zoom alvo (suavizado no ticker) e sincroniza a UI. */
  setZoom(target: number): void {
    this.targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, target));
    useStore.getState().setZoomPct(Math.round(this.targetZoom * 100));
  }

  zoomBy(factor: number): void {
    this.setZoom(this.targetZoom * factor);
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
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.keyboard.detach();
    this.app.ticker.remove(this.tick);
    // senão o hook sobrevive à sessão e consulta um Game já destruído
    delete (window as unknown as Record<string, unknown>).__togetherPos;
    // texture:false de propósito: as texturas de sprite/tileset são cacheadas em
    // nível de módulo e reusadas pela próxima sessão (sair e voltar)
    this.app.destroy(true, { children: true, texture: false });
  }
}
