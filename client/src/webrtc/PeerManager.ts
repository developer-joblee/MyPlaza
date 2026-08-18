import {
  DISCONNECT_GRACE_MS,
  PROXIMITY_HYSTERESIS,
  PROXIMITY_RADIUS,
  type SignalPayload,
} from '@together/shared';
import type { AppSocket } from '../net/socket';
import { useStore } from '../state/store';
import { volumeForDistance } from './proximity';
import type { SpeakingDetector } from './SpeakingDetector';

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
};

const PROXIMITY_TICK_MS = 250;

interface Peer {
  pc: RTCPeerConnection;
  audioEl: HTMLAudioElement;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  outOfRangeSince: number | null;
}

/**
 * Mesh P2P: mantém uma RTCPeerConnection por player dentro do raio de
 * proximidade, usando o padrão "perfect negotiation" (MDN) para evitar glare.
 * Ambos os lados criam a conexão ao entrar no raio; a polidez (baseada na
 * comparação de socket ids) resolve ofertas simultâneas.
 */
export class PeerManager {
  private peers = new Map<string, Peer>();
  private screenStream: MediaStream | null = null;
  private interval: ReturnType<typeof setInterval>;
  private destroyed = false;

  constructor(
    private socket: AppSocket,
    private micStream: MediaStream | null,
    private detector: SpeakingDetector | null,
    private getDistances: () => Map<string, number>,
  ) {
    socket.on('rtc:signal', this.onSignal);
    this.interval = setInterval(() => this.tick(), PROXIMITY_TICK_MS);

    // hook de diagnóstico (console/testes): estado de cada conexão P2P
    (window as unknown as Record<string, unknown>).__togetherPeers = () =>
      Promise.all(
        [...this.peers.entries()].map(async ([id, p]) => {
          const inbound: Array<Record<string, unknown>> = [];
          try {
            (await p.pc.getStats()).forEach((report) => {
              if (report.type === 'inbound-rtp') {
                inbound.push({
                  kind: report.kind,
                  packetsReceived: report.packetsReceived,
                  audioLevel: report.audioLevel,
                });
              }
            });
          } catch {
            // getStats pode falhar em conexões fechando
          }
          return {
            id,
            connection: p.pc.connectionState,
            ice: p.pc.iceConnectionState,
            signaling: p.pc.signalingState,
            volume: p.audioEl.volume,
            receivers: p.pc.getReceivers().map((r) => r.track.kind),
            senders: p.pc.getSenders().map((s) => s.track?.kind ?? 'null'),
            inbound,
          };
        }),
      );
  }

  // ---------------------------------------------------------------- ciclo

  private tick(): void {
    if (this.destroyed || !this.socket.connected) return;
    const distances = this.getDistances();
    const nearby: string[] = [];

    for (const [id, dist] of distances) {
      let peer = this.peers.get(id);
      if (!peer && dist <= PROXIMITY_RADIUS) {
        peer = this.createPeer(id);
      }
      if (!peer) continue;

      if (dist <= PROXIMITY_RADIUS + PROXIMITY_HYSTERESIS) {
        peer.outOfRangeSince = null;
        peer.audioEl.volume = volumeForDistance(dist);
        if (dist <= PROXIMITY_RADIUS) nearby.push(id);
      } else {
        peer.outOfRangeSince ??= performance.now();
        if (performance.now() - peer.outOfRangeSince > DISCONNECT_GRACE_MS) {
          this.closePeer(id);
        }
      }
    }

    // players que saíram do mundo
    for (const id of [...this.peers.keys()]) {
      if (!distances.has(id)) this.closePeer(id);
    }

    const store = useStore.getState();
    if (
      nearby.length !== store.nearbyIds.length ||
      nearby.some((id) => !store.nearbyIds.includes(id))
    ) {
      store.setNearbyIds(nearby);
    }
  }

  // ------------------------------------------------------------- conexões

