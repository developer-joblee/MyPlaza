import { Application, Container } from 'pixi.js';
import {
  DEFAULT_CHARACTER,
  SCENARIOS,
  TICK_RATE,
  TILE_SIZE,
  audioZoneAt,
  parseMap,
  type CharacterId,
  type PlayerState,
  type ScenarioId,
} from '@together/shared';
import type { AppSocket } from '../net/socket';
import { createWorldApi } from '../net/worldApi';
import { setAway } from '../presence';
import { useStore } from '../state/store';
import { Keyboard } from './input';
import { TilemapBase } from './TilemapBase';
import { Tilemap } from './Tilemap';
import { OfficeTilemap } from './OfficeTilemap';
import { RuinsTilemap, loadRuinsTextures, type RuinsTextures } from './RuinsTilemap';
import { ModernTilemap, loadModernTextures, type ModernTextures } from './ModernTilemap';
import type { Avatar } from './Avatar';
import { LocalPlayer } from './LocalPlayer';
import { RemotePlayer } from './RemotePlayer';
import { loadAllCharacterFrames, type CharacterFrames } from './sprites';
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
  private scenarioId: ScenarioId;
  /** zona do tick anterior, para só avisar quando muda */
  private lastZone: string | null | undefined = undefined;
  /** idem para a dica de sentar */
  private lastSitPrompt: boolean | undefined = undefined;
  private unbinders: Array<() => void> = [];

  /** Ver a nota em `VoiceRoom`: getter, porque o campo inicializa antes do socket. */
  private readonly api = createWorldApi(() => this.socket);

  private constructor(
    app: Application,
    private socket: AppSocket,
    /** frames de todos os personagens; cada player usa o que escolheu */
    private characters: Map<CharacterId, CharacterFrames>,
    themeAssets: Tilesets | RuinsTextures | ModernTextures | null,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
    selfCharacter: CharacterId,
  ) {
    this.app = app;
    this.scenarioId = scenarioId;
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
    this.local = new LocalPlayer(this.framesFor(selfCharacter), selfName, selfColor);

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
    (window as unknown as Record<string, unknown>).__togetherAvatars = () => this.avatarsDebug();
  }

  /**
   * Que boneco e que quadro cada player está mostrando. Serve para checar duas
   * coisas que passam batido no olho: se o personagem escolhido por cada um
   * chegou aos outros clientes, e se esquerda e direita usam recortes distintos.
   */
  private avatarsDebug(): Array<{ id: string; self: boolean } & ReturnType<Avatar['debugFrame']>> {
    return [
      { id: this.socket.id ?? '', self: true, ...this.local.avatar.debugFrame() },
      ...[...this.remotes].map(([id, r]) => ({ id, self: false, ...r.avatar.debugFrame() })),
    ];
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

  /**
   * Frames do personagem pedido, caindo no padrão se o id não existir. O
   * servidor já valida, então isto só cobre um cliente mais novo que o servidor.
   */
  private framesFor(id: CharacterId): CharacterFrames {
    return this.characters.get(id) ?? this.characters.get(DEFAULT_CHARACTER)!;
  }

  static async create(
    container: HTMLElement,
    socket: AppSocket,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
    selfCharacter: CharacterId,
  ): Promise<Game> {
    const app = new Application();
    const theme = SCENARIOS[scenarioId].theme;
    const [characters, themeAssets] = await Promise.all([
      // todos de uma vez: sai mais previsível que carregar sob demanda quando
      // alguém entra com um boneco ainda desconhecido
      loadAllCharacterFrames(),
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
    return new Game(
      app,
      socket,
      characters,
      themeAssets,
      selfName,
      selfColor,
      scenarioId,
      selfCharacter,
    );
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
          // o servidor pode ter restaurado a pessoa sentada (posição salva no
          // banco); sem isto ela apareceria de pé em cima da própria cadeira
          if (p.sitting) {
            const facing = this.tilemap.sitFacingAtTile(
              Math.floor(p.x / TILE_SIZE),
              Math.floor(p.y / TILE_SIZE),
            );
            if (facing) this.local.resumeSitting(facing);
          }
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
    const onSat = (id: string, sitting: boolean) => {
      this.remotes.get(id)?.setSitting(sitting);
    };
    const onAway = (id: string, away: boolean) => {
      this.remotes.get(id)?.avatar.setAway(away);
      useStore.getState().setPlayerAway(id, away);
    };

    this.socket.on('world:snapshot', onSnapshot);
    this.socket.on('player:joined', onJoined);
    this.socket.on('player:left', onLeft);
    this.socket.on('player:moved', onMoved);
    this.socket.on('player:sat', onSat);
    this.socket.on('player:away', onAway);
    this.unbinders.push(() => {
      this.socket.off('world:snapshot', onSnapshot);
      this.socket.off('player:joined', onJoined);
      this.socket.off('player:left', onLeft);
      this.socket.off('player:moved', onMoved);
      this.socket.off('player:sat', onSat);
      this.socket.off('player:away', onAway);
    });
  }

  private addRemote(p: PlayerState): void {
    const remote = new RemotePlayer(this.framesFor(p.character), p.name, p.color, p.x, p.y);
    // quem já estava sentado ou ausente quando entramos precisa aparecer assim
    remote.setSitting(p.sitting);
    remote.avatar.setAway(p.away);
    this.remotes.set(p.id, remote);
    this.playersLayer.addChild(remote.avatar.view);
  }

  private tick = () => {
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.1);

    // Andar cancela o ausente: quem voltou ao teclado está de volta à conversa,
    // e a pose do celular só existe de frente (andar com ela ficaria quebrado).
    if (this.keyboard.moving && useStore.getState().away) setAway(false);

    const { moved, sittingChanged, nearbyChair } = this.local.update(
      dt,
      this.keyboard,
      this.tilemap,
    );
    for (const remote of this.remotes.values()) remote.update(dt, this.tilemap);
    this.tilemap.animate(dt);

    this.updateSitPrompt(nearbyChair !== null);

    /**
     * Sentar sai do throttle: a posição é o que diz aos outros clientes em que
     * cadeira a pessoa está, e é dela que eles tiram a direção. Se o `move`
     * atrasasse até o próximo tick de envio, o "sentou" chegaria antes da
     * posição e o avatar ficaria de pé por um instante no lugar errado.
     */
    this.sendAccumulator += dt;
    if (sittingChanged || this.sendAccumulator >= SEND_INTERVAL) {
      this.sendAccumulator = 0;
      const x = Math.round(this.local.x);
      const y = Math.round(this.local.y);
      if ((moved || x !== this.lastSent.x || y !== this.lastSent.y) && this.socket.connected) {
        if (x !== this.lastSent.x || y !== this.lastSent.y) {
          this.lastSent = { x, y };
          this.api.move(x, y);
        }
      }
      if (sittingChanged && this.socket.connected) {
        this.api.sit(this.local.sitting !== null);
      }
    }

    this.updateCamera(dt);
    this.updateZoneIndicator();
  };

  /** Pose de ausente do player local (chamado por `presence.setAway`). */
  setSelfAway(away: boolean): void {
    this.local.avatar.setAway(away);
  }

  /** Só avisa o store quando a dica muda, para não re-renderizar a cada frame. */
  private updateSitPrompt(canSit: boolean): void {
    const show = canSit && this.local.sitting === null;
    if (show === this.lastSitPrompt) return;
    this.lastSitPrompt = show;
    useStore.getState().setCanSit(show);
  }

  /**
   * A bolinha de alcance ao redor do avatar representa a proximidade. Dentro de
   * uma zona ela passaria a mentir (o conjunto audível deixa de ser um círculo
   * e vira a sala), então ela some — e a UI mostra o nome da sala no lugar.
   */
  private updateZoneIndicator(): void {
    const zone = audioZoneAt(
      this.scenarioId,
      Math.floor(this.local.x / TILE_SIZE),
      Math.floor(this.local.y / TILE_SIZE),
    );
    const id = zone?.id ?? null;
    if (id === this.lastZone) return;
    this.lastZone = id;
    this.local.avatar.setProximityVisible(id === null);
    useStore.getState().setAudioZone(zone ? zone.label : null);
  }

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

  /** Em que zona de áudio está esta posição do mundo (null = área aberta). */
  private zoneIdAt(x: number, y: number): string | null {
    return (
      audioZoneAt(this.scenarioId, Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))?.id ?? null
    );
  }

  /**
   * Tudo que a voz precisa para decidir quem ouve quem: distância e zona.
   * Um só percurso e uma só fonte de verdade — a regra de audibilidade em si
   * fica no VoiceRoom, que é o dono do áudio.
   */
  getAudioInfo(): {
    selfZone: string | null;
    peers: Map<string, { distance: number; zone: string | null }>;
  } {
    const peers = new Map<string, { distance: number; zone: string | null }>();
    for (const [id, remote] of this.remotes) {
      peers.set(id, {
        distance: Math.hypot(remote.x - this.local.x, remote.y - this.local.y),
        zone: this.zoneIdAt(remote.x, remote.y),
      });
    }
    return { selfZone: this.zoneIdAt(this.local.x, this.local.y), peers };
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
    delete (window as unknown as Record<string, unknown>).__togetherAvatars;
    // texture:false de propósito: as texturas de sprite/tileset são cacheadas em
    // nível de módulo e reusadas pela próxima sessão (sair e voltar)
    this.app.destroy(true, { children: true, texture: false });
  }
}
