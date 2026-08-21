import { useState } from 'react';
import { NUDGE_MAX_NAMES } from '@together/shared';
import { setAway } from '../presence';
import { runtime } from '../runtime';
import { useStore, type Nudge } from '../state/store';
import { BellIcon, SpeakerIcon, WarningIcon } from './icons';
import { formatTime } from './util';

/**
 * "Ana está te chamando · 14:32" / "Ana, Bruno e +2 estão te chamando · 14:32".
 * A hora é do chamado mais recente, e existe porque o aviso não expira: quem
 * está ausente pode voltar muito depois, e sem a hora o aviso mentiria sobre
 * quando aquilo aconteceu.
 */
function callersLabel(nudges: Nudge[]): string {
  const recent = [...nudges].sort((a, b) => b.at - a.at);
  const shown = recent.slice(0, NUDGE_MAX_NAMES).map((n) => n.name);
  const rest = recent.length - shown.length;
  const who =
    rest > 0
      ? `${shown.join(', ')} e +${rest}`
      : shown.length > 1
        ? `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`
        : shown[0];
  const verbo = recent.length > 1 ? 'estão te chamando' : 'está te chamando';
  return `${who} ${verbo} · ${formatTime(recent[0]!.at)}`;
}

/**
 * Pilha única de avisos. Antes o `.mic-warning` era posicionado em
 * `top:16px; left:50%` com um call site só — dois avisos simultâneos
 * (mic indisponível + reconectando) se sobreporiam no mesmo ponto.
 *
 * Semântica de cor: mint = faça isso (a trava de autoplay e o chamado de quem
 * está ausente são CTAs), amber = degradado mas rodando, coral = quebrado,
 * neutro = informativo.
 */
export function Notices() {
  const micAvailable = useStore((s) => s.micAvailable);
  const voiceStatus = useStore((s) => s.voiceStatus);
  const audioBlocked = useStore((s) => s.audioBlocked);
  const away = useStore((s) => s.away);
  const nudges = useStore((s) => s.nudges);
  const clearNudges = useStore((s) => s.clearNudges);
  const [dismissedUnavailable, setDismissed] = useState(false);

  return (
    <div className="notice-stack" role="status" aria-live="polite">
      {/*
        Primeiro da pilha de propósito: para quem está ausente, este é o único
        aviso que explica por que valia a pena olhar a tela. `away` entra na
        condição porque voltar zera a lista — sem ele, um chamado que chegasse
        no mesmo instante da volta ficaria pendurado.
      */}
      {away && nudges.length > 0 && (
        <div className="notice nudge">
          <BellIcon />
          <span>{callersLabel(nudges)}</span>
          <button type="button" className="notice-action" onClick={() => setAway(false)}>
            Voltar
          </button>
          <button
            type="button"
            className="notice-dismiss"
            onClick={clearNudges}
            aria-label="Dispensar chamado"
          >
            ×
          </button>
        </div>
      )}

      {audioBlocked && (
        <button type="button" className="notice cta" onClick={() => void runtime.voice?.startAudio()}>
          <SpeakerIcon />
          Clique para ativar o áudio
        </button>
      )}

      {voiceStatus === 'reconnecting' && (
        <div className="notice warn">
          <WarningIcon />
          Reconectando à voz…
        </div>
      )}

      {voiceStatus === 'error' && (
        <div className="notice error">
          <WarningIcon />
          Voz desconectada
        </div>
      )}

      {voiceStatus === 'unavailable' && !dismissedUnavailable && (
        <div className="notice info">
          Voz não configurada neste servidor — chat e movimento funcionam
          <button
            type="button"
            className="notice-dismiss"
            onClick={() => setDismissed(true)}
            aria-label="Dispensar aviso"
          >
            ×
          </button>
        </div>
      )}

      {!micAvailable && voiceStatus !== 'unavailable' && (
        <div className="notice error">
          <WarningIcon />
          Microfone indisponível — você entra só ouvindo
        </div>
      )}
    </div>
  );
}
