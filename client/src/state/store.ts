import { create } from 'zustand';
import {
  AVATAR_COLORS,
  DEFAULT_APPEARANCE,
  DEFAULT_SCENARIO,
  type Appearance,
  type ChatMessage,
  type FurnitureId,
  type JoinDeniedReason,
  type LobbyState,
  type PeerAudioMap,
  type PeerAudioPrefs,
  type PendingInvite,
  SOUND_VOLUME_DEFAULT,
  type ScenarioId,
  type SoundboardState,
  type WorldDetail,
  type WorldSummary,
} from '@together/shared';
// import type: apagado na compilação, então não puxa o SDK para o chunk principal
import type { RemoteVideoTrack } from 'livekit-client';
import type { MicDevice } from '../voice/mic';

export interface RosterEntry {
  id: string;
  name: string;
  color: number;
  away: boolean;
  /** booble desta pessoa; `null` = nenhuma. Ver `client/src/booble.ts`. */
  boobleId: string | null;
}

/**
 * Um chamado recebido enquanto você está ausente. `at` fica porque o aviso não
 * expira sozinho: quem está ausente pode voltar meia hora depois, e "Ana te
 * chamou" sem hora nenhuma mentiria sobre quando isso aconteceu.
 */
export interface Nudge {
  /** socket id de quem chamou */
  id: string;
  name: string;
  at: number;
}

/**
 * Um cartão da pilha de chamados do canto superior direito.
 *
 * `incoming` = "X te chamou" (com "ir até" e fechar); `coming` = "X está vindo",
 * a confirmação que quem chamou recebe quando o outro aceita. Os dois moram no
 * mesmo array porque moram na mesma pilha da tela, e um `kind` é mais honesto
 * que duas listas que precisariam ser ordenadas entre si na hora de desenhar.
 *
 * `id` é o `socket.id` da outra pessoa — é o que permite resolver nome e cor no
 * `roster` na hora de desenhar, e é o que faz o cartão morrer sozinho quando ela
 * sai do mundo (mesma regra do `contextMenu`). O `name` é cópia só para o caso
 * de a pessoa sair no mesmo instante: aí o cartão do "está vindo" ainda diz de
 * quem era em vez de virar vazio.
 */
export interface CallAlert {
  id: string;
  name: string;
  at: number;
  kind: 'incoming' | 'coming';
}

export interface RemoteScreen {
  peerId: string;
  /** a faixa, não um MediaStream: o adaptiveStream depende de track.attach() */
  track: RemoteVideoTrack;
}

export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'unavailable'
  | 'error';

interface AppState {
  /**
   * `boot` existe porque restaurar a sessão do Supabase é assíncrono: sem ele a
   * tela de login apareceria por um instante para quem já está logado.
   */
  phase: 'boot' | 'login' | 'lobby' | 'join' | 'playing';
  selfName: string;
  selfColor: number;
  selfScenario: ScenarioId;
  selfAppearance: Appearance;
  selfId: string | null;
  /** e-mail da conta logada; null = anônimo (servidor sem Supabase) */
  authEmail: string | null;

