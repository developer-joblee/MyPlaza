import { Application, Container, type FederatedPointerEvent } from 'pixi.js';
import {
  BOOBLE_JOIN_RADIUS,
  TICK_RATE,
  TILE_SIZE,
  DEFAULT_APPEARANCE,
  audioZoneAt,
  distancePx,
  parseMap,
  furnitureDef,
  type Appearance,
  type EmoteId,
  type PlacedFurniture,
  type PlayerState,
  type ScenarioId,
} from '@together/shared';
import type { AppSocket } from '../net/socket';
import { createWorldApi } from '../net/worldApi';
import { cancelPendingBooble, fulfillPendingBooble } from '../booble';
import { setAway } from '../presence';
import { useStore } from '../state/store';
import { AutoWalk } from './AutoWalk';
import { Keyboard } from './input';
import type { TilemapBase } from './TilemapBase';
import { ModernTilemap, loadTileArt, type TileArt } from './ModernTilemap';
import { FurnitureLayer } from './FurnitureLayer';
import { createFurnitureApi } from '../net/furnitureApi';
import type { Avatar } from './Avatar';
import { LocalPlayer } from './LocalPlayer';
import { RemotePlayer } from './RemotePlayer';
import { framesForAppearance, loadCuratedLayers, type CharacterFrames } from './sprites';
import { emoteFrames, loadEmoteFrames } from './emotes';
import { BoobleRings, type RingMember } from './BoobleRings';
import type { AudioInfo, PeerAudio } from '../voice/proximity';

const CAMERA_LERP_RATE = 8;
const SEND_INTERVAL = 1 / TICK_RATE;
const ZOOM_LERP_RATE = 10;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2.5;

export class Game {
  private app: Application;
  private world = new Container();
  private playersLayer = new Container();
  /** decalques de chão das boobles — fica ABAIXO dos avatares (ver o construtor) */
  private boobleRings = new BoobleRings();
  private tilemap: TilemapBase;
  private keyboard = new Keyboard();
  private local: LocalPlayer;
  private remotes = new Map<string, RemotePlayer>();
  /**
   * Booble de cada remoto, e a minha. Mapa próprio em vez de ler o roster do
   * store porque isto é consultado no caminho quente (`getAudioInfo`, 4x/s) e
   * porque o roster é um array — varrê-lo por id a cada peer seria O(n²) por um
   * dado que já chega por evento.
   */
  private boobles = new Map<string, string | null>();
  private selfBooble: string | null = null;
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
  /** idem para quem está ao alcance de abrir uma booble */
  private lastBoobleReach = '';
  private unbinders: Array<() => void> = [];

  /** Ver a nota em `VoiceRoom`: getter, porque o campo inicializa antes do socket. */
  private readonly api = createWorldApi(() => this.socket);
  private readonly furnitureApi = createFurnitureApi(() => this.socket);
  private furnitureLayer: FurnitureLayer;
  /** a foto atual da camada dinâmica (vem 100% dos broadcasts) */
  private furnitureItems: PlacedFurniture[] = [];
  /** móvel "na mão" para mover (modo edição); null = nada pego */
  private furnitureCarry: PlacedFurniture | null = null;
  /** variante (tecla R) do item da paleta; o do carry vive no próprio item */
  private furniturePickRotation = 0;
  /** tiles cobertos por móvel dinâmico SÓLIDO — consultado pelo isSolidAt */
  private furnitureSolid = new Set<string>();
  /** último tile sob o ponteiro no modo edição, para o clique usar */
  private pointerTile: { x: number; y: number } | null = null;

