import { useState } from 'react';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { SpeakerIcon, WarningIcon } from './icons';

/**
 * Pilha única de avisos. Antes o `.mic-warning` era posicionado em
 * `top:16px; left:50%` com um call site só — dois avisos simultâneos
 * (mic indisponível + reconectando) se sobreporiam no mesmo ponto.
 *
 * Semântica de cor: mint = faça isso (a trava de autoplay é uma CTA),
 * amber = degradado mas rodando, coral = quebrado, neutro = informativo.
 */
export function Notices() {
  const micAvailable = useStore((s) => s.micAvailable);
  const voiceStatus = useStore((s) => s.voiceStatus);
  const audioBlocked = useStore((s) => s.audioBlocked);
  const [dismissedUnavailable, setDismissed] = useState(false);

  return (
    <div className="notice-stack" role="status" aria-live="polite">
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