  /** mundos e convites do lobby */
  worlds: WorldSummary[];
  pendingInvites: PendingInvite[];
  /**
   * O ID desta pessoa, como o servidor o conhece. Vem no `lobby:list` — é o que
   * ela copia e passa a quem administra um mundo para ganhar acesso. Vazio até
   * o lobby responder.
   */
  myId: string;
  /** painel do mundo aberto para gerenciar; null = nenhum */
  worldDetail: WorldDetail | null;
  /**
   * Mundo escolhido no lobby. É o que vai no `join` — sem ele, com login
   * configurado, o servidor recusa com `no-world`.
   */
  selfWorldId: string | null;
  selfWorldName: string | null;
  /** por que a última tentativa de entrar foi recusada */
  joinDenied: JoinDeniedReason | null;
  connected: boolean;
  roster: RosterEntry[];
  chat: ChatMessage[];
  micAvailable: boolean;
  /**
   * Intenção do usuário; o mic efetivo é `micEnabled && !deafened`.
   *
   * Começa **sempre em `false`**: entrar, recarregar a página e reconectar
   * entregam o microfone desligado, e isto não é persistido de propósito —
   * transmitir sem saber é pior que ter de clicar no 🎙️ ao chegar.
   */
  micEnabled: boolean;
  deafened: boolean;
  voiceStatus: VoiceStatus;
  /** o browser bloqueou o autoplay do áudio; precisa de um gesto */
  audioBlocked: boolean;
  micDevices: MicDevice[];
  activeMicId: string | null;
  micSwitching: boolean;
  /** nome da sala em que o player está; null = área aberta (proximidade normal) */
  audioZone: string | null;
  /** há uma cadeira ao alcance e o player está de pé (mostra a dica do E) */
  canSit: boolean;
  /** ausente: sem microfone, sem áudio, avatar no celular */
  away: boolean;
  /**
   * A MINHA booble; `null` = nenhuma. Derivado do roster (é o `boobleId` da
   * minha linha), mas guardado à parte porque a UI o consulta em três lugares —
   * o aviso, os botões da lista e o rótulo — e derivar por varredura em cada um
   * deles convidaria a três leituras que podem divergir.
   */
  selfBooble: string | null;
  /**
   * Quem te chamou enquanto você está ausente, um por pessoa (o mais recente
   * ganha). Só enche estando ausente, e zera ao voltar — ver `presence.ts`.
   */
  nudges: Nudge[];
  /**
   * A pilha de chamados do menu de contexto (canto superior direito). Ao
   * contrário dos `nudges`, **não** é zerada ao trocar de ausência: chamado de
   * quem está presente não tem nada a ver com o celular.
   */
  calls: CallAlert[];
  /**
   * Quem EU chamei -> quando toquei o pin nessa pessoa. É o que deixa o item do
   * menu "pressionado" e o que impõe o `CALL_COOLDOWN_MS` na interface.
   *
   * Vive no store, e não em `useState` do menu como o cooldown do `Hud`, porque
   * o menu de contexto **desmonta ao fechar**: um estado local não sobreviveria
   * a reabrir o menu na mesma pessoa, e o botão nasceria despressionado com o
   * chamado no ar.
   */
  myCalls: Record<string, number>;
  /**
   * Meu soundboard, como o servidor o devolveu (sons, tempo acumulado, próximo
   * marco). `null` = ainda não pedi, ou este servidor não tem Supabase — e é
   * essa distinção que faz o botão da barra nascer desabilitado em vez de abrir
   * um painel vazio.
   */
  soundboard: SoundboardState | null;
  /**
   * Silenciar o soundboard de todos. Preferência, não estado de sessão: fica no
   * `localStorage` e sobrevive a sair do mundo, porque quem desligou isso
   * desligou por um motivo que não muda ao trocar de mapa.
   */
  soundboardMuted: boolean;
  /**
   * Volume do soundboard, 0..`SOUND_VOLUME_MAX`.
   *
   * Espelha `profiles.soundboard_volume`: o valor de verdade está no banco (para
   * seguir a pessoa entre navegadores) e este campo é a cópia com que a tela
   * trabalha, atualizada **na hora** do arrasto e persistida depois. Começa no
   * default do `shared` para o slider não nascer em zero antes do `list` chegar.
   */
  soundboardVolume: number;
  /**
   * O quanto EU ouço cada pessoa — voz e sons de soundboard, separados —, por
   * `socket.id`. Ausente = cheio (`PEER_VOLUME_DEFAULT`).
   *
   * Não é estado de sessão: o valor vive no banco por perfil e o servidor
   * rehidrata este mapa no `join`, traduzindo
   * perfil → `socket.id`. Quem cai e volta é um socket novo, e é o servidor que
   * repõe a chave — é por isso que a entrada de quem sai é descartada aqui em
   * vez de guardada "para quando ela voltar".
   *
   * Sem Supabase nada hidrata e nada persiste, e o mapa vale só na sessão.
   * Ver `client/src/peerAudio.ts` e `docs/features/volume-por-pessoa.md`.
   */
  peerAudio: PeerAudioMap;
  /** preferência do usuário para o cancelamento de ruído */
  noiseFilter: boolean;
  /** se o filtro está de fato rodando (pode falhar por falta de suporte) */
  noiseFilterActive: boolean;
  sharing: boolean;
  remoteScreens: RemoteScreen[];
  speaking: Record<string, boolean>;
  /** ids dos players dentro do alcance de voz */
  nearbyIds: string[];
  /**
   * Com quem dá para **abrir uma booble** agora: perto (`BOOBLE_JOIN_RADIUS`, 2
   * tiles) e na mesma zona. Vem do `Game`, não do tick da voz — o raio é bem
   * menor que o audível, e o tick da voz nem roda sem LiveKit configurado.
   */
  boobleReachIds: string[];
  /**
   * "Cliquei em booble em alguém que estava longe e estou indo até lá."
   * `socket.id` do alvo, ou `null`.
   *
   * A intenção existe porque o clique e o efeito ficaram separados no tempo: a
   * booble só se forma a 2 tiles, e daqui até lá o avatar caminha sozinho. Ela
   * vive **enquanto a caminhada vive** — quem a cumpre ou a mata é o `Game`, e
   * as transições passam todas por `client/src/booble.ts`.
   */
  pendingBooble: string | null;
  focusedScreenId: string | null;
  /** zoom alvo da câmera, em % */
  zoomPct: number;
  /**
   * Menu de contexto aberto sobre um avatar; `null` = nenhum.
   *
   * Guarda **só o id e onde clicar** — nome, cor e ausência saem do `roster` na
   * hora de desenhar. É o que faz o menu morrer sozinho quando a pessoa sai do
   * mundo (o id some do roster) em vez de ficar apontando para quem não está
   * mais lá, e o que evita uma segunda cópia do nome que envelheceria.
   *
   * `x`/`y` são coordenadas de VIEWPORT (CSS px), porque o menu é um elemento
   * `fixed` do DOM — não de mundo. Andar não arrasta o menu, e isso é de
   * propósito: ele pertence ao clique, não ao avatar.
   */
  contextMenu: { id: string; x: number; y: number } | null;