  private createPeer(id: string): Peer {
    const selfId = this.socket.id ?? '';
    const pc = new RTCPeerConnection(RTC_CONFIG);
    const audioEl = new Audio();
    audioEl.autoplay = true;

    const peer: Peer = {
      pc,
      audioEl,
      polite: selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      outOfRangeSince: null,
    };
    this.peers.set(id, peer);

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.sendDescription(id, pc);
      } catch (err) {
        console.error('negotiationneeded falhou:', err);
      } finally {
        peer.makingOffer = false;
      }
    };

    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('rtc:signal', { to: id, candidate: candidate.toJSON() });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };

    pc.ontrack = ({ track, streams }) => {
      const stream = streams[0] ?? new MediaStream([track]);
      if (track.kind === 'audio') {
        audioEl.srcObject = stream;
        void audioEl.play().catch(() => {});
        this.detector?.add(id, stream);
      } else {
        // sem webcam no MVP: qualquer vídeo é compartilhamento de tela
        useStore.getState().addRemoteScreen(id, stream);
        const cleanup = () => useStore.getState().removeRemoteScreen(id);
        track.onmute = cleanup;
        track.onended = cleanup;
      }
    };

    if (this.micStream) {
      for (const track of this.micStream.getAudioTracks()) pc.addTrack(track, this.micStream);
    }
    if (this.screenStream) {
      for (const track of this.screenStream.getVideoTracks()) {
        pc.addTrack(track, this.screenStream);
      }
    }

    return peer;
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    this.detector?.remove(id);
    peer.pc.onnegotiationneeded = null;
    peer.pc.onicecandidate = null;
    peer.pc.ontrack = null;
    peer.pc.close();
    peer.audioEl.srcObject = null;
    useStore.getState().removeRemoteScreen(id);
  }

  private sendDescription(to: string, pc: RTCPeerConnection): void {
    const desc = pc.localDescription;
    if (!desc) return;
    this.socket.emit('rtc:signal', {
      to,
      description: { type: desc.type, sdp: desc.sdp },
    });
  }

  // ----------------------------------------------------------- sinalização

  private onSignal = async (payload: SignalPayload) => {
    if (this.destroyed) return;
    const { from, description, candidate } = payload;

    let peer = this.peers.get(from);
    if (!peer) {
      // o outro lado entrou no raio uma fração antes de nós
      if (!description || description.type !== 'offer') return;
      peer = this.createPeer(from);
    }
    const { pc } = peer;

    try {
      if (description) {
        const offerCollision =
          description.type === 'offer' &&
          (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && offerCollision;
        if (peer.ignoreOffer) return;

        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          await pc.setLocalDescription();
          this.sendDescription(from, pc);
        }
      } else if (candidate) {
        try {
          await pc.addIceCandidate(candidate);
        } catch (err) {
          if (!peer.ignoreOffer) throw err;
        }
      }
    } catch (err) {
      console.error('Erro de sinalização WebRTC:', err);
    }
  };

  // ----------------------------------------------------------- screen share

  async startScreenShare(): Promise<boolean> {
    if (this.screenStream) return true;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
      });
    } catch {
      return false; // usuário cancelou o seletor
    }
    this.screenStream = stream;
    const track = stream.getVideoTracks()[0];
    track.onended = () => this.stopScreenShare(); // botão "parar" do navegador
    for (const peer of this.peers.values()) {
      peer.pc.addTrack(track, stream);
    }
    useStore.getState().setSharing(true);
    return true;
  }

  stopScreenShare(): void {
    if (!this.screenStream) return;
    const tracks = this.screenStream.getVideoTracks();
    for (const peer of this.peers.values()) {
      for (const sender of peer.pc.getSenders()) {
        if (sender.track && tracks.includes(sender.track)) {
          peer.pc.removeTrack(sender);
        }
      }
    }
    for (const track of tracks) track.stop();
    this.screenStream = null;
    useStore.getState().setSharing(false);
  }

  // ---------------------------------------------------------------- limpeza

  destroy(): void {
    this.destroyed = true;
    clearInterval(this.interval);
    this.socket.off('rtc:signal', this.onSignal);
    this.stopScreenShare();
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }
}
