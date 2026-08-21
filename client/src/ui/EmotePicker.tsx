import { useEffect, useRef, useState } from 'react';
import { EMOTES, EMOTE_COOLDOWN_MS, type EmoteId } from '@together/shared';
import { runtime } from '../runtime';

/**
 * O seletor de reações: uma grade de 6 botões, um por emote do catálogo. O
 * ícone de cada botão é o quadro final da própria tira
 * (`/emotes/{id}.png`, 8 quadros de 32px — o ícone é o 7º, x = -192px), via
 * background-position: o seletor mostra exatamente o que vai aparecer sobre a
 * cabeça, sem asset separado.
 *
 * Clicar dispara e FECHA: reação é um gesto, não um painel em que se fica. O
 * cooldown (o mesmo que o servidor impõe) desabilita a grade inteira por
 * `EMOTE_COOLDOWN_MS` — por conforto; o limite de verdade é o servidor.
 */
export function EmotePicker({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [coolingUntil, setCoolingUntil] = useState(0);
  const [, force] = useState(0);

  // popover não-modal: fecha em Escape e clique fora (padrão do AudioSettings)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // captura para fechar antes de o canvas engolir o evento
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const cooling = Date.now() < coolingUntil;

  // reabilita a grade quando o cooldown vence (o painel pode continuar aberto)
  useEffect(() => {
    if (!cooling) return;
    const t = setTimeout(() => force((n) => n + 1), coolingUntil - Date.now());
    return () => clearTimeout(t);
  }, [cooling, coolingUntil]);

  const send = (id: EmoteId) => {
    if (Date.now() < coolingUntil) return;
    if (runtime.api?.emote(id)) setCoolingUntil(Date.now() + EMOTE_COOLDOWN_MS);
    onClose();
  };

  return (
    <div id="emote-popover" className="panel emote-popover" role="dialog" ref={panelRef}>
      <div className="emote-grid">
        {EMOTES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            className="emote-btn"
            onClick={() => send(id)}
            disabled={cooling}
            aria-label={label}
            title={label}
          >
            <span
              className="emote-btn-art"
              style={{ backgroundImage: `url(/emotes/${id}.png)` }}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
