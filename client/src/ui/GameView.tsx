import { useEffect, useRef } from 'react';
import { Game } from '../game/Game';
import { bindStoreToSocket } from '../net/bindStore';
import { createSocket } from '../net/socket';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { initMic, stopMic } from '../webrtc/media';
import { PeerManager } from '../webrtc/PeerManager';
import { SpeakingDetector } from '../webrtc/SpeakingDetector';
import { Chat } from './Chat';
import { Hud } from './Hud';
import { MediaControls } from './MediaControls';
import { ScreenShareView } from './ScreenShareView';
import { ZoomControls } from './ZoomControls';

export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { selfName, selfColor, selfScenario } = useStore.getState();
    const socket = createSocket();
    runtime.socket = socket;
    const unbindStore = bindStoreToSocket(socket);

    let cancelled = false;
    let game: Game | null = null;
    let peerManager: PeerManager | null = null;
    let detector: SpeakingDetector | null = null;

    void (async () => {
      // pedir o mic antes de tudo (o clique em "Entrar" é o gesto do usuário)
      const mic = await initMic();
      if (cancelled) {
        stopMic();
        return;
      }
      useStore.getState().setMicAvailable(mic !== null);
      useStore.getState().setMicEnabled(mic !== null);

      game = await Game.create(container, socket, selfName, selfColor, selfScenario);
      if (cancelled) {
        game.destroy();
        game = null;
        return;
      }
      runtime.game = game;

      detector = new SpeakingDetector((id, speaking) => {
        useStore.getState().setSpeaking(id, speaking);
        runtime.game?.setSpeaking(id, speaking);
      });

      peerManager = new PeerManager(socket, mic, detector, () => game!.getDistances());
      runtime.peerManager = peerManager;

      socket.on('connect', () => {
        socket.emit('join', selfName, selfColor, selfScenario);
        if (mic && socket.id) detector?.add(socket.id, mic);
      });
      socket.connect();
    })();

    return () => {
      cancelled = true;
      unbindStore();
      peerManager?.destroy();
      detector?.destroy();
      game?.destroy();
      stopMic();
      socket.disconnect();
      runtime.socket = null;
      runtime.game = null;
      runtime.peerManager = null;
    };
  }, []);

  return (
    <div className="game-view">
      <div ref={containerRef} className="canvas-host" />
      <Hud />
      <ScreenShareView />
      <Chat />
      <MediaControls />
      <ZoomControls />
    </div>
  );
}
