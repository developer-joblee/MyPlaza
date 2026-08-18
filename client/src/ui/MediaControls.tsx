import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { setMicEnabled } from '../webrtc/media';

function MicIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {off && <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" />}
    </svg>
  );
}

function ScreenIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <path d="M9 11l3-3 3 3" />
      <line x1="12" y1="8.5" x2="12" y2="14" />
    </svg>
  );
}

export function MediaControls() {
  const micAvailable = useStore((s) => s.micAvailable);
  const micEnabled = useStore((s) => s.micEnabled);
  const sharing = useStore((s) => s.sharing);

  const toggleMic = () => {
    const next = !micEnabled;
    setMicEnabled(next);
    useStore.getState().setMicEnabled(next);
  };

  const toggleShare = () => {
    if (sharing) {
      runtime.peerManager?.stopScreenShare();
    } else {
      void runtime.peerManager?.startScreenShare();
    }
  };

  return (
    <>
      {!micAvailable && (
        <div className="mic-warning">Microfone indisponível — você entra só ouvindo</div>
      )}
      <div className="panel media-controls">
        <button
          type="button"
          className={`media-btn${micAvailable && !micEnabled ? ' off' : ''}`}
          onClick={toggleMic}
          disabled={!micAvailable}
          title={micEnabled ? 'Desativar microfone' : 'Ativar microfone'}
        >
          <MicIcon off={!micEnabled || !micAvailable} />
        </button>
        <button
          type="button"
          className={`media-btn${sharing ? ' active' : ''}`}
          onClick={toggleShare}
          title={sharing ? 'Parar de compartilhar tela' : 'Compartilhar tela'}
        >
          <ScreenIcon />
        </button>
      </div>
    </>
  );
}
