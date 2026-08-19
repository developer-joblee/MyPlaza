import {
  createAudioAnalyser,
  LocalAudioTrack,
  RemoteAudioTrack,
  RemoteVideoTrack,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from 'livekit-client';
import {
  AUDIO_SUBSCRIBE_GRACE_MS,
  AUDIO_SUBSCRIBE_RADIUS,
  DISCONNECT_GRACE_MS,
  MAX_AUDIO_SUBSCRIPTIONS,
  PROXIMITY_HYSTERESIS,
  PROXIMITY_RADIUS,
  VOICE_TICK_MS,
} from '@together/shared';
import type { AppSocket } from '../net/socket';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { volumeForDistance } from './proximity';
import { requestVoiceToken } from './token';

const VIDEO_RADIUS = PROXIMITY_RADIUS + PROXIMITY_HYSTERESIS;
/** Tentativas de reconexão nossas (a do próprio SDK acontece antes disso) */
const MAX_RECONNECT_ATTEMPTS = 5;

interface PeerTimers {
  audioOutSince: number | null;
  videoOutSince: number | null;
}

/**
 * Voz e tela por proximidade sobre um SFU (LiveKit).
 *
 * A identidade do participante é o `socket.id`, o que faz o mapa de distâncias
 * do jogo (também chaveado por socket id) casar 1:1 com os participantes sem
 * nenhuma tabela extra. O preço é que uma reconexão do socket muda o id e
 * obriga a refazer a sala — ver `onSocketConnected`.
 *
 * O tick é um reconciliador idempotente: em vez de reagir a cada evento de
 * publicação, ele reafirma o estado desejado a cada 250ms. Publicação tardia,
 * reconexão e participante fantasma se resolvem sozinhos.
 */
export class VoiceRoom {
  private room: Room | null = null;
  private identity: string | null = null;
  private interval: ReturnType<typeof setInterval> | null = null;
  private timers = new Map<string, PeerTimers>();
  /** distância do último tick, para dar volume certo a uma subscrição nova */
  private lastDistance = new Map<string, number>();
  /** elementos <audio> por participante — o SDK não os cria (ver onTrackSubscribed) */
  private audioEls = new Map<string, HTMLAudioElement>();
  /** último ActiveSpeakers cru do servidor (sala inteira, não só quem ouvimos) */
  private roomSpeakers = new Set<string>();
  private appliedSpeaking = new Set<string>();
  private deafened = false;
  private micIntent = true;
  private screenSharing = false;
  /** analisador do mic local, para o medidor de nível da UI */
  private micAnalyser: { calculateVolume: () => number; cleanup: () => Promise<void> } | null = null;
  private noiseFilterTried = false;
  private noiseFilter: { setEnabled: (on: boolean) => Promise<unknown>; destroy: () => Promise<void> } | null = null;
  private reconnectAttempts = 0;
  private destroyed = false;
  /**
   * Contador de geração: todo await no caminho de voz pode ser atravessado por
   * uma reconexão do socket, por um segundo connect ou pelo unmount. Comparar a
   * geração depois de cada await é o que impede um callback velho de escrever
   * numa sala que já não existe.
   */
  private gen = 0;

  constructor(
    private socket: AppSocket,
    private getDistances: () => Map<string, number>,
    private opts: { micAvailable: boolean; micDeviceId: string | null },
  ) {
    this.micIntent = opts.micAvailable;
    (window as unknown as Record<string, unknown>).__togetherVoice = () => this.debugState();
  }

  // ------------------------------------------------------------- ciclo de vida

  /** Chamar no `connect` do socket, DEPOIS do `join`. */
  async onSocketConnected(): Promise<void> {
    if (this.destroyed) return;
    const gen = ++this.gen;
    const socketId = this.socket.id;

    // reconexão com id novo: a identidade antiga virou órfã e ninguém mais
    // assinaria ela — a voz morreria em silêncio com a sala "conectada"
    if (this.room && this.identity !== socketId) await this.teardownRoom();
    if (gen !== this.gen || this.destroyed) return;
    if (this.room) return; // mesma identidade, sala já de pé

    const store = useStore.getState();
    store.setVoiceStatus('connecting');

    const res = await requestVoiceToken(this.socket);
    if (gen !== this.gen || this.destroyed) return;

    if (!res.ok) {
      store.setVoiceStatus(res.reason === 'not-configured' ? 'unavailable' : 'error');
      if (res.reason !== 'not-configured') {
        console.warn('[voice] token recusado:', res.reason);
        this.scheduleReconnect(gen);
      }
      return;
    }
    // token emitido para o socket anterior não serve
    if (res.identity !== this.socket.id) return;

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
      audioCaptureDefaults: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        ...(this.opts.micDeviceId ? { deviceId: this.opts.micDeviceId } : {}),
      },
    });
    this.bindRoomEvents(room);

    try {
      // autoSubscribe false: quem decide o que chega é a proximidade
      await room.connect(res.url, res.token, { autoSubscribe: false });
    } catch (err) {
      if (gen !== this.gen || this.destroyed) return;
      console.error('[voice] falha ao conectar na sala:', err);
      room.removeAllListeners();
      store.setVoiceStatus('error');
      this.scheduleReconnect(gen);
      return;
    }
    if (gen !== this.gen || this.destroyed) {
      void room.disconnect(true);
      return;
    }

    this.room = room;
    this.identity = res.identity;
    this.reconnectAttempts = 0;
    store.setVoiceStatus('connected');
    store.setAudioBlocked(!room.canPlaybackAudio);

    await this.applyMicState();
    if (gen !== this.gen || this.destroyed) return;

    this.interval ??= setInterval(() => this.tick(), VOICE_TICK_MS);
  }

  onSocketDisconnected(): void {
    // não derruba a sala: o SDK tem reconexão própria e o socket volta logo.
    // O tick para de reconciliar (ver a guarda em tick) e os volumes congelam.
    useStore.getState().setVoiceStatus(this.room ? 'reconnecting' : 'idle');
  }

  private scheduleReconnect(gen: number): void {
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) return;
    const delay = Math.min(1000 * 2 ** this.reconnectAttempts, 15000);
    this.reconnectAttempts++;
    setTimeout(() => {
      if (gen === this.gen && !this.destroyed && this.socket.connected) void this.onSocketConnected();
    }, delay);
  }

  private async teardownRoom(): Promise<void> {
    const room = this.room;
    void this.micAnalyser?.cleanup();
    this.micAnalyser = null;
    // sem isto o worker/wasm do Krisp acumularia a cada sair-e-voltar
    void this.noiseFilter?.destroy();
    this.noiseFilter = null;
    this.noiseFilterTried = false;
    this.room = null;
    this.identity = null;
    for (const identity of [...this.audioEls.keys()]) this.detachAudio(identity);
    this.timers.clear();
    this.lastDistance.clear();
    this.roomSpeakers.clear();
    this.clearAllSpeaking();
    if (!room) return;
    room.removeAllListeners();
    try {
      await room.disconnect(true);
    } catch {
      // já caiu; nada a fazer
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.gen++; // invalida qualquer await em vôo
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    delete (window as unknown as Record<string, unknown>).__togetherVoice;
    const store = useStore.getState();
    store.setVoiceStatus('idle');
    store.setSharing(false);
    // síncrono por contrato (o cleanup do React não espera): dispara e esquece
    void this.teardownRoom();
  }

  // ---------------------------------------------------------------- eventos

  private bindRoomEvents(room: Room): void {
    room.on(RoomEvent.TrackSubscribed, this.onTrackSubscribed);
    room.on(RoomEvent.TrackUnsubscribed, this.onTrackUnsubscribed);
    room.on(RoomEvent.ActiveSpeakersChanged, this.onActiveSpeakers);
    room.on(RoomEvent.ParticipantDisconnected, this.onParticipantLeft);
    room.on(RoomEvent.LocalTrackUnpublished, this.onLocalUnpublished);
    room.on(RoomEvent.LocalTrackPublished, this.onLocalPublished);
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      useStore.getState().setAudioBlocked(!room.canPlaybackAudio);
    });
    room.on(RoomEvent.Reconnecting, () => useStore.getState().setVoiceStatus('reconnecting'));
    room.on(RoomEvent.Reconnected, () => useStore.getState().setVoiceStatus('connected'));
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.destroyed || room !== this.room) return;
      console.warn('[voice] sala desconectada:', reason);
      const gen = this.gen;
      void this.teardownRoom().then(() => {
        useStore.getState().setVoiceStatus('error');
        this.scheduleReconnect(gen);
      });
    });
  }

  private onTrackSubscribed = (
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track instanceof RemoteAudioTrack) {
      /**
       * Anexar é OBRIGATÓRIO: o SDK não toca áudio remoto sozinho (só mantém um
       * elemento dummy silencioso para o iOS). Sem isto a faixa fica assinada,
       * o `setVolume` é aceito e nada sai no alto-falante — silêncio total com
       * todos os indicadores verdes. O elemento fica oculto no DOM e é sobre
       * ele que o `setVolume` do participante age.
       */
      const el = track.attach();
      el.hidden = true;
      el.setAttribute('data-identity', participant.identity);
      document.body.appendChild(el);
      this.audioEls.set(participant.identity, el);

      // subscrição nova entra com volume 1: sem isto, os primeiros pacotes de
      // alguém distante chegam a todo volume por um tick (estalo audível)
      const dist = this.lastDistance.get(participant.identity);
      track.setVolume(this.deafened || dist === undefined ? 0 : volumeForDistance(dist));
    } else if (track instanceof RemoteVideoTrack && pub.source === Track.Source.ScreenShare) {
      // guarda a faixa, não um MediaStream montado à mão: com adaptiveStream o
      // SDK decide encaminhar o vídeo olhando os elementos passados em attach()
      useStore.getState().addRemoteScreen(participant.identity, track);
    }
  };

  private onTrackUnsubscribed = (
    track: RemoteTrack,
    pub: RemoteTrackPublication,
    participant: RemoteParticipant,
  ) => {
    if (track instanceof RemoteAudioTrack) {
      this.detachAudio(participant.identity, track);
    } else if (track instanceof RemoteVideoTrack && pub.source === Track.Source.ScreenShare) {
      useStore.getState().removeRemoteScreen(participant.identity);
    }
  };

  private detachAudio(identity: string, track?: RemoteAudioTrack): void {
    const el = this.audioEls.get(identity);
    if (!el) return;
    this.audioEls.delete(identity);
    if (track) track.detach(el);
    el.remove();
  }

  private onParticipantLeft = (participant: RemoteParticipant) => {
    this.detachAudio(participant.identity);
    this.timers.delete(participant.identity);
    this.lastDistance.delete(participant.identity);
    this.roomSpeakers.delete(participant.identity);
    useStore.getState().removeRemoteScreen(participant.identity);
    this.setSpeaking(participant.identity, false);
  };

  /** (re)cria o analisador quando o mic é publicado — inclusive após trocar de device */
  private onLocalPublished = (pub: { source: Track.Source; track?: unknown }) => {
    if (pub.source !== Track.Source.Microphone) return;
    const track = pub.track;
    if (!(track instanceof LocalAudioTrack)) return;

    // qual entrada está de fato em uso: sem isto, na primeira sessão nenhuma
    // linha da lista aparece selecionada (a preferência salva ainda é nula)
    const actual = track.mediaStreamTrack.getSettings().deviceId;
    if (actual) {
      this.opts.micDeviceId = actual;
      useStore.getState().setActiveMicId(actual);
    }

    void this.micAnalyser?.cleanup();
    try {
      // do próprio SDK: evita um segundo AudioContext nosso
      this.micAnalyser = createAudioAnalyser(track, { smoothingTimeConstant: 0.4 });
    } catch (err) {
      console.warn('[voice] medidor de nível indisponível:', err);
      this.micAnalyser = null;
    }

    // uma vez por sessão: trocar de dispositivo mantém o processor na faixa
    if (!this.noiseFilterTried && useStore.getState().noiseFilter) {
      this.noiseFilterTried = true;
      void import('./krisp').then(async ({ applyNoiseFilter }) => {
        const handle = await applyNoiseFilter(track);
        if (this.destroyed) {
          void handle?.destroy();
          return;
        }
        this.noiseFilter = handle;
        useStore.getState().setNoiseFilterActive(handle !== null);
      });
    }
  };

  /**
   * Liga/desliga o cancelamento de ruído. Desligado nunca importa o chunk do
   * Krisp (~2MB gzip), então quem não quer também não paga o download.
   */
  async setNoiseFilter(enabled: boolean): Promise<void> {
    const { saveNoiseFilterPreference } = await import('./krisp');
    saveNoiseFilterPreference(enabled);
    useStore.getState().setNoiseFilter(enabled);

    if (this.noiseFilter) {
      await this.noiseFilter.setEnabled(enabled);
      useStore.getState().setNoiseFilterActive(enabled);
      return;
    }
    if (!enabled) return;

    // primeira vez ligando nesta sessão: carrega e aplica agora
    const pub = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone);
    const track = pub?.track;
    if (!(track instanceof LocalAudioTrack)) return;
    const { applyNoiseFilter } = await import('./krisp');
    const handle = await applyNoiseFilter(track);
    if (this.destroyed) {
      void handle?.destroy();
      return;
    }
    this.noiseFilter = handle;
    this.noiseFilterTried = true;
    useStore.getState().setNoiseFilterActive(handle !== null);
  }

  /** Nível do microfone local, 0..1. Lido por rAF na UI (nunca via store). */
  getMicLevel(): number {
    if (!this.micAnalyser || !this.micIntent || this.deafened) return 0;
    try {
      return Math.min(1, this.micAnalyser.calculateVolume());
    } catch {
      return 0;
    }
  }

  private onLocalUnpublished = (pub: { source: Track.Source }) => {
    // cobre o "parar de compartilhar" da barra do próprio navegador
    if (pub.source === Track.Source.ScreenShare) {
      this.screenSharing = false;
      useStore.getState().setSharing(false);
    }
  };

  private onActiveSpeakers = (speakers: Array<{ identity: string }>) => {
    this.roomSpeakers = new Set(speakers.map((s) => s.identity));
    this.reconcileSpeaking();
  };

  /**
   * O evento do servidor é da sala inteira, mas o anel de "falando" só deve
   * acender para quem está audível — senão aparecem anéis do outro lado do mapa
   * em gente que você não ouve. O local sempre passa.
   */
  private reconcileSpeaking(): void {
    const distances = this.getDistances();
    const want = new Set<string>();
    for (const id of this.roomSpeakers) {
      const dist = distances.get(id);
      if (id === this.identity || (dist !== undefined && dist <= PROXIMITY_RADIUS)) want.add(id);
    }
    for (const id of this.appliedSpeaking) if (!want.has(id)) this.setSpeaking(id, false);
    for (const id of want) if (!this.appliedSpeaking.has(id)) this.setSpeaking(id, true);
    this.appliedSpeaking = want;
  }

  private setSpeaking(id: string, speaking: boolean): void {
    useStore.getState().setSpeaking(id, speaking);
    runtime.game?.setSpeaking(id, speaking);
  }

  private clearAllSpeaking(): void {
    for (const id of this.appliedSpeaking) this.setSpeaking(id, false);
    this.appliedSpeaking = new Set();
  }

  // ------------------------------------------------------------------- tick

  private tick(): void {
    const room = this.room;
    if (this.destroyed || !room || !this.socket.connected) return;

    const distances = this.getDistances();
    const now = performance.now();

    // candidatos a áudio: dentro do raio de subscrição, os mais próximos primeiro
    const ranked = [...distances.entries()]
      .filter(([, d]) => d <= AUDIO_SUBSCRIBE_RADIUS)
      .sort((a, b) => a[1] - b[1])
      .slice(0, MAX_AUDIO_SUBSCRIPTIONS);
    const audioWanted = new Set(ranked.map(([id]) => id));

    const nearby: string[] = [];

    for (const participant of room.remoteParticipants.values()) {
      const id = participant.identity;
      const dist = distances.get(id);
      const timers = this.timers.get(id) ?? { audioOutSince: null, videoOutSince: null };
      this.timers.set(id, timers);

      // saiu do mundo (ou é fantasma de um reload anterior): corta tudo
      if (dist === undefined) {
        this.setSubscribed(participant, Track.Source.Microphone, false);
        this.setSubscribed(participant, Track.Source.ScreenShare, false);
        this.lastDistance.delete(id);
        continue;
      }
      this.lastDistance.set(id, dist);
      if (dist <= PROXIMITY_RADIUS) nearby.push(id);

      // --- áudio: assina generoso, atenua preciso
      if (!this.deafened && audioWanted.has(id)) {
        timers.audioOutSince = null;
        this.setSubscribed(participant, Track.Source.Microphone, true);
        participant.setVolume(volumeForDistance(dist));
      } else {
        participant.setVolume(0);
        timers.audioOutSince ??= now;
        const expired = this.deafened || now - timers.audioOutSince > AUDIO_SUBSCRIBE_GRACE_MS;
        if (expired) this.setSubscribed(participant, Track.Source.Microphone, false);
      }

      // --- vídeo de tela: portão mais apertado, sem fade a proteger
      if (dist <= VIDEO_RADIUS) {
        timers.videoOutSince = null;
        this.setSubscribed(participant, Track.Source.ScreenShare, true);
      } else {
        timers.videoOutSince ??= now;
        if (now - timers.videoOutSince > DISCONNECT_GRACE_MS) {
          this.setSubscribed(participant, Track.Source.ScreenShare, false);
        }
      }
    }

    const store = useStore.getState();
    const prev = store.nearbyIds;
    if (prev.length !== nearby.length || nearby.some((id) => !prev.includes(id))) {
      store.setNearbyIds(nearby);
    }
    this.reconcileSpeaking();
  }

  /** `setSubscribed` é idempotente no SDK, então dá para reafirmar a cada tick. */
  private setSubscribed(
    participant: RemoteParticipant,
    source: Track.Source,
    subscribed: boolean,
  ): void {
    const pub = participant.getTrackPublication(source);
    if (pub && pub.isSubscribed !== subscribed) pub.setSubscribed(subscribed);
  }

  // ---------------------------------------------------------------- comandos

  /** Mic efetivo = intenção do usuário E não estar surdo. */
  private async applyMicState(): Promise<void> {
    const room = this.room;
    if (!room || !this.opts.micAvailable) return;
    const gen = this.gen;
    const enabled = this.micIntent && !this.deafened;
    try {
      await room.localParticipant.setMicrophoneEnabled(enabled);
    } catch (err) {
      console.warn('[voice] falha ao alternar microfone:', err);
      return;
    }
    if (gen !== this.gen || this.destroyed) return;
    useStore.getState().setMicEnabled(this.micIntent);
  }

  setMicEnabled(enabled: boolean): void {
    this.micIntent = enabled;
    // clicar no mic estando surdo sai do modo surdo (comportamento do Discord)
    if (enabled && this.deafened) this.setDeafened(false);
    else void this.applyMicState();
  }

  setDeafened(deafened: boolean): void {
    this.deafened = deafened;
    useStore.getState().setDeafened(deafened);
    if (deafened) {
      for (const p of this.room?.remoteParticipants.values() ?? []) {
        p.setVolume(0);
        this.setSubscribed(p, Track.Source.Microphone, false);
      }
    }
    void this.applyMicState();
  }

  async switchMic(deviceId: string): Promise<void> {
    this.opts.micDeviceId = deviceId;
    const room = this.room;
    if (!room) return;
    const store = useStore.getState();
    store.setMicSwitching(true);
    try {
      // internamente faz replaceTrack: não derruba nada do outro lado
      await room.switchActiveDevice('audioinput', deviceId);
      store.setActiveMicId(deviceId);
      // o analisador aponta para a faixa antiga; recria a partir da atual
      const pub = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      if (pub) this.onLocalPublished(pub as { source: Track.Source; track?: unknown });
    } catch (err) {
      console.warn('[voice] falha ao trocar de microfone:', err);
    } finally {
      store.setMicSwitching(false);
    }
  }

  /** Relista as entradas (chamado no `devicechange` e ao abrir o painel). */
  async refreshDevices(): Promise<void> {
    const { listMics } = await import('./mic');
    const devices = await listMics();
    if (this.destroyed) return;
    useStore.getState().setMicDevices(devices);
  }

  async startScreenShare(): Promise<boolean> {
    const room = this.room;
    if (!room || this.screenSharing) return this.screenSharing;
    try {
      await room.localParticipant.setScreenShareEnabled(true, { audio: false });
    } catch (err) {
      console.warn('[voice] compartilhamento de tela cancelado:', err);
      return false;
    }
    if (this.destroyed) return false;
    this.screenSharing = true;
    useStore.getState().setSharing(true);
    return true;
  }

  stopScreenShare(): void {
    const room = this.room;
    this.screenSharing = false;
    useStore.getState().setSharing(false);
    if (room) void room.localParticipant.setScreenShareEnabled(false);
  }

  /** Libera o áudio quando o browser bloqueou o autoplay. */
  async startAudio(): Promise<void> {
    const room = this.room;
    if (!room) return;
    try {
      await room.startAudio();
      useStore.getState().setAudioBlocked(!room.canPlaybackAudio);
    } catch (err) {
      console.warn('[voice] não foi possível liberar o áudio:', err);
    }
  }

  // --------------------------------------------------------------- diagnóstico

  private debugState() {
    const room = this.room;
    const distances = this.getDistances();
    return {
      status: useStore.getState().voiceStatus,
      state: room?.state ?? 'sem sala',
      identity: this.identity,
      socketId: this.socket.id,
      canPlaybackAudio: room?.canPlaybackAudio ?? null,
      micIntent: this.micIntent,
      deafened: this.deafened,
      sharing: this.screenSharing,
      participants: [...(room?.remoteParticipants.values() ?? [])].map((p) => ({
        identity: p.identity,
        distance: distances.get(p.identity) ?? null,
        volume: p.getVolume() ?? null,
        audioSubscribed: p.getTrackPublication(Track.Source.Microphone)?.isSubscribed ?? false,
        videoSubscribed: p.getTrackPublication(Track.Source.ScreenShare)?.isSubscribed ?? false,
        speaking: this.appliedSpeaking.has(p.identity),
        // prova de que o som realmente chega e toca: "assinado" nao basta
        anexado: this.audioEls.has(p.identity),
        elVolume: this.audioEls.get(p.identity)?.volume ?? null,
        tocando: (() => {
          const el = this.audioEls.get(p.identity);
          return el ? !el.paused && el.currentTime > 0 : false;
        })(),
      })),
    };
  }
}
