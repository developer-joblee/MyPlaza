import { useCallback } from 'react';
import { useStore } from '../state/store';

function ScreenVideo({ stream }: { stream: MediaStream }) {
  const ref = useCallback(
    (el: HTMLVideoElement | null) => {
      if (el && el.srcObject !== stream) el.srcObject = stream;
    },
    [stream],
  );
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
            <ScreenVideo stream={screen.stream} />
            <span className="screen-label">🖥️ {nameOf(screen.peerId)}</span>
          </button>
        ))}
      </div>
      {focused && (
        <div className="screen-focus" onClick={() => setFocused(null)}>
          <ScreenVideo stream={focused.stream} />
          <span className="screen-label">
            Tela de {nameOf(focused.peerId)} — clique para fechar
          </span>
        </div>
      )}
    </>
  );
}