  /**
   * Editor de móveis. `furnitureCanEdit` vem do servidor
   * (`furniture:snapshot`) — o cliente nunca decide papel. `furniturePick` é o
   * item da paleta na mão (null = nada); quem consome os dois é o `Game`
   * (ghost e cliques) e a `FurniturePalette`.
   */
  furnitureCanEdit: boolean;
  furnitureEditing: boolean;
  furniturePick: FurnitureId | null;

  join: (name: string, color: number, scenario: ScenarioId, appearance: Appearance) => void;
  setFurnitureCanEdit: (canEdit: boolean) => void;
  /** entrar/sair do modo de edição (sair larga o que estiver na mão) */
  setFurnitureEditing: (editing: boolean) => void;
  setFurniturePick: (pick: FurnitureId | null) => void;
  /** terminou o boot: vai para o login, o lobby, ou direto para a entrada */
  setPhase: (phase: 'login' | 'lobby' | 'join') => void;
  setLobby: (state: LobbyState, detail?: WorldDetail) => void;
  /** fecha o painel de gerenciamento */
  closeWorldDetail: () => void;
  /**
   * Escolheu um mundo no lobby: guarda id, nome e o cenário DELE.
   *
   * Havendo **vínculo** (`world.binding`), entra direto no jogo com o nome, a
   * cor e o personagem já guardados — não passa pela tela de entrada. Sem
   * vínculo (primeira vez neste mundo), vai para a tela de entrada.
   * `opts.edit` força a tela mesmo com vínculo: é o botão "Editar" do lobby.
   */
  chooseWorld: (world: WorldSummary, opts?: { edit?: boolean }) => void;
  /** volta para o lobby (botão de voltar na tela de entrada) */
  backToLobby: () => void;
  /** logou/deslogou; sem e-mail volta para a tela de login */
  setAuthEmail: (email: string | null) => void;

