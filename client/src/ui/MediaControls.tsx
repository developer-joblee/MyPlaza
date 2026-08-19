import { runtime } from '../runtime';
import { useStore } from '../state/store';

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

function HeadphonesIcon({ off }: { off?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="2" y="14" width="5" height="7" rx="2.5" />
      <rect x="17" y="14" width="5" height="7" rx="2.5" />
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
  const deafened = useStore((s) => s.deafened);
  const sharing = useStore((s) => s.sharing);
  const voiceStatus = useStore((s) => s.voiceStatus);
  const audioBlocked = useStore((s) => s.audioBlocked);

  const voiceOff = voiceStatus === 'unavailable';
  const micOff = !micAvailable || !micEnabled || deafened;

  const toggleMic = () => runtime.voice?.setMicEnabled(!micEnabled);
  const toggleDeafen = () => runtime.voice?.setDeafened(!deafened);

  const toggleShare = () => {
    if (sharing) runtime.voice?.stopScreenShare();
    else void runtime.voice?.startScreenShare();
  };

  return (
    <>
      {audioBlocked && (
        <button type="button" className="mic-warning" onClick={() => void runtime.voice?.startAudio()}>
          🔊 Clique para ativar o áudio
        </button>
      )}
      {!audioBlocked && voiceOff && (
        <div className="mic-warning">Voz não configurada neste servidor — chat e movimento funcionam</div>
      )}
      {!audioBlocked && !voiceOff && !micAvailable && (
        <div className="mic-warning">Microfone indisponível — você entra só ouvindo</div>
      )}
      <div className="panel media-controls">
        <button
          type="button"
          className={`media-btn${micOff && micAvailable ? ' off' : ''}`}
          onClick={toggleMic}
          disabled={!micAvailable || voiceOff}
          aria-label={micEnabled ? 'Desativar microfone' : 'Ativar microfone'}
          aria-pressed={!micOff}
          title={
            deafened
              ? 'Ativar microfone (sai do modo surdo)'
              : micEnabled
                ? 'Desativar microfone'
                : 'Ativar microfone'
          }
        >
          <MicIcon off={micOff} />
        </button>
        <button
          type="button"
          className={`media-btn${deafened ? ' off' : ''}`}
          onClick={toggleDeafen}
          disabled={voiceOff}
          aria-label={deafened ? 'Voltar a ouvir todos' : 'Silenciar todos'}
          aria-pressed={deafened}
          title={deafened ? 'Voltar a ouvir todos' : 'Silenciar todos'}
        >
          <HeadphonesIcon off={deafened} />
        </button>
        <button
          type="button"
          className={`media-btn${sharing ? ' active' : ''}`}
          onClick={toggleShare}
          disabled={voiceOff}
          aria-label={sharing ? 'Parar de compartilhar tela' : 'Compartilhar tela'}
          aria-pressed={sharing}
          title={sharing ? 'Parar de compartilhar tela' : 'Compartilhar tela'}
        >
          <ScreenIcon />
        </button>
      </div>
    </>
  );
}
