import { create } from 'zustand';
import {
  AVATAR_COLORS,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  type CharacterId,
  type ChatMessage,
  type ScenarioId,
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
  phase: 'join' | 'playing';
  selfName: string;
  selfColor: number;
  selfScenario: ScenarioId;
  selfCharacter: CharacterId;
  selfId: string | null;
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
  phase: 'join',
  selfName: '',
  selfColor: AVATAR_COLORS[0],
  selfScenario: DEFAULT_SCENARIO,
  selfCharacter: DEFAULT_CHARACTER,
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
      selfName: name,
      selfColor: color,
      selfScenario: scenario,
      selfCharacter: character,
    }),

  /**
   * Zera tudo que pertence à sessão. Sair troca `phase`, o que desmonta o
   * GameView e dispara a limpeza dele (socket, sala de voz, app do Pixi).
   * Nome/cor/cenário/personagem ficam para a tela de entrada vir preenchida, e
   * `noiseFilter` fica porque é preferência do usuário, não estado de sessão.
   */
  leave: () =>
    set({
      phase: 'join',
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
    }),
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