  /** o servidor recusou a entrada: volta para a tela de entrada com o motivo */
  denyJoin: (reason: JoinDeniedReason) => void;
  /** volta para a tela inicial zerando o estado da sessão */
  leave: () => void;
  setScenario: (id: ScenarioId) => void;
  setSelf: (id: string | null, connected: boolean) => void;
  setRoster: (roster: RosterEntry[]) => void;
  upsertRosterEntry: (entry: RosterEntry) => void;
  removeRosterEntry: (id: string) => void;
  setChat: (chat: ChatMessage[]) => void;
  appendChat: (msg: ChatMessage) => void;
  setMicAvailable: (v: boolean) => void;
  setMicEnabled: (v: boolean) => void;
  setDeafened: (v: boolean) => void;
  setVoiceStatus: (v: VoiceStatus) => void;
  setAudioBlocked: (v: boolean) => void;
  setMicDevices: (devices: MicDevice[]) => void;
  setActiveMicId: (id: string | null) => void;
  setMicSwitching: (v: boolean) => void;
  setAudioZone: (label: string | null) => void;
  setCanSit: (v: boolean) => void;
  setAway: (v: boolean) => void;
  /** ausência de um player na lista (o próprio ou um remoto) */
  setPlayerAway: (id: string, away: boolean) => void;
  setSoundboard: (state: SoundboardState | null) => void;
  setSoundboardMuted: (muted: boolean) => void;
  setSoundboardVolume: (volume: number) => void;
  /** o slider mexeu — ver `client/src/peerAudio.ts` */
  setPeerAudio: (id: string, prefs: PeerAudioPrefs) => void;
  /** hidratação do servidor: merge, nunca substituição (o mapa é parcial) */
  mergePeerAudio: (prefs: PeerAudioMap) => void;
  /** booble de um player (o próprio ou um remoto) — ver `client/src/booble.ts` */
  setPlayerBooble: (id: string, boobleId: string | null) => void;
  /** a intenção de booble em quem está longe — ver `client/src/booble.ts` */
  setPendingBooble: (id: string | null) => void;
  /** registra um chamado (substitui o anterior da mesma pessoa) */
  pushNudge: (id: string, name: string) => void;
  clearNudges: () => void;
  /** empilha um cartão de chamado (um por pessoa e por tipo) */
  pushCall: (id: string, name: string, kind: CallAlert['kind']) => void;
  removeCall: (id: string, kind: CallAlert['kind']) => void;
  /** marca/desmarca "eu chamei essa pessoa" — ver `client/src/call.ts` */
  setMyCall: (id: string) => void;
  clearMyCall: (id: string) => void;
  setNoiseFilter: (v: boolean) => void;
  setNoiseFilterActive: (v: boolean) => void;
  setSharing: (v: boolean) => void;
  addRemoteScreen: (peerId: string, track: RemoteVideoTrack) => void;
  removeRemoteScreen: (peerId: string) => void;
  setSpeaking: (id: string, v: boolean) => void;
  setNearbyIds: (ids: string[]) => void;
  setBoobleReachIds: (ids: string[]) => void;
  setFocusedScreen: (peerId: string | null) => void;
  setZoomPct: (pct: number) => void;
  /** clique direito num avatar (o `Game` chama); `x`/`y` em px de viewport */
  openContextMenu: (id: string, x: number, y: number) => void;
  closeContextMenu: () => void;
}