  private constructor(
    app: Application,
    private socket: AppSocket,
    tiles: TileArt,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
    selfAppearance: Appearance,
  ) {
    this.app = app;
    this.scenarioId = scenarioId;
    /**
     * Um renderer só, porque hoje há um estilo só (Modern Interiors). Isto era
     * um encadeado de ternários sobre `SCENARIOS[id].theme`, com um renderer por
     * pack; se um dia entrar um estilo novo, o `theme` volta e o despacho volta
     * com ele — mas manter a bifurcação com um único caso era código morto.
     */
    const map = parseMap(scenarioId);
    this.tilemap = new ModernTilemap(map, tiles, scenarioId);
    this.furnitureLayer = new FurnitureLayer(tiles, map, this.playersLayer);
    // móveis do editor colidem como os do mapa; o set é reconstruído nos eventos
    this.tilemap.setDynamicSolid((x, y) => this.furnitureSolid.has(`${x},${y}`));
    this.local = new LocalPlayer(this.framesFor(selfAppearance), selfName, selfColor);

    this.playersLayer.sortableChildren = true;
    // o círculo da booble entra entre o mapa e os avatares: é marca no chão,
    // então tem de passar por baixo de quem está em cima dela
    this.world.addChild(this.tilemap.view, this.boobleRings.view, this.playersLayer);
    this.playersLayer.addChild(this.local.avatar.view);
    for (const prop of this.tilemap.props) this.playersLayer.addChild(prop);
    this.app.stage.addChild(this.world);

    this.local.avatar.setContextMenuHandler((e) => this.onAvatarRightDown(null, e));

    this.keyboard.attach();
    this.app.canvas.addEventListener('wheel', this.onWheel, { passive: false });
    this.app.canvas.addEventListener('contextmenu', this.onContextMenu);
    this.app.canvas.addEventListener('pointerdown', this.onCanvasPointerDown);
    // DOM, e não eventFeatures.move do Pixi: religar o move reativaria teste de
    // acerto por frame no app inteiro para servir só o ghost do editor
    this.app.canvas.addEventListener('pointermove', this.onCanvasPointerMove);
    window.addEventListener('keydown', this.onKeyDown);
    this.bindSocket();
    // fechar o modo de edição (pela paleta) larga o que estiver na mão e some
    // com o ghost — sem isto ele ficaria parado na tela até o próximo mousemove
    this.unbinders.push(
      useStore.subscribe((s) => {
        if (!s.furnitureEditing) {
          this.furnitureCarry = null;
          this.furnitureLayer.hideGhost();
        }
      }),
    );
    this.app.ticker.add(this.tick);

    (window as unknown as Record<string, unknown>).__togetherPos = () => this.selfPosition;
    (window as unknown as Record<string, unknown>).__togetherAvatars = () => this.avatarsDebug();
  }

