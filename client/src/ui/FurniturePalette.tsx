import { useEffect, useRef, useState } from 'react';
import { FURNITURE_CATALOG, type FurnitureId } from '@together/shared';
import { FURNITURE_VARIANTS } from '../game/furnitureArt';
import { useStore } from '../state/store';

/**
 * A paleta do modo de edição de móveis. Aparece enquanto `furnitureEditing`
 * (ligado pelo menu de configurações, só para quem pode editar).
 *
 * Os ícones são recortados do PRÓPRIO atlas do jogo
 * (`/tiles/modern/furniture.{png,json}`), desenhados em canvas — o que se
 * escolhe aqui é pixel a pixel o que vai para o mapa, sem asset paralelo.
 * Quem executa os cliques no mundo é o `Game` (ghost, colocar, mover,
 * remover); a paleta só decide O QUE está na mão (`furniturePick`).
 */

interface AtlasFrame {
  frame: { x: number; y: number; w: number; h: number };
}

export function FurniturePalette() {
  const pick = useStore((s) => s.furniturePick);
  const setPick = useStore((s) => s.setFurniturePick);
  const setEditing = useStore((s) => s.setFurnitureEditing);
  const [atlas, setAtlas] = useState<{ img: HTMLImageElement; frames: Record<string, AtlasFrame> } | null>(null);

  useEffect(() => {
    let on = true;
    void (async () => {
      const res = await fetch('/tiles/modern/furniture.json');
      const json = (await res.json()) as { frames: Record<string, AtlasFrame> };
      const img = new Image();
      img.src = '/tiles/modern/furniture.png';
      await img.decode();
      if (on) setAtlas({ img, frames: json.frames });
    })();
    return () => {
      on = false;
    };
  }, []);

  return (
    <div className="panel furniture-palette" role="dialog" aria-label="Editar móveis">
      <div className="furniture-palette-head">Editar móveis</div>
      <div className="furniture-grid">
        {FURNITURE_CATALOG.map((def) => (
          <button
            key={def.id}
            type="button"
            className={`furniture-item${pick === def.id ? ' selected' : ''}`}
            title={def.label}
            aria-pressed={pick === def.id}
            onClick={() => setPick(pick === def.id ? null : (def.id as FurnitureId))}
          >
            <FurnitureIcon id={def.id as FurnitureId} atlas={atlas} />
            <span className="furniture-item-label">{def.label}</span>
          </button>
        ))}
      </div>
      <p className="furniture-hint">
        Escolha um item e clique no chão para colocar; <strong>R</strong> alterna
        a variante. Clique num móvel para movê-lo; botão direito remove (ou
        larga o que está na mão). Móveis colocados bloqueiam a passagem.
      </p>
      <button className="furniture-done" type="button" onClick={() => setEditing(false)}>
        Concluir
      </button>
    </div>
  );
}

const ICON = 44;

function FurnitureIcon({
  id,
  atlas,
}: {
  id: FurnitureId;
  atlas: { img: HTMLImageElement; frames: Record<string, AtlasFrame> } | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    const frame = atlas?.frames[FURNITURE_VARIANTS[id][0]]?.frame;
    if (!canvas || !ctx || !atlas || !frame) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ICON, ICON);
    // cabe inteiro na caixa: amplia em passos inteiros (pixel art), reduz livre
    const fit = Math.min(ICON / frame.w, ICON / frame.h);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    const w = frame.w * scale;
    const h = frame.h * scale;
    ctx.drawImage(atlas.img, frame.x, frame.y, frame.w, frame.h, (ICON - w) / 2, ICON - h, w, h);
  }, [id, atlas]);

  return <canvas ref={ref} width={ICON} height={ICON} className="furniture-icon" aria-hidden="true" />;
}