export const useStore = create<AppState>((set) => ({
  phase: 'boot',
  selfName: '',
  selfColor: AVATAR_COLORS[0],
  selfScenario: DEFAULT_SCENARIO,
  selfAppearance: DEFAULT_APPEARANCE,
  selfId: null,
  authEmail: null,
  worlds: [],
  pendingInvites: [],
  myId: '',
  worldDetail: null,
  selfWorldId: null,
  selfWorldName: null,
  joinDenied: null,
  connected: false,
  roster: [],
  chat: [],
  micAvailable: false,
  // sempre mudo ao chegar — ver o campo na interface
  micEnabled: false,
  deafened: false,
  voiceStatus: 'idle',
  audioBlocked: false,
  micDevices: [],
  activeMicId: null,
  micSwitching: false,
  audioZone: null,
  canSit: false,
  away: false,
  selfBooble: null,
  nudges: [],
  calls: [],
  myCalls: {},
  soundboard: null,
  /**
   * Lido do `localStorage` no boot, no mesmo idioma do `noiseFilter` abaixo:
   * chave `together:*`, leitura defensiva, e o default é NÃO silenciado — a
   * feature existe para ser ouvida.
   */
  soundboardMuted: (() => {
    try {
      return localStorage.getItem('together:soundboard') === 'off';
    } catch {
      return false;
    }
  })(),
  soundboardVolume: SOUND_VOLUME_DEFAULT,
  peerAudio: {},
  noiseFilter: (() => {
    try {
      return localStorage.getItem('together:noiseFilter') !== 'off';
    } catch {
      return true;
    }
  })(),
  noiseFilterActive: false,
  sharing: false,
  remoteScreens: [],
  speaking: {},
  nearbyIds: [],
  boobleReachIds: [],
  pendingBooble: null,
  focusedScreenId: null,
  zoomPct: 100,
  contextMenu: null,
  furnitureCanEdit: false,
  furnitureEditing: false,
  furniturePick: null,

  join: (name, color, scenario, appearance) =>
    set({
      phase: 'playing',
      joinDenied: null,
      selfName: name,
      selfColor: color,
      selfScenario: scenario,
      selfAppearance: appearance,
    }),

  setFurnitureCanEdit: (canEdit) =>
    set((s) => ({
      furnitureCanEdit: canEdit,
      // perder o papel (reconexão para outro mundo) fecha o modo de edição
      furnitureEditing: canEdit ? s.furnitureEditing : false,
      furniturePick: canEdit ? s.furniturePick : null,
    })),
  setFurnitureEditing: (editing) => set({ furnitureEditing: editing, furniturePick: null }),
  setFurniturePick: (pick) => set({ furniturePick: pick }),

  setPhase: (phase) => set({ phase }),
  setLobby: (lobby, detail) =>
    set((state) => ({
      worlds: lobby.worlds,
      pendingInvites: lobby.invites,
      myId: lobby.myId,
      /**
       * A última aparência usada, vinda do perfil. É o prefill da tela de
       * entrada de um mundo **sem** vínculo — sem isto, o campo de nome voltaria
       * a nascer vazio depois de todo logout, porque nada disto sobrevive a um
       * recarregamento da página.
       */
      selfName: lobby.me.name,
      selfColor: lobby.me.color,
      selfAppearance: lobby.me.appearance,
      // `detail` ausente numa resposta não fecha o painel aberto: operações que
      // não são de gerenciamento (aceitar convite, criar mundo) não devem
      // derrubar a tela de quem está no meio de administrar outro mundo
      worldDetail: detail ?? state.worldDetail,
    })),
  closeWorldDetail: () => set({ worldDetail: null }),
  chooseWorld: (world, opts) =>
    set((state) => {
      /**
       * O vínculo é o que dispensa a tela de entrada. Ele vem do banco
       * (`presence_state`), não daqui: um `null` significa "nunca entrei neste
       * mundo", e é a única coisa que faz a pergunta aparecer.
       */
      const binding = world.binding;
      const direct = binding !== null && !opts?.edit;
      return {
        phase: direct ? 'playing' : 'join',
        joinDenied: null,
        selfWorldId: world.id,
        selfWorldName: world.name,
        // o cenário é do MUNDO, não uma escolha da tela de entrada
        selfScenario: world.scenarioId,
        // sem vínculo, mantém o que o `setLobby` preencheu (a última aparência
        // usada) — é o prefill da tela, não uma escolha já feita
        selfName: binding?.name ?? state.selfName,
        selfColor: binding?.color ?? state.selfColor,
        selfAppearance: binding?.appearance ?? state.selfAppearance,
      };
    }),
  backToLobby: () => set({ phase: 'lobby', joinDenied: null }),
  setAuthEmail: (email) =>
    set((state) => ({
      authEmail: email,
      // deslogar tem de tirar a pessoa do mundo, não só esquecer o e-mail
      phase: email ? (state.phase === 'login' ? 'lobby' : state.phase) : 'login',
      ...(email
        ? {}
        : {
            worlds: [],
            pendingInvites: [],
            worldDetail: null,
            selfWorldId: null,
            selfWorldName: null,
          }),
    })),
  denyJoin: (reason) => set({ phase: 'join', joinDenied: reason }),

  /**
   * Zera tudo que pertence à sessão. Sair troca `phase`, o que desmonta o
   * GameView e dispara a limpeza dele (socket, sala de voz, app do Pixi).
   * Nome/cor/cenário/personagem ficam para a tela de entrada vir preenchida, e
   * `noiseFilter` fica porque é preferência do usuário, não estado de sessão.
   * A conta (`authEmail`) também fica: sair do mundo não é sair da conta.
   */
  leave: () =>
    set((state) => ({
      // quem tem conta volta para a lista de mundos; anônimo, para a entrada
      phase: state.authEmail ? 'lobby' : 'join',
      selfId: null,
      connected: false,
      roster: [],
      chat: [],
      micAvailable: false,
      // sair e voltar recomeça mudo, igual a entrar pela primeira vez
      micEnabled: false,
      deafened: false,
      voiceStatus: 'idle',
      audioBlocked: false,
      micDevices: [],
      activeMicId: null,
      micSwitching: false,
      audioZone: null,
      canSit: false,
      away: false,
      selfBooble: null,
      nudges: [],
      calls: [],
      myCalls: {},
      // `soundboardMuted` e `soundboardVolume` NÃO entram aqui: são preferência
      // (a segunda vive no perfil, no banco). O que morre é o estado de sessão.
      soundboard: null,
      /**
       * `peerAudio` entra: a preferência é durável, mas a CHAVE é `socket.id` e
       * ela não sobrevive a sair do mundo. Quem volta é rehidratado pelo
       * servidor no join — guardar o mapa antigo seria guardar chaves mortas.
       */
      peerAudio: {},
      noiseFilterActive: false,
      sharing: false,
      remoteScreens: [],
      speaking: {},
      nearbyIds: [],
      boobleReachIds: [],
      pendingBooble: null,
      focusedScreenId: null,
      zoomPct: 100,
      contextMenu: null,
    })),
  setScenario: (id) => set({ selfScenario: id }),
  setSelf: (id, connected) => set({ selfId: id, connected }),
  setRoster: (roster) => set({ roster }),
  upsertRosterEntry: (entry) =>
    set((s) => ({
      roster: [...s.roster.filter((r) => r.id !== entry.id), entry],
    })),
  removeRosterEntry: (id) =>
    set((s) => {
      // quem saiu do mundo não deixa chamado pendurado: nem o alerta na minha
      // tela, nem o item do menu "pressionado" para um id que já morreu
      const { [id]: _gone, ...myCalls } = s.myCalls;
      /**
       * O ajuste de volume desta pessoa sai junto: a chave é `socket.id`, e
       * guardá-la faria o mapa crescer sem fim numa sessão longa apontando para
       * gente que não existe mais. Não se perde nada — quem volta ganha um
       * socket novo e o servidor reenvia a preferência no join dela.
       */
      const { [id]: _volumeGone, ...peerAudio } = s.peerAudio;
      return {
        roster: s.roster.filter((r) => r.id !== id),
        speaking: { ...s.speaking, [id]: false },
        calls: s.calls.filter((c) => c.id !== id),
        myCalls,
        peerAudio,
      };
    }),
  setChat: (chat) => set({ chat }),
  appendChat: (msg) => set((s) => ({ chat: [...s.chat.slice(-199), msg] })),
  setMicAvailable: (v) => set({ micAvailable: v }),
  setMicEnabled: (v) => set({ micEnabled: v }),
  setDeafened: (v) => set({ deafened: v }),
  setVoiceStatus: (v) => set({ voiceStatus: v }),
  setAudioBlocked: (v) => set({ audioBlocked: v }),
  setMicDevices: (devices) => set({ micDevices: devices }),
  setActiveMicId: (id) => set({ activeMicId: id }),
  setMicSwitching: (v) => set({ micSwitching: v }),
  setAudioZone: (label) => set({ audioZone: label }),
  setCanSit: (v) => set({ canSit: v }),
  setAway: (v) =>
    set((s) => ({
      away: v,
      // trocar de estado zera os chamados nos dois sentidos: voltar é a resposta
      // ao chamado, e ausentar-se de novo não deve arrastar o aviso da vez
      // passada — chamado velho pendurado na tela é pior que nenhum
      nudges: [],
      // o próprio nome na lista também mostra o estado
      roster: s.roster.map((r) => (r.id === s.selfId ? { ...r, away: v } : r)),
    })),
  setSoundboard: (state) => set({ soundboard: state }),
  setSoundboardVolume: (volume) => set({ soundboardVolume: volume }),
  setSoundboardMuted: (muted) => {
    try {
      localStorage.setItem('together:soundboard', muted ? 'off' : 'on');
    } catch {
      // modo privado / storage cheio: a preferência vale só nesta aba
    }
    set({ soundboardMuted: muted });
  },
  setPeerAudio: (id, prefs) => set((s) => ({ peerAudio: { ...s.peerAudio, [id]: prefs } })),
  /**
   * Merge, e não substituição: o mapa que o servidor manda é PARCIAL — no join
   * ele traz quem eu já ajustei, e depois uma entrada por pessoa que chega.
   * Substituir apagaria o ajuste que acabei de fazer em quem já estava aqui.
   */
  mergePeerAudio: (prefs) => set((s) => ({ peerAudio: { ...s.peerAudio, ...prefs } })),
  setPlayerAway: (id, away) =>
    set((s) => ({ roster: s.roster.map((r) => (r.id === id ? { ...r, away } : r)) })),
  setPlayerBooble: (id, boobleId) =>
    set((s) => ({
      roster: s.roster.map((r) => (r.id === id ? { ...r, boobleId } : r)),
      // a minha booble entra no MESMO `set` que o roster: em dois `set` haveria
      // um render intermediário com a lista dizendo uma coisa e o aviso outra
      ...(id === s.selfId ? { selfBooble: boobleId } : {}),
    })),
  pushNudge: (id, name) =>
    set((s) => ({
      // um por pessoa: dois toques da mesma pessoa são um chamado com hora nova,
      // não dois nomes repetidos na lista
      nudges: [...s.nudges.filter((n) => n.id !== id), { id, name, at: Date.now() }],
    })),
  clearNudges: () => set({ nudges: [] }),
  pushCall: (id, name, kind) =>
    set((s) => ({
      // um por pessoa E por tipo: chamar de novo é o mesmo cartão com hora nova
      calls: [
        ...s.calls.filter((c) => !(c.id === id && c.kind === kind)),
        { id, name, at: Date.now(), kind },
      ],
    })),
  removeCall: (id, kind) =>
    set((s) => ({ calls: s.calls.filter((c) => !(c.id === id && c.kind === kind)) })),
  setMyCall: (id) => set((s) => ({ myCalls: { ...s.myCalls, [id]: Date.now() } })),
  clearMyCall: (id) =>
    set((s) => {
      const { [id]: _gone, ...rest } = s.myCalls;
      return { myCalls: rest };
    }),
  setNoiseFilter: (v) => set({ noiseFilter: v }),
  setNoiseFilterActive: (v) => set({ noiseFilterActive: v }),
  setSharing: (v) => set({ sharing: v }),
  addRemoteScreen: (peerId, track) =>
    set((s) => ({
      remoteScreens: [...s.remoteScreens.filter((r) => r.peerId !== peerId), { peerId, track }],
    })),
  removeRemoteScreen: (peerId) =>
    set((s) => ({
      remoteScreens: s.remoteScreens.filter((r) => r.peerId !== peerId),
      focusedScreenId: s.focusedScreenId === peerId ? null : s.focusedScreenId,
    })),
  setSpeaking: (id, v) =>
    set((s) => (Boolean(s.speaking[id]) === v ? s : { speaking: { ...s.speaking, [id]: v } })),
  setNearbyIds: (ids) => set({ nearbyIds: ids }),
  setBoobleReachIds: (ids) => set({ boobleReachIds: ids }),
  setPendingBooble: (id) => set({ pendingBooble: id }),
  setFocusedScreen: (peerId) => set({ focusedScreenId: peerId }),
  setZoomPct: (pct) => set({ zoomPct: pct }),
  openContextMenu: (id, x, y) => set({ contextMenu: { id, x, y } }),
  closeContextMenu: () => set({ contextMenu: null }),
}));
