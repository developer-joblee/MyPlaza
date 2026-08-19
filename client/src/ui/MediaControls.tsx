import { useRef, useState } from 'react';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { AudioSettings } from './AudioSettings';
import { HangupIcon, HeadphonesIcon, MicIcon, ScreenIcon, SlidersIcon } from './icons';

export function MediaControls() {
  const micAvailable = useStore((s) => s.micAvailable);
  const micEnabled = useStore((s) => s.micEnabled);
  const deafened = useStore((s) => s.deafened);
  const sharing = useStore((s) => s.sharing);
  const voiceStatus = useStore((s) => s.voiceStatus);
  const speaking = useStore((s) => s.speaking);
  const selfId = useStore((s) => s.selfId);
  const leave = useStore((s) => s.leave);

  // visibilidade de painel é estado local (o Chat já faz assim), não da store
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const voiceOff = voiceStatus === 'unavailable';
  const micOff = !micAvailable || !micEnabled || deafened;
  const talking = Boolean(selfId && speaking[selfId]) && !micOff;

  const toggleMic = () => runtime.voice?.setMicEnabled(!micEnabled);
  const toggleDeafen = () => runtime.voice?.setDeafened(!deafened);
  const toggleShare = () => {
    if (sharing) runtime.voice?.stopScreenShare();
    else void runtime.voice?.startScreenShare();
  };
  const close = () => {
    setOpen(false);
    triggerRef.current?.focus();
  };

  const micTitle = deafened
    ? 'Ativar microfone (sai do modo surdo)'
    : micEnabled
      ? 'Desativar microfone'
      : 'Ativar microfone';

  return (
    <>
      {open && <AudioSettings onClose={close} />}
      <div className="panel media-controls">
        <button
          type="button"
          className={`media-btn${micOff && micAvailable ? ' off' : ''}${talking ? ' talking' : ''}`}
          onClick={toggleMic}
          disabled={!micAvailable || voiceOff}
          aria-label={micTitle}
          aria-pressed={!micOff}
          title={micTitle}
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

        <button
          ref={triggerRef}
          type="button"
          className={`media-btn${open ? ' open' : ''}`}
          onClick={() => setOpen((v) => !v)}
          aria-label="Configurações de áudio"
          aria-expanded={open}
          aria-haspopup="dialog"
          aria-controls="audio-popover"
          title="Configurações de áudio"
        >
          <SlidersIcon />
          {voiceStatus === 'reconnecting' && <span className="media-btn-badge busy" aria-hidden="true" />}
          {voiceStatus === 'error' && <span className="media-btn-badge error" aria-hidden="true" />}
        </button>

        {/* a divisória isola a ação destrutiva dos controles que se alternam */}
        <span className="media-divider" aria-hidden="true" />

        <button
          type="button"
          className="media-btn danger"
          onClick={leave}
          aria-label="Sair e voltar para a tela inicial"
          title="Sair"
        >
          <HangupIcon />
        </button>
      </div>
    </>
  );
}
