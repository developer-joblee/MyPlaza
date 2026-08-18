import { create } from 'zustand';
import { AVATAR_COLORS, type ChatMessage } from '@together/shared';

export interface RosterEntry {
  id: string;
  name: string;
  color: number;
}

export interface RemoteScreen {
  peerId: string;
  stream: MediaStream;
}

interface AppState {
  phase: 'join' | 'playing';
  selfName: string;
  selfColor: number;
  selfId: string | null;
  connected: boolean;
  roster: RosterEntry[];
  chat: ChatMessage[];
  micAvailable: boolean;
  micEnabled: boolean;
  sharing: boolean;
  remoteScreens: RemoteScreen[];
  speaking: Record<string, boolean>;
  /** ids dos players dentro do alcance de voz */
  nearbyIds: string[];
  focusedScreenId: string | null;

  join: (name: string, color: number) => void;
  setSelf: (id: string | null, connected: boolean) => void;
  setRoster: (roster: RosterEntry[]) => void;
  upsertRosterEntry: (entry: RosterEntry) => void;
  removeRosterEntry: (id: string) => void;
  setChat: (chat: ChatMessage[]) => void;
  appendChat: (msg: ChatMessage) => void;
  setMicAvailable: (v: boolean) => void;
  setMicEnabled: (v: boolean) => void;
  setSharing: (v: boolean) => void;
  addRemoteScreen: (peerId: string, stream: MediaStream) => void;
  removeRemoteScreen: (peerId: string) => void;
  setSpeaking: (id: string, v: boolean) => void;
  setNearbyIds: (ids: string[]) => void;
  setFocusedScreen: (peerId: string | null) => void;
}

export const useStore = create<AppState>((set) => ({
  phase: 'join',
  selfName: '',
  selfColor: AVATAR_COLORS[0],
  selfId: null,
  connected: false,
  roster: [],
  chat: [],
  micAvailable: false,
  micEnabled: true,
  sharing: false,
  remoteScreens: [],
  speaking: {},
  nearbyIds: [],
  focusedScreenId: null,

  join: (name, color) => set({ phase: 'playing', selfName: name, selfColor: color }),
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
  setSharing: (v) => set({ sharing: v }),
  addRemoteScreen: (peerId, stream) =>
    set((s) => ({
      remoteScreens: [...s.remoteScreens.filter((r) => r.peerId !== peerId), { peerId, stream }],
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
}));
