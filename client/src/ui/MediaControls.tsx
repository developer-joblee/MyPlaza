import { useRef, useState } from 'react';
import { setAway } from '../presence';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { AudioSettings } from './AudioSettings';
import { SettingsMenu } from './SettingsMenu';
import { SoundboardPanel } from './SoundboardPanel';
import {
  AwayIcon,
  GearIcon,
  HeadphonesIcon,
  MicIcon,
  ScreenIcon,
  SlidersIcon,
  SoundboardIcon,
} from './icons';

export function MediaControls() {
  const micAvailable = useStore((s) => s.micAvailable);
  const micEnabled = useStore((s) => s.micEnabled);
  const deafened = useStore((s) => s.deafened);
  const away = useStore((s) => s.away);
  const sharing = useStore((s) => s.sharing);
  const voiceStatus = useStore((s) => s.voiceStatus);
  const speaking = useStore((s) => s.speaking);
  const selfId = useStore((s) => s.selfId);

  const soundboardMuted = useStore((s) => s.soundboardMuted);
  const authEmail = useStore((s) => s.authEmail);

  // visibilidade de painel é estado local (o Chat já faz assim), não da store
  const [open, setOpen] = useState(false);
  const [boardOpen, setBoardOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const boardTriggerRef = useRef<HTMLButtonElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);

  const voiceOff = voiceStatus === 'unavailable';
  // ausente conta como mic desligado no ícone: é o que está acontecendo de fato
  const micOff = !micAvailable || !micEnabled || deafened || away;
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
  const closeBoard = () => {
    setBoardOpen(false);
    boardTriggerRef.current?.focus();
  };
  const closeMenu = () => {
    setMenuOpen(false);
    menuTriggerRef.current?.focus();
  };
  /**
   * Sem conta não há soundboard: o tempo acumulado e o arquivo no Storage
   * pendem do perfil, e o modo anônimo não tem perfil. Desabilitar com título
   * explicativo é melhor que esconder — escondido, a feature parece não existir.
   */
  const boardAvailable = Boolean(authEmail);
  const boardTitle = boardAvailable
    ? soundboardMuted
      ? 'Soundboard (sons de outras pessoas silenciados)'
      : 'Soundboard'
    : 'O soundboard precisa de conta (este servidor está em modo anônimo)';

  const micTitle = away
    ? 'Você está ausente — volte para usar o microfone'
    : deafened
      ? 'Ativar microfone (sai do modo surdo)'
      : micEnabled
        ? 'Desativar microfone'
        : 'Ativar microfone';

  const awayTitle = away ? 'Voltar (reativa microfone e áudio)' : 'Ficar ausente';

  return (
    <>
      {open && <AudioSettings onClose={close} />}
      {boardOpen && <SoundboardPanel onClose={closeBoard} />}
      {menuOpen && <SettingsMenu onClose={closeMenu} />}
      <div className="panel media-controls">
        <button
          type="button"
          className={`media-btn${micOff && micAvailable ? ' off' : ''}${talking ? ' talking' : ''}`}
          onClick={toggleMic}
          disabled={!micAvailable || voiceOff || away}
          aria-label={micTitle}
          aria-pressed={!micOff}
          title={micTitle}
        >
          <MicIcon off={micOff} />
        </button>

        <button
          type="button"
          className={`media-btn${deafened || away ? ' off' : ''}`}
          onClick={toggleDeafen}
          disabled={voiceOff || away}
          aria-label={deafened ? 'Voltar a ouvir todos' : 'Silenciar todos'}
          aria-pressed={deafened}
          title={deafened ? 'Voltar a ouvir todos' : 'Silenciar todos'}
        >
          <HeadphonesIcon off={deafened} />
        </button>

        {/*
          Ausente é uma camada por cima de mic e fone: não altera a preferência
          de nenhum dos dois, só silencia enquanto está ligado. Por isso os dois
          botões ficam desabilitados aqui — mexer neles estando ausente daria a
          impressão de que mudou algo que não mudou.
        */}
        <button
          type="button"
          className={`media-btn${away ? ' away' : ''}`}
          onClick={() => setAway(!away)}
          aria-label={awayTitle}
          aria-pressed={away}
          title={awayTitle}
        >
          <AwayIcon />
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

        <button
          ref={boardTriggerRef}
          type="button"
          className={`media-btn${boardOpen ? ' open' : ''}${soundboardMuted ? ' off' : ''}`}
          onClick={() => setBoardOpen((v) => !v)}
          disabled={!boardAvailable}
          aria-label={boardTitle}
          aria-expanded={boardOpen}
          aria-haspopup="dialog"
          aria-controls="soundboard-popover"
          title={boardTitle}
        >
          <SoundboardIcon off={soundboardMuted} />
        </button>

        {/*
          A divisória isola a última posição dos controles que se alternam. Ela
          fica onde estava: o que mudou é que ali agora mora o menu que CONTÉM a
          ação destrutiva ("Finalizar chamada"), em vez da ação em si — sair
          deixou de ser um clique solto ao lado do botão de mutar.
        */}
        <span className="media-divider" aria-hidden="true" />

        <button
          ref={menuTriggerRef}
          type="button"
          className={`media-btn${menuOpen ? ' open' : ''}`}
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Configurações"
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          aria-controls="settings-popover"
          title="Configurações"
        >
          <GearIcon />
        </button>
      </div>
    </>
  );
}
