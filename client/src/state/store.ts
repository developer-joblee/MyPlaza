import { create } from 'zustand';
import {
  AVATAR_COLORS,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  type CharacterId,
  type ChatMessage,
  type JoinDeniedReason,
  type LobbyState,
  type PendingInvite,
  type ScenarioId,
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
  selfCharacter: CharacterId;
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
  /** intenção do usuário; o mic efetivo é `micEnabled && !deafened` */
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
  /** preferência do usuário para o cancelamento de ruído */
  noiseFilter: boolean;
  /** se o filtro está de fato rodando (pode falhar por falta de suporte) */
  noiseFilterActive: boolean;
  sharing: boolean;
  remoteScreens: RemoteScreen[];
  speaking: Record<string, boolean>;
  /** ids dos players dentro do alcance de voz */
  nearbyIds: string[];
  focusedScreenId: string | null;
  /** zoom alvo da câmera, em % */
  zoomPct: number;

  join: (name: string, color: number, scenario: ScenarioId, character: CharacterId) => void;
  /** terminou o boot: vai para o login, o lobby, ou direto para a entrada */
  setPhase: (phase: 'login' | 'lobby' | 'join') => void;
  setLobby: (state: LobbyState, detail?: WorldDetail) => void;
  /** fecha o painel de gerenciamento */
  closeWorldDetail: () => void;
  /** escolheu um mundo no lobby: guarda id, nome e o cenário DELE */
  chooseWorld: (world: WorldSummary) => void;
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
  setNoiseFilter: (v: boolean) => void;
  setNoiseFilterActive: (v: boolean) => void;
  setSharing: (v: boolean) => void;
  addRemoteScreen: (peerId: string, track: RemoteVideoTrack) => void;
  removeRemoteScreen: (peerId: string) => void;
  setSpeaking: (id: string, v: boolean) => void;
  setNearbyIds: (ids: string[]) => void;
  setFocusedScreen: (peerId: string | null) => void;
  setZoomPct: (pct: number) => void;
}

export const useStore = create<AppState>((set) => ({
  phase: 'boot',
  selfName: '',
  selfColor: AVATAR_COLORS[0],
  selfScenario: DEFAULT_SCENARIO,
  selfCharacter: DEFAULT_CHARACTER,
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
  micEnabled: true,
  deafened: false,
  voiceStatus: 'idle',
  audioBlocked: false,
  micDevices: [],
  activeMicId: null,
  micSwitching: false,
  audioZone: null,
  canSit: false,
  away: false,
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
  focusedScreenId: null,
  zoomPct: 100,

  join: (name, color, scenario, character) =>
    set({
      phase: 'playing',
      joinDenied: null,
      selfName: name,
      selfColor: color,
      selfScenario: scenario,
      selfCharacter: character,
    }),

  setPhase: (phase) => set({ phase }),
  setLobby: (lobby, detail) =>
    set((state) => ({
      worlds: lobby.worlds,
      pendingInvites: lobby.invites,
      myId: lobby.myId,
      // `detail` ausente numa resposta não fecha o painel aberto: operações que
      // não são de gerenciamento (aceitar convite, criar mundo) não devem
      // derrubar a tela de quem está no meio de administrar outro mundo
      worldDetail: detail ?? state.worldDetail,
    })),
  closeWorldDetail: () => set({ worldDetail: null }),
  chooseWorld: (world) =>
    set({
      phase: 'join',
      joinDenied: null,
      selfWorldId: world.id,
      selfWorldName: world.name,
      // o cenário é do MUNDO, não uma escolha da tela de entrada
      selfScenario: world.scenarioId,
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
      micEnabled: true,
      deafened: false,
      voiceStatus: 'idle',
      audioBlocked: false,
      micDevices: [],
      activeMicId: null,
      micSwitching: false,
      audioZone: null,
      canSit: false,
      away: false,
      noiseFilterActive: false,
      sharing: false,
      remoteScreens: [],
      speaking: {},
      nearbyIds: [],
      focusedScreenId: null,
      zoomPct: 100,
    })),
  setScenario: (id) => set({ selfScenario: id }),
  setSelf: (id, connected) => set({ selfId: id, connected }),
  setRoster: (roster) => set({ roster }),
  upsertRosterEntry: (entry) =>
    set((s) => ({
      roster: [...s.roster.filter((r) => r.id !== entry.id), entry],
    })),
  removeRosterEntry: (id) =>
    set((s) => ({
      roster: s.roster.filter((r) => r.id !== id),
      speaking: { ...s.speaking, [id]: false },
    })),
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
      // o próprio nome na lista também mostra o estado
      roster: s.roster.map((r) => (r.id === s.selfId ? { ...r, away: v } : r)),
    })),
  setPlayerAway: (id, away) =>
    set((s) => ({ roster: s.roster.map((r) => (r.id === id ? { ...r, away } : r)) })),
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
  setFocusedScreen: (peerId) => set({ focusedScreenId: peerId }),
  setZoomPct: (pct) => set({ zoomPct: pct }),
}));
