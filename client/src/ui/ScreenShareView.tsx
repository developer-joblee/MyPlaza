import { useEffect, useRef } from 'react';
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

export function ScreenShareView() {
  const screens = useStore((s) => s.remoteScreens);
  const roster = useStore((s) => s.roster);
  const focusedId = useStore((s) => s.focusedScreenId);
  const setFocused = useStore((s) => s.setFocusedScreen);

  if (screens.length === 0) return null;

  const nameOf = (peerId: string) =>
    roster.find((r) => r.id === peerId)?.name ?? 'Alguém';

  const focused = screens.find((s) => s.peerId === focusedId);

  return (
    <>
      <div className="screens">
        {screens.map((screen) => (
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
        <div className="screen-focus" onClick={() => setFocused(null)}>
          <ScreenVideo track={focused.track} />
          <span className="screen-label">
            Tela de {nameOf(focused.peerId)} — clique para fechar
          </span>
        </div>
      )}
    </>
  );
}
