import { useEffect, useRef } from 'react';
import { Game } from '../game/Game';
import { bindStoreToSocket } from '../net/bindStore';
import { createSocket } from '../net/socket';
import { createSoundboardApi } from '../net/soundboardApi';
import { createWorldApi } from '../net/worldApi';
import { runtime } from '../runtime';
import { createSoundPlayer } from '../soundboard';
import { useStore } from '../state/store';
import { listMics, loadMicPreference, probeMic } from '../voice/mic';
import type { VoiceRoom } from '../voice/VoiceRoom';
import { AvatarContextMenu } from './AvatarContextMenu';
import { CallAlerts } from './CallAlerts';
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

    const { selfName, selfColor, selfScenario, selfCharacter, selfWorldId } =
      useStore.getState();
    const socket = createSocket();
    runtime.socket = socket;
    // a fronteira de requisição de quem está dentro de um mundo; o Chat e o
    // `presence.ts` chegam nela por aqui
    const api = createWorldApi(() => runtime.socket);
    runtime.api = api;
    // o soundboard tem fronteira própria (é outro conjunto de eventos) e um
    // player de áudio próprio, que não passa pelo LiveKit
    runtime.soundApi = createSoundboardApi(() => runtime.socket);
    const soundPlayer = createSoundPlayer();
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
      // entra MUDO, sempre: ter permissão de microfone não é querer transmitir.
      // O `false` explícito também limpa o `true` que um `leave()` antigo (ou um
      // HMR) pudesse ter deixado no store.
      store.setMicEnabled(false);
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
        api.join(selfName, selfColor, selfScenario, selfCharacter, selfWorldId ?? undefined);
        // a reconexão cria um player novo no servidor, sempre presente. Se o
        // usuário está ausente, reafirma — senão ele volta a aparecer
        // disponível para os outros enquanto continua mudo de fato.
        if (useStore.getState().away) api.setAway(true);
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
      soundPlayer.destroy(); // corta som em vôo e fecha o AudioContext
      game?.destroy();
      unbindStore();
      socket.disconnect();
      runtime.socket = null;
      runtime.api = null;
      runtime.game = null;
      runtime.voice = null;
      runtime.soundApi = null;
      runtime.soundboard = null;
    };
  }, []);

  return (
    <div className="game-view">
      <div ref={containerRef} className="canvas-host" />
      <Hud />
      <Chat />
      <Notices />
      <MediaControls />
      {/*
        Uma coluna só para o canto superior direito. Antes o zoom e as prévias de
        tela eram ancorados os DOIS em `top:16 right:16` e se sobrepunham quando
        alguém compartilhava; empilhar resolve isso e abre lugar para o alerta de
        chamado. O zoom fica primeiro de propósito: é controle, e controle que se
        desloca quando chega um aviso é pior que aviso 44px mais abaixo.

        A tela AMPLIADA (`.screen-focus`) é `fixed; inset: 0`, então continua
        cobrindo a janela mesmo aninhada aqui — e por isso esta coluna não pode
        ganhar `z-index`: criar um contexto de empilhamento aqui prenderia a tela
        ampliada dentro dele.
      */}
      <div className="top-right-stack">
        <ZoomControls />
        <CallAlerts />
        <ScreenShareView />
      </div>
      <SharingIndicator />
      <AvatarContextMenu />
    </div>
  );
}
