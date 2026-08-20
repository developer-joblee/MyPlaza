import { useEffect, useRef } from 'react';
import { Game } from '../game/Game';
import { bindStoreToSocket } from '../net/bindStore';
import { createSocket } from '../net/socket';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { listMics, loadMicPreference, probeMic } from '../voice/mic';
import type { VoiceRoom } from '../voice/VoiceRoom';
import { Chat } from './Chat';
import { Hud } from './Hud';
import { MediaControls } from './MediaControls';
import { Notices } from './Notices';
import { ScreenShareView } from './ScreenShareView';
import { SharingIndicator } from './SharingIndicator';
import { ZoomControls } from './ZoomControls';

export function GameView() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const { selfName, selfColor, selfScenario, selfCharacter } = useStore.getState();
    const socket = createSocket();
    runtime.socket = socket;
    const unbindStore = bindStoreToSocket(socket);

    let cancelled = false;
    let game: Game | null = null;
    let voice: VoiceRoom | null = null;
    let onConnect: (() => void) | null = null;
    let onDisconnect: ((reason: string) => void) | null = null;

    void (async () => {
      // permissão de mic no gesto do usuário (o clique em "Entrar"), e antes de
      // listar dispositivos — sem permissão os labels vêm vazios
      const micDeviceId = loadMicPreference();
      const micAvailable = await probeMic(micDeviceId ?? undefined);
      if (cancelled) return;
      const store = useStore.getState();
      store.setMicAvailable(micAvailable);
      store.setMicEnabled(micAvailable);
      store.setActiveMicId(micDeviceId);

      if (micAvailable) {
        const devices = await listMics();
        if (cancelled) return;
        useStore.getState().setMicDevices(devices);
      }

      game = await Game.create(
        container,
        socket,
        selfName,
        selfColor,
        selfScenario,
        selfCharacter,
      );
      if (cancelled) {
        game.destroy();
        game = null;
        return;
      }
      runtime.game = game;

      // import dinâmico: o livekit-client fica num chunk próprio, buscado em
      // paralelo com os assets do Pixi e nunca baixado se a voz não configurar
      const { VoiceRoom } = await import('../voice/VoiceRoom');
      if (cancelled) return;
      voice = new VoiceRoom(socket, () => game!.getAudioInfo(), { micAvailable, micDeviceId });
      runtime.voice = voice;

      // handlers explícitos e removíveis: a ordem importa (o token exige que o
      // join já tenha rodado) e o handler antigo nunca era removido no cleanup
      onConnect = () => {
        socket.emit('join', selfName, selfColor, selfScenario, selfCharacter);
        // a reconexão cria um player novo no servidor, sempre presente. Se o
        // usuário está ausente, reafirma — senão ele volta a aparecer
        // disponível para os outros enquanto continua mudo de fato.
        if (useStore.getState().away) socket.emit('away', true);
        // socket novo = chance nova: zera o backoff antes de tentar
        voice?.onSocketReconnected();
        void voice?.onSocketConnected();
      };
      onDisconnect = (reason: string) => voice?.onSocketDisconnected(reason);
      socket.on('connect', onConnect);
      socket.on('disconnect', onDisconnect);
      socket.connect();
    })();

    return () => {
      cancelled = true;
      if (onConnect) socket.off('connect', onConnect);
      if (onDisconnect) socket.off('disconnect', onDisconnect);
      voice?.destroy(); // invalida awaits em vôo e solta o microfone
      game?.destroy();
      unbindStore();
      socket.disconnect();
      runtime.socket = null;
      runtime.game = null;
      runtime.voice = null;
    };
  }, []);

  return (
    <div className="game-view">
      <div ref={containerRef} className="canvas-host" />
      <Hud />
      <ScreenShareView />
      <Chat />
      <Notices />
      <MediaControls />
      <ZoomControls />
      <SharingIndicator />
    </div>
  );
}