  /**
   * Que boneco e que quadro cada player está mostrando. Serve para checar duas
   * coisas que passam batido no olho: se o personagem escolhido por cada um
   * chegou aos outros clientes, e se esquerda e direita usam recortes distintos.
   */
  private avatarsDebug(): Array<
    { id: string; self: boolean; booble: string | null } & ReturnType<Avatar['debugFrame']>
  > {
    return [
      {
        id: this.socket.id ?? '',
        self: true,
        // o ID da booble sai daqui, e não do Avatar: o avatar sabe que está numa
        // (é o que o `whispering` do `debugFrame` diz), mas não em qual — quem
        // desenha o grupo é o `Game`. Comparar os dois é o que pega um avatar
        // que ficou sem `setBooble`.
        booble: this.selfBooble,
        ...this.local.avatar.debugFrame(),
      },
      ...[...this.remotes].map(([id, r]) => ({
        id,
        self: false,
        booble: this.boobles.get(id) ?? null,
        ...r.avatar.debugFrame(),
      })),
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
   * Some com o menu do navegador em cima do canvas — o botão direito aqui é do
   * jogo. Vale para o canvas inteiro, e não só sobre um avatar: metade das
   * tentativas de clicar num boneco erra por alguns pixels, e ver o menu do
   * Chrome nessas é pior que não ver menu nenhum.
   *
   * Ele NÃO abre o nosso menu: quem faz isso é o `rightdown` do avatar, pelo
   * sistema de eventos do Pixi, que sabe qual boneco está na frente. Os dois são
   * independentes — não há ordem entre eles para dar errado.
   */
  private onContextMenu = (e: MouseEvent) => e.preventDefault();

  /**
   * Clique **esquerdo** no mundo desiste de ir até alguém para abrir uma booble.
   * Nada mais no jogo reage a esse clique (não há clique-para-andar), então ele
   * está livre para significar "deixa, estou fazendo outra coisa aqui".
   *
   * Só o esquerdo: o **direito** abre o menu de contexto, e cancelar por ele
   * mataria a intenção no instante em que a pessoa foi só conferir as opções de
   * outro boneco. Cliques na UI (mic, chat, barra) não passam por aqui — mutar o
   * microfone no caminho não é desistir.
   */
  private onCanvasPointerDown = (e: PointerEvent) => {
    const { furnitureEditing, furniturePick, setFurniturePick } = useStore.getState();
    if (furnitureEditing && this.pointerTile) {
      const { x, y } = this.pointerTile;
      if (e.button === 0) {
        if (furniturePick) {
          // colocar: o sprite nasce do broadcast; o ack só explica recusas
          void this.furnitureApi
            .place(furniturePick, x, y, this.furniturePickRotation)
            .then((res) => {
              if (!res.ok) console.warn('[furniture] place recusado:', res.reason);
            });
        } else if (this.furnitureCarry) {
          const carry = this.furnitureCarry;
          this.furnitureCarry = null;
          this.furnitureLayer.hideGhost();
          void this.furnitureApi.move(carry.id, x, y, carry.rotation).then((res) => {
            if (!res.ok) console.warn('[furniture] move recusado:', res.reason);
          });
        } else {
          // pegar o móvel sob o cursor para mover
          const item = this.furnitureLayer.itemAt(this.furnitureItems, x, y);
          if (item) this.furnitureCarry = item;
        }
        return; // clique de edição não cancela booble nem nada do jogo
      }
      if (e.button === 2) {
        if (this.furnitureCarry || furniturePick) {
          // direito com algo na mão = larga, sem remover nada
          this.furnitureCarry = null;
          setFurniturePick(null);
          this.furnitureLayer.hideGhost();
          return;
        }
        const item = this.furnitureLayer.itemAt(this.furnitureItems, x, y);
        if (item) {
          void this.furnitureApi.remove(item.id).then((res) => {
            if (!res.ok) console.warn('[furniture] remove recusado:', res.reason);
          });
        }
        return;
      }
    }
    if (e.button === 0) cancelPendingBooble();
  };

  /** Só faz trabalho no modo de edição: ghost seguindo o ponteiro, por tile. */
  private onCanvasPointerMove = (e: PointerEvent) => {
    const { furnitureEditing, furniturePick } = useStore.getState();
    if (!furnitureEditing) return;
    if (e.buttons === 0 && !furniturePick && !this.furnitureCarry) {
      this.furnitureLayer.hideGhost();
    }
    const rect = this.app.canvas.getBoundingClientRect();
    const world = this.world.toLocal({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    const tileX = Math.floor(world.x / TILE_SIZE);
    const tileY = Math.floor(world.y / TILE_SIZE);
    this.pointerTile = { x: tileX, y: tileY };
    const showing = furniturePick ?? this.furnitureCarry?.furnitureId ?? null;
    if (!showing) {
      this.furnitureLayer.hideGhost();
      return;
    }
    const valid = this.furnitureLayer.footprintFree(
      showing,
      tileX,
      tileY,
      this.furnitureItems,
      this.furnitureCarry?.id,
    );
    const rotation = this.furnitureCarry?.rotation ?? this.furniturePickRotation;
    this.furnitureLayer.showGhost(showing, rotation, tileX, tileY, valid);
  };

  /**
   * `R` alterna a variante de arte do que está na mão (paleta ou móvel pego).
   * Listener próprio, fora do `Keyboard` de movimento: é tecla de MODO, só
   * existe editando, e não pode disparar com o foco num campo de texto.
   */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if ((e.target as HTMLElement | null)?.closest?.('[data-capture-keys]')) return;
    const { furnitureEditing, furniturePick } = useStore.getState();
    if (!furnitureEditing) return;
    // módulo 8: é o teto que o servidor aceita; o frame já dá a volta sozinho
    if (this.furnitureCarry) {
      this.furnitureCarry.rotation = (this.furnitureCarry.rotation + 1) % 8;
    } else if (furniturePick) {
      this.furniturePickRotation = (this.furniturePickRotation + 1) % 8;
    }
  };

  /** Recalcula os tiles sólidos da camada dinâmica (chamado nos 3 eventos). */
  private rebuildFurnitureSolid(): void {
    this.furnitureSolid.clear();
    for (const item of this.furnitureItems) {
      const def = furnitureDef(item.furnitureId);
      if (!def.solid) continue;
      for (let dy = 0; dy < def.h; dy++) {
        for (let dx = 0; dx < def.w; dx++) {
          this.furnitureSolid.add(`${item.tileX + dx},${item.tileY + dy}`);
        }
      }
    }
  }

  /**
   * Clique direito num avatar. `id` nulo é o player local: o id dele é o
   * `socket.id`, que muda a cada reconexão, então é lido do store no momento do
   * clique em vez de capturado quando o handler é criado.
   */
  private onAvatarRightDown(id: string | null, e: FederatedPointerEvent): void {
    const who = id ?? useStore.getState().selfId;
    if (!who) return;
    // sem isto o mesmo clique também chegaria a quem estiver atrás
    e.stopPropagation();
    // `client` é px de viewport, que é o que um elemento `fixed` precisa
    useStore.getState().openContextMenu(who, e.client.x, e.client.y);
  }

  /**
   * Frames da aparência pedida. Síncrono: as camadas curadas já foram
   * pré-carregadas no `create`, e a composição (canvas 2D) + o recorte são
   * cacheados por combinação em `sprites.ts`. O servidor valida a aparência —
   * o `??` cobre só o dev com servidor de versão antiga (que manda `character`
   * em vez de `appearance`): melhor um boneco padrão que um mundo sem gente.
   */
  private framesFor(appearance: Appearance | undefined): CharacterFrames {
    return framesForAppearance(appearance ?? DEFAULT_APPEARANCE);
  }

  static async create(
    container: HTMLElement,
    socket: AppSocket,
    selfName: string,
    selfColor: number,
    scenarioId: ScenarioId,
    selfAppearance: Appearance,
  ): Promise<Game> {
    const app = new Application();
    const [, , tiles] = await Promise.all([
      // todas as camadas de uma vez: compor a aparência de quem entra é
      // síncrono, então não pode esperar rede no addRemote
      loadCuratedLayers(),
      loadEmoteFrames(),
      loadTileArt(),
      app.init({
        resizeTo: container,
        backgroundColor: 0x1f2129,
        antialias: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
        /**
         * A única interação do Pixi aqui é o clique direito no avatar, e clique
         * é o grupo `click` — que fica ligado. Os de MOVIMENTO são desligados
         * porque cada `mousemove` sobre o canvas dispararia um teste de acerto
         * na camada de players, dezenas de vezes por segundo, para responder uma
         * pergunta que ninguém faz: nada aqui reage a passar o mouse por cima.
         *
         * Se um dia houver hover (destacar quem está sob o cursor, tooltip),
         * `move` precisa voltar a `true` — sem ele o `pointerover`/`pointerout`
         * não existe, e o sintoma é "o hover não funciona e não há erro".
         */
        eventFeatures: { move: false, globalMove: false },
      }),
    ]);
    container.appendChild(app.canvas);
    return new Game(
      app,
      socket,
      tiles,
      selfName,
      selfColor,
      scenarioId,
      selfAppearance,
    );
  }

  private bindSocket(): void {
    const onSnapshot = (players: PlayerState[]) => {
      // reset completo (cobre também reconexões)
      for (const remote of this.remotes.values()) remote.avatar.destroy();
      this.remotes.clear();
      this.boobles.clear();

      for (const p of players) {
        if (p.id === this.socket.id) {
          this.local.setPosition(p.x, p.y);
          this.cameraSnapped = false;
          // reconexão é um socket novo, logo uma pessoa nova sem booble — mas
          // quem lê é o servidor, não esta suposição
          this.setPlayerBooble(p.id, p.boobleId);
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
      this.boobles.delete(id);
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
    // o emissor também recebe (o servidor manda ao mundo inteiro): o próprio
    // balão nasce daqui, nunca do clique — caminho único de render
    const onFurnitureSnapshot = (items: PlacedFurniture[], canEdit: boolean) => {
      this.furnitureItems = items;
      this.furnitureCarry = null;
      this.furnitureLayer.replaceAll(items);
      this.rebuildFurnitureSolid();
      useStore.getState().setFurnitureCanEdit(canEdit);
    };
    const onFurnitureChanged = (item: PlacedFurniture) => {
      this.furnitureItems = [...this.furnitureItems.filter((f) => f.id !== item.id), item];
      this.furnitureLayer.set(item);
      this.rebuildFurnitureSolid();
    };
    const onFurnitureRemoved = (id: string) => {
      this.furnitureItems = this.furnitureItems.filter((f) => f.id !== id);
      if (this.furnitureCarry?.id === id) this.furnitureCarry = null;
      this.furnitureLayer.remove(id);
      this.rebuildFurnitureSolid();
    };
    const onEmoted = (id: string, emoteId: EmoteId) => {
      const frames = emoteFrames(emoteId);
      if (!frames) return; // preload não rodou / id de servidor mais novo
      const avatar = id === this.socket.id ? this.local.avatar : this.remotes.get(id)?.avatar;
      avatar?.showEmote(frames);
    };

    this.socket.on('world:snapshot', onSnapshot);
    this.socket.on('player:joined', onJoined);
    this.socket.on('player:left', onLeft);
    this.socket.on('player:moved', onMoved);
    this.socket.on('player:sat', onSat);
    this.socket.on('player:away', onAway);
    this.socket.on('player:emoted', onEmoted);
    this.socket.on('furniture:snapshot', onFurnitureSnapshot);
    this.socket.on('furniture:changed', onFurnitureChanged);
    this.socket.on('furniture:removed', onFurnitureRemoved);
    this.unbinders.push(() => {
      this.socket.off('furniture:snapshot', onFurnitureSnapshot);
      this.socket.off('furniture:changed', onFurnitureChanged);
      this.socket.off('furniture:removed', onFurnitureRemoved);
      this.socket.off('world:snapshot', onSnapshot);
      this.socket.off('player:joined', onJoined);
      this.socket.off('player:left', onLeft);
      this.socket.off('player:moved', onMoved);
      this.socket.off('player:sat', onSat);
      this.socket.off('player:away', onAway);
      this.socket.off('player:emoted', onEmoted);
    });
  }

  private addRemote(p: PlayerState): void {
    const remote = new RemotePlayer(this.framesFor(p.appearance), p.name, p.color, p.x, p.y);
    // quem já estava sentado, ausente ou numa booble quando entramos precisa
    // aparecer assim — é o caminho de quem abre a aba com o mundo em andamento
    remote.setSitting(p.sitting);
    remote.avatar.setAway(p.away);
    remote.avatar.setContextMenuHandler((e) => this.onAvatarRightDown(p.id, e));
    this.boobles.set(p.id, p.boobleId);
    remote.avatar.setBooble(p.boobleId !== null);
    this.remotes.set(p.id, remote);
    this.playersLayer.addChild(remote.avatar.view);
  }

  /**
   * A auto-caminhada do "ir até" (chamado pelo menu de contexto). Vive aqui
   * porque o `Game` é o único que tem as posições dos remotos — o `roster` do
   * store não tem coordenada.
   */
  private autoWalk = new AutoWalk();

  private tick = () => {
    const dt = Math.min(this.app.ticker.deltaMS / 1000, 0.1);

    // Tecla de movimento cancela a auto-caminhada. Fica antes do `local.update`
    // porque é ele que consome o `E`, e o `E` também cancela (quem senta desistiu
    // de ir até alguém).
    if (this.keyboard.moving) this.autoWalk.cancel();
    const autoAxis = this.autoWalk.active
      ? this.autoWalk.step(
          { x: this.local.x, y: this.local.y },
          this.walkTargetPos(),
          this.tilemap,
        )
      : null;

    /**
     * Chegou em quem eu ia encontrar para abrir uma booble? Aqui a intenção é só
     * **decidida** — quem a cumpre é o bloco de envio de posição, mais abaixo, e a
     * ordem é obrigatória: ver o comentário lá.
     */
    const boobleAoChegar = this.settlePendingBooble();

    // Andar cancela o ausente: quem voltou ao teclado está de volta à conversa,
    // e a pose do celular só existe de frente (andar com ela ficaria quebrado).
    // A auto-caminhada conta como andar — senão o avatar iria até alguém com o
    // celular na mão.
    if ((this.keyboard.moving || autoAxis !== null) && useStore.getState().away) setAway(false);

    const { moved, sittingChanged, nearbyChair } = this.local.update(
      dt,
      this.keyboard,
      this.tilemap,
      autoAxis,
    );
    // o `E` foi consumido lá dentro; sentar e ir até alguém são intenções opostas
    if (sittingChanged && this.local.sitting) this.autoWalk.cancel();
    for (const remote of this.remotes.values()) remote.update(dt, this.tilemap);
    this.tilemap.animate(dt);

    this.updateSitPrompt(nearbyChair !== null);

    /**
     * Sentar sai do throttle: a posição é o que diz aos outros clientes em que
     * cadeira a pessoa está, e é dela que eles tiram a direção. Se o `move`
     * atrasasse até o próximo tick de envio, o "sentou" chegaria antes da
     * posição e o avatar ficaria de pé por um instante no lugar errado.
     *
     * **Chegar para abrir uma booble sai do throttle pelo mesmo motivo, e ali é
     * ainda mais grave.** A posição vai ao servidor a `TICK_RATE` (15/s = 66,7ms),
     * e a `MOVE_SPEED` isso são até ~11px de atraso. O servidor recusa
     * `booble:join` fora de `BOOBLE_JOIN_RADIUS` usando a posição que ELE tem, e
     * recusa **em silêncio** — então chegar do lado da pessoa e pedir com a
     * posição velha dava exatamente "cheguei e a booble não abriu", sem erro
     * nenhum em lugar nenhum. Foi o defeito relatado na primeira versão.
     */
    this.sendAccumulator += dt;
    if (sittingChanged || boobleAoChegar !== null || this.sendAccumulator >= SEND_INTERVAL) {
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

    /**
     * O pedido da booble sai **depois** do `move` acima, e é o Socket.IO que
     * garante o resto: a ordem de entrega no mesmo socket é a de emissão, então o
     * servidor processa a posição nova antes de conferir o raio.
     */
    if (boobleAoChegar !== null) fulfillPendingBooble(boobleAoChegar);

    this.updateCamera(dt);
    this.updateZoneIndicator();
    this.updateBoobleRings();
    this.updateBoobleReach();
  };

  /**
   * Redesenha os círculos das boobles a partir das posições deste frame — as dos
   * remotos são interpoladas, então o círculo tem de seguir o movimento.
   *
   * Agrupa por `boobleId`, incluindo o player local. Só entram boobles com
   * alguém visível aqui, e o caso comum (nenhuma booble) sai em uma iteração
   * vazia sobre os remotos.
   */
  private updateBoobleRings(): void {
    const groups = new Map<string, RingMember[]>();
    const add = (boobleId: string | null, x: number, y: number) => {
      if (boobleId === null) return;
      const list = groups.get(boobleId);
      if (list) list.push({ x, y });
      else groups.set(boobleId, [{ x, y }]);
    };
    add(this.selfBooble, this.local.x, this.local.y);
    for (const [id, remote] of this.remotes) {
      add(this.boobles.get(id) ?? null, remote.x, remote.y);
    }
    this.boobleRings.update(groups, this.selfBooble);
  }

  /**
   * Com quem dá para ABRIR uma booble agora: perto (`BOOBLE_JOIN_RADIUS`) e na
   * mesma zona — as duas condições que o servidor impõe em `World.joinBooble`.
   *
   * Mora aqui, e não no tick da voz junto de `nearbyIds`, por dois motivos. O
   * raio é outro (2 tiles contra os 5 audíveis), então um botão gastando o
   * predicado do áudio apareceria para gente longe demais e o clique morreria em
   * silêncio. E o tick da voz **não roda** sem LiveKit configurado — o botão
   * simplesmente não apareceria num ambiente sem voz.
   *
   * Só avisa o store quando o conjunto muda, como `updateZoneIndicator`.
   */
  private updateBoobleReach(): void {
    const selfZone = this.zoneIdAt(this.local.x, this.local.y);
    const reach: string[] = [];
    for (const [id, remote] of this.remotes) {
      if (distancePx(this.local.x, this.local.y, remote.x, remote.y) > BOOBLE_JOIN_RADIUS) {
        continue;
      }
      if (this.zoneIdAt(remote.x, remote.y) !== selfZone) continue;
      reach.push(id);
    }
    const key = reach.sort().join(',');
    if (key === this.lastBoobleReach) return;
    this.lastBoobleReach = key;
    useStore.getState().setBoobleReachIds(reach);
  }

  /**
   * Decide a intenção de booble em quem estava longe — o clique em **booble** no
   * menu de contexto de alguém fora dos 2 tiles.
   *
   * Devolve o alvo quando **chegou** (e aí quem pede é o `tick`, depois de mandar
   * a posição) e `null` no resto. Desistir acontece aqui mesmo, porque não
   * depende de posição nenhuma.
   *
   * A intenção vive **exatamente enquanto a caminhada vive**, e é uma regra só:
   * ela cobre de graça tudo que para a caminhada — WASD, o `E` de sentar, o prazo
   * de 20s, o alvo saindo do mundo, a rota impossível e o clique no chão.
   *
   * Quem diz se terminou por CHEGAR é o `AutoWalk` (`arrivedAt`), e não uma
   * medida de distância feita aqui. A diferença não é cosmética: `boobleReachIds`
   * é recalculado no fim do tick, com o remoto já interpolado alguns px — quem
   * está sendo perseguido andando sai do raio no mesmo frame em que a caminhada
   * termina, e a booble não abriria justo no caso que exige a caminhada. A
   * validação de verdade (raio **e** zona) é do servidor, que recusa em silêncio.
   */
  private settlePendingBooble(): string | null {
    const pending = useStore.getState().pendingBooble;
    if (pending === null || this.autoWalk.active) return null;
    if (this.autoWalk.arrivedAt === pending) return pending;
    cancelPendingBooble();
    return null;
  }

  /**
   * Posição atual de quem estou indo encontrar, ou `null` se essa pessoa não
   * está mais no mundo (aí o `AutoWalk` desiste sozinho).
   */
  private walkTargetPos(): { x: number; y: number } | null {
    const id = this.autoWalk.target;
    if (!id) return null;
    const remote = this.remotes.get(id);
    return remote ? { x: remote.x, y: remote.y } : null;
  }

  /**
   * Vai até o personagem desta pessoa ("ir até" do alerta de chamado). Quem
   * chama é `client/src/call.ts`, nunca a UI direto — no molde do `setSelfAway`.
   *
   * Levantar da cadeira acontece **antes** de começar a andar: é mais simples
   * que tratar durante, e o servidor só tem rede de segurança para o sentar
   * (`world.ts`), não para a pose.
   */
  walkTo(id: string): void {
    if (!this.remotes.has(id)) return;
    this.autoWalk.start(id);
  }

  cancelWalk(): void {
    this.autoWalk.cancel();
  }

  /** Pose de ausente do player local (chamado por `presence.setAway`). */
  setSelfAway(away: boolean): void {
    this.local.avatar.setAway(away);
  }

  /**
   * A booble de alguém mudou. Um caminho só para o local e para os remotos, no
   * molde de `setSpeaking`: a booble do player local é o que decide TODOS os
   * volumes em `getAudioInfo`, então mandar o valor para o alvo errado aqui
   * erraria o áudio inteiro, não só um avatar.
   *
   * Quem chama é `client/src/booble.ts`, nunca a UI direto.
   */
  setPlayerBooble(id: string, boobleId: string | null): void {
    if (id === this.socket.id) this.selfBooble = boobleId;
    else this.boobles.set(id, boobleId);
    /**
     * O CÍRCULO no chão não é desenhado aqui: ele é redesenhado a cada frame a
     * partir das posições (que se movem), então para ele basta o estado acima
     * estar certo.
     *
     * O BALÃO de cochicho é ligado aqui porque ele vive dentro do avatar, que é
     * quem já acompanha a pessoa. Um remoto que ainda não chegou (o
     * `player:booble` pode preceder o `player:joined`) cai no `?.` e é coberto
     * pelo `addRemote`, que lê o `boobleId` do próprio snapshot.
     */
    const avatar = id === this.socket.id ? this.local.avatar : this.remotes.get(id)?.avatar;
    avatar?.setBooble(boobleId !== null);
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
      out.set(id, distancePx(this.local.x, this.local.y, remote.x, remote.y));
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
   * Tudo que a voz precisa para decidir quem ouve quem: distância, zona e
   * booble. Um só percurso e uma só fonte de verdade — a regra em si fica em
   * `voice/proximity.ts`, que é o dono do áudio. Aqui só se mede.
   */
  getAudioInfo(): AudioInfo {
    const peers = new Map<string, PeerAudio>();
    for (const [id, remote] of this.remotes) {
      peers.set(id, {
        distance: distancePx(this.local.x, this.local.y, remote.x, remote.y),
        zone: this.zoneIdAt(remote.x, remote.y),
        booble: this.boobles.get(id) ?? null,
      });
    }
    return {
      self: { zone: this.zoneIdAt(this.local.x, this.local.y), booble: this.selfBooble },
      peers,
    };
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
    this.boobleRings.destroy();
    this.app.canvas.removeEventListener('wheel', this.onWheel);
    this.app.canvas.removeEventListener('contextmenu', this.onContextMenu);
    this.app.canvas.removeEventListener('pointerdown', this.onCanvasPointerDown);
    this.app.canvas.removeEventListener('pointermove', this.onCanvasPointerMove);
    window.removeEventListener('keydown', this.onKeyDown);
    // o menu aponta para um avatar que está deixando de existir
    useStore.getState().closeContextMenu();
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
