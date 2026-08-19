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
/**
 * Backoff das nossas tentativas (a reconexão do próprio SDK acontece antes).
 * Não existe número máximo de tentativas de propósito: desistir deixava a voz
 * morta com o socket saudável, e o usuário só descobria tentando falar.
 */
const RECONNECT_BASE_MS = 1500;
const RECONNECT_MAX_MS = 30000;
/** Recusa por rate limit é "espere", não falha: o bucket do servidor recarrega. */
const RATE_LIMIT_WAIT_MS = 4000;

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
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  /** histórico de quedas — o usuário não sabia dizer se caíam juntos ou não */
  private drops: Array<{ em: string; motivo: string }> = [];
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
    private getAudioInfo: () => {
      selfZone: string | null;
      peers: Map<string, { distance: number; zone: string | null }>;
    },
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

    // sala saudável com a identidade atual: nada a fazer
    if (this.room && this.identity === socketId) return;

    const store = useStore.getState();
    store.setVoiceStatus(this.room ? 'reconnecting' : 'connecting');

    /**
     * TOKEN PRIMEIRO, teardown depois. Antes o `await teardownRoom()` vinha
     * aqui, e o `room.disconnect()` dele é justamente a janela (segundos, com
     * round-trip de sinalização) em que o socket caía — aí o emit do token ia
     * para o `sendBuffer` e só falhava por timeout. Pedir antes fecha a janela.
     */
    const res = await requestVoiceToken(this.socket);
    if (gen !== this.gen || this.destroyed) return;

    if (!res.ok) {
      store.setVoiceStatus(res.reason === 'not-configured' ? 'unavailable' : 'error');
      if (res.reason !== 'not-configured') {
        console.warn('[voice] token recusado:', res.reason);
        // rate limit não é falha: o bucket do servidor recarrega sozinho
        // o servidor manda quanto esperar; não precisamos adivinhar
        this.scheduleReconnect(
          gen,
          res.reason === 'rate-limited'
            ? Math.max(res.retryAfterMs ?? 0, RATE_LIMIT_WAIT_MS)
            : undefined,
        );
      }
      return;
    }
    // token emitido para o socket anterior não serve — mas isso é um retry,
    // não um beco sem saída: antes daqui saía um `return` silencioso que
    // deixava a voz morta até a próxima reconexão de socket
    if (res.identity !== this.socket.id) {
      this.scheduleReconnect(gen);
      return;
    }

    // só agora a sala velha morre — com o token já em mão
    if (this.room) await this.teardownRoom();
    if (gen !== this.gen || this.destroyed) return;

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

  onSocketDisconnected(reason?: string): void {
    this.registrarQueda(`socket: ${reason ?? 'sem motivo'}`);
    // não derruba a sala: o SDK tem reconexão própria e o socket volta logo.
    // O tick para de reconciliar (ver a guarda em tick) e os volumes congelam.
    useStore.getState().setVoiceStatus(this.room ? 'reconnecting' : 'idle');
  }

  /**
   * Reagenda indefinidamente, com backoff limitado. Sem teto de tentativas: se
   * o socket está de pé, sempre existe chance de a voz voltar, e desistir era
   * exatamente o que deixava a chamada muda até recarregar a página.
   */
  private scheduleReconnect(gen: number, waitMs?: number): void {
    if (this.destroyed || this.retryTimer !== null) return;
    const delay =
      waitMs ?? Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (gen !== this.gen || this.destroyed) return;
      // socket caído: o handler de `connect` vai chamar de novo, não insiste aqui
      if (this.socket.connected) void this.onSocketConnected();
    }, delay);
  }

  /** Socket novo é chance nova: zera o backoff (antes ele só zerava no sucesso). */
  onSocketReconnected(): void {
    this.reconnectAttempts = 0;
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
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

    // estado de UI que sobrevivia ao teardown e ficava mentindo:
    const store = useStore.getState();
    // telas remotas ficavam renderizando um tile com faixa morta, para sempre
    for (const screen of store.remoteScreens) store.removeRemoteScreen(screen.peerId);
    // vizinhos com ids do socket antigo (o HUD mostrava gente que já saiu)
    store.setNearbyIds([]);
    // ESTE era quebra permanente: com `screenSharing` preso em true o
    // startScreenShare() retornava cedo para sempre e o usuário não conseguia
    // mais compartilhar até recarregar a página
    this.screenSharing = false;
    store.setSharing(false);
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
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = null;
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
      this.registrarQueda(`sala: ${reason ?? 'sem motivo'}`);
      console.warn('[voice] sala desconectada:', reason);
      const gen = this.gen;
      void this.teardownRoom().then(() => {
        // sem esta guarda, um teardown lento sobrescreve o 'connected' de uma
        // sala NOVA com 'error' e ainda queima uma tentativa dela
        if (this.destroyed || gen !== this.gen) return;
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
      const naSala = this.getAudioInfo().selfZone !== null;
      track.setVolume(
        this.deafened || dist === undefined ? 0 : naSala ? 1 : volumeForDistance(dist),
      );
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
    // remover do DOM NAO para a reprodução nem solta o stream
    el.pause();
    el.srcObject = null;
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
      const gen = this.gen;
      void import('./krisp').then(async ({ applyNoiseFilter }) => {
        const handle = await applyNoiseFilter(track);
        /**
         * Guarda de geração: sem ela, um filtro em vôo durante uma reconexão se
         * atribuía a uma faixa da sala MORTA — e como o teardown zera
         * `noiseFilterTried`, a sala nova criava um SEGUNDO processador. O
         * perdedor vazava worker + ~2MB de wasm para sempre.
         */
        if (this.destroyed || gen !== this.gen) {
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
    const { selfZone, peers } = this.getAudioInfo();
    const want = new Set<string>();
    for (const id of this.roomSpeakers) {
      const p = peers.get(id);
      const audivel =
        p !== undefined && p.zone === selfZone && (selfZone !== null || p.distance <= PROXIMITY_RADIUS);
      if (id === this.identity || audivel) want.add(id);
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

    const { selfZone, peers } = this.getAudioInfo();
    const now = performance.now();

    /**
     * A REGRA, num lugar só: você ouve alguém quando estão na mesma zona.
     *
     * `null` significa área aberta, então `null === null` faz duas pessoas em
     * área aberta se ouvirem por proximidade, como antes. Se você está numa
     * sala e a pessoa não (ou está em outra), os ids diferem e não há áudio —
     * nem colada na parede. É isso que faz a sala ser fechada.
     */
    const mesmaZona = (zone: string | null) => zone === selfZone;

    // candidatos a áudio: mesma zona e, na área aberta, dentro do raio.
    // Numa sala a distância não importa: a sala inteira se ouve.
    const ranked = [...peers.entries()]
      .filter(([, p]) => mesmaZona(p.zone) && (selfZone !== null || p.distance <= AUDIO_SUBSCRIBE_RADIUS))
      .sort((a, b) => a[1].distance - b[1].distance)
      .slice(0, MAX_AUDIO_SUBSCRIPTIONS);
    const audioWanted = new Set(ranked.map(([id]) => id));

    const nearby: string[] = [];

    for (const participant of room.remoteParticipants.values()) {
      const id = participant.identity;
      const info = peers.get(id);
      const dist = info?.distance;
      const timers = this.timers.get(id) ?? { audioOutSince: null, videoOutSince: null };
      this.timers.set(id, timers);

      // saiu do mundo (ou é fantasma de um reload anterior): corta tudo
      if (dist === undefined || info === undefined) {
        this.setSubscribed(participant, Track.Source.Microphone, false);
        this.setSubscribed(participant, Track.Source.ScreenShare, false);
        this.lastDistance.delete(id);
        continue;
      }
      this.lastDistance.set(id, dist);
      // o badge "voz" no HUD tem de refletir a mesma regra, senão mente
      if (mesmaZona(info.zone) && (selfZone !== null || dist <= PROXIMITY_RADIUS)) nearby.push(id);

      // --- áudio: assina generoso, atenua preciso
      if (!this.deafened && audioWanted.has(id)) {
        timers.audioOutSince = null;
        this.setSubscribed(participant, Track.Source.Microphone, true);
        // numa sala todos se ouvem igual (quem está na ponta da mesa ouve como
        // quem está ao lado); na área aberta vale a rampa por distância
        participant.setVolume(selfZone !== null ? 1 : volumeForDistance(dist));
      } else {
        participant.setVolume(0);
        timers.audioOutSince ??= now;
        const expired = this.deafened || now - timers.audioOutSince > AUDIO_SUBSCRIBE_GRACE_MS;
        if (expired) this.setSubscribed(participant, Track.Source.Microphone, false);
      }

      // --- vídeo de tela: portão mais apertado, sem fade a proteger
      if (mesmaZona(info.zone) && (selfZone !== null || dist <= VIDEO_RADIUS)) {
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

  private registrarQueda(motivo: string): void {
    this.drops.push({ em: new Date().toISOString(), motivo });
    if (this.drops.length > 20) this.drops.shift();
  }

  private debugState() {
    const room = this.room;
    const { selfZone, peers } = this.getAudioInfo();
    return {
      status: useStore.getState().voiceStatus,
      state: room?.state ?? 'sem sala',
      identity: this.identity,
      socketId: this.socket.id,
      canPlaybackAudio: room?.canPlaybackAudio ?? null,
      micIntent: this.micIntent,
      deafened: this.deafened,
      zona: selfZone,
      quedas: this.drops.length,
      ultimaQueda: this.drops[this.drops.length - 1] ?? null,
      historico: this.drops,
      tentativasDeReconexao: this.reconnectAttempts,
      retryPendente: this.retryTimer !== null,
      sharing: this.screenSharing,
      participants: [...(room?.remoteParticipants.values() ?? [])].map((p) => ({
        identity: p.identity,
        distance: peers.get(p.identity)?.distance ?? null,
        zona: peers.get(p.identity)?.zone ?? null,
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
