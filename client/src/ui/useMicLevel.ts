import { useEffect, type RefObject } from 'react';
import { runtime } from '../runtime';

/** Sobe rápido para uma palavra registrar, desce devagar para dar de ler. */
const ATTACK = 0.5;
const DECAY = 0.08;

/**
 * Escreve o nível do microfone direto numa custom property do elemento.
 *
 * De propósito fora do React: 60 atualizações por segundo passando por state
 * re-renderizaria a lista de dispositivos inteira a cada frame. O rAF só roda
 * enquanto `active` (o painel aberto), então fechado não custa nada.
 */
export function useMicLevel(ref: RefObject<HTMLElement | null>, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let level = 0;

    const step = () => {
      const target = runtime.voice?.getMicLevel() ?? 0;
      const k = target > level ? ATTACK : DECAY;
      level += (target - level) * k;
      // curva perceptual: sqrt aproxima melhor o que o ouvido julga "alto"
      ref.current?.style.setProperty('--level', Math.sqrt(level).toFixed(3));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(raf);
      ref.current?.style.setProperty('--level', '0');
    };
  }, [ref, active]);
}
