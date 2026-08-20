import { useCallback, useEffect, useRef, useState } from 'react';
import type { RemoteVideoTrack } from 'livekit-client';
import { useStore } from '../state/store';

/**
 * Usa `track.attach(el)` em vez de montar um MediaStream à mão: com
 * `adaptiveStream` o SDK decide se encaminha o vídeo observando os elementos
 * anexados. Sem anexar, ele conclui que a faixa está invisível e o servidor
 * para de enviar — tela preta. Precisa ser ref + effect porque ref callback
 * no React 18 não tem função de cleanup para chamar o `detach`.
 */
function ScreenVideo({ track }: { track: RemoteVideoTrack }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);

  return <video ref={ref} autoPlay playsInline muted />;
}

/**
 * Tela ampliada. Ocupa a viewport inteira (`.screen-focus` é fixed) e o vídeo
 * é esticado por CSS com `object-fit: contain` — só `max-width/max-height`
 * deixava o vídeo no tamanho intrínseco da camada recebida, que com
 * `adaptiveStream` pode ser 360p e aparecia como uma janelinha no meio da tela.
 *
 * O botão ⛶ pede fullscreen nativo (esconde a barra do browser); o Esc fecha,
 * mas quando estamos em fullscreen nativo o browser consome o Esc para sair
 * dele primeiro — daí o guard no handler.
 */
function ScreenFocus({ track, name, onClose }: {
  track: RemoteVideoTrack;
  name: string;
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [nativeFs, setNativeFs] = useState(false);

  const toggleNativeFs = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void hostRef.current?.requestFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onFsChange = () => setNativeFs(document.fullscreenElement === hostRef.current);
    document.addEventListener('fullscreenchange', onFsChange);

    const onKey = (e: KeyboardEvent) => {
      // deixa o Esc para o browser quando ele ainda tem fullscreen para desfazer
      if (e.key === 'Escape' && !document.fullscreenElement) onClose();
      if (e.key === 'f' || e.key === 'F') toggleNativeFs();
    };
    window.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      window.removeEventListener('keydown', onKey);
      // fechar a visão não pode deixar a página presa em fullscreen
      if (document.fullscreenElement === hostRef.current) void document.exitFullscreen();
    };
  }, [onClose, toggleNativeFs]);

  return (
    <div className="screen-focus" ref={hostRef}>
      <ScreenVideo track={track} />
      <div className="screen-focus-bar">
        <span className="screen-focus-name">🖥️ Tela de {name}</span>
        <button
          type="button"
          className="screen-focus-btn"
          onClick={toggleNativeFs}
          title={nativeFs ? 'Sair do fullscreen (F)' : 'Fullscreen (F)'}
        >
          {nativeFs ? '🗗' : '⛶'}
        </button>
        <button
          type="button"
          className="screen-focus-btn screen-focus-close"
          onClick={onClose}
          title="Fechar a visualização (Esc)"
        >
          ✕ Sair
        </button>
      </div>
    </div>
  );
}

export function ScreenShareView() {
  const screens = useStore((s) => s.remoteScreens);
  const roster = useStore((s) => s.roster);
  const focusedId = useStore((s) => s.focusedScreenId);
  const setFocused = useStore((s) => s.setFocusedScreen);

  const close = useCallback(() => setFocused(null), [setFocused]);

  if (screens.length === 0) return null;

  const nameOf = (peerId: string) =>
    roster.find((r) => r.id === peerId)?.name ?? 'Alguém';

  const focused = screens.find((s) => s.peerId === focusedId);

  return (
    <>
      <div className="screens">
        {screens
          // o tile da tela ampliada sai de cena: com dois elementos anexados o
          // adaptiveStream mira o maior, mas manter só o grande é o que garante
          // que a camada pedida seja a de resolução cheia
          .filter((screen) => screen.peerId !== focused?.peerId)
          .map((screen) => (
            <button
              key={screen.peerId}
              type="button"
              className="screen-tile"
              onClick={() => setFocused(screen.peerId)}
              title="Ampliar"
            >
              <ScreenVideo track={screen.track} />
              <span className="screen-label">🖥️ {nameOf(screen.peerId)}</span>
            </button>
          ))}
      </div>
      {focused && (
        <ScreenFocus
          key={focused.peerId}
          track={focused.track}
          name={nameOf(focused.peerId)}
          onClose={close}
        />
      )}
    </>
  );
}
