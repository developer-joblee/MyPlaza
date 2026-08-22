import { useEffect, useRef, useState } from 'react';
import {
  BODY_IDS,
  CHARACTERS,
  EYES_IDS,
  HAIR_IDS,
  LEGACY_CHARACTER_APPEARANCE,
  OUTFIT_IDS,
  randomAppearance,
  type Appearance,
} from '@together/shared';
import { GENERATOR_DEF } from '../game/characterDefs';
import { composeAppearance, loadCuratedLayers } from '../game/composeCharacter';

/**
 * O montador de aparência da tela de entrada: um preview ANIMADO (ciclo de
 * andar de frente) e uma linha de setas por camada.
 *
 * O preview é canvas 2D com o MESMO compositor do jogo (`composeCharacter.ts`,
 * zero Pixi) — o que se vê aqui é pixel a pixel o que os outros vão ver no
 * mapa, sem carregar o renderizador na tela de entrada.
 */

interface Props {
  value: Appearance;
  onChange: (a: Appearance) => void;
}

/** As camadas editáveis, na ordem de leitura da UI. */
const ROWS: Array<{
  label: string;
  options: readonly (string | null)[];
  get: (a: Appearance) => string | null;
  set: (a: Appearance, v: string | null) => Appearance;
}> = [
  {
    label: 'Corpo',
    options: BODY_IDS,
    get: (a) => a.body,
    set: (a, v) => ({ ...a, body: v as Appearance['body'] }),
  },
  {
    label: 'Olhos',
    options: EYES_IDS,
    get: (a) => a.eyes,
    set: (a, v) => ({ ...a, eyes: v as Appearance['eyes'] }),
  },
  {
    label: 'Roupa',
    options: OUTFIT_IDS,
    get: (a) => a.outfit,
    set: (a, v) => ({ ...a, outfit: v as Appearance['outfit'] }),
  },
  {
    // null no fim do ciclo: depois do último estilo vem "sem cabelo"
    label: 'Cabelo',
    options: [...HAIR_IDS, null],
    get: (a) => a.hair,
    set: (a, v) => ({ ...a, hair: v as Appearance['hair'] }),
  },
];

const ZOOM = 4;
/** a arte ocupa y9..31 do quadro de 16x32; o corte tira o vazio da cabeça */
const ART_TOP = 8;
const ART_H = 32 - ART_TOP;

export function CharacterBuilder({ value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef(0);
  // a aparência atual num ref: o intervalo de animação lê daqui, sem reiniciar
  // (e sem resetar o passo da caminhada) a cada mudança de camada
  const valueRef = useRef(value);
  valueRef.current = value;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let on = true;
    void loadCuratedLayers().then(() => {
      if (on) setReady(true);
    });
    return () => {
      on = false;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const draw = (): void => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const def = GENERATOR_DEF;
      const slice = def.walk.down;
      const col = slice.cols[frameRef.current % slice.cols.length];
      const sheet = composeAppearance(valueRef.current);
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(
        sheet,
        col * def.frameW,
        slice.row * def.frameH + ART_TOP,
        def.frameW,
        ART_H,
        0,
        0,
        def.frameW * ZOOM,
        ART_H * ZOOM,
      );
      frameRef.current++;
    };
    draw();
    const iv = setInterval(draw, GENERATOR_DEF.walkFrameS * 1000);
    return () => clearInterval(iv);
  }, [ready]);

  const cycle = (row: (typeof ROWS)[number], dir: 1 | -1): void => {
    const current = row.options.indexOf(row.get(value));
    const next = (current + dir + row.options.length) % row.options.length;
    onChange(row.set(value, row.options[next]));
  };

  return (
    <div className="builder">
      <div className="builder-preview" aria-hidden={!ready}>
        {ready ? (
          <canvas ref={canvasRef} width={16 * ZOOM} height={ART_H * ZOOM} />
        ) : (
          <span className="builder-loading">…</span>
        )}
      </div>

      <div className="builder-rows">
        {ROWS.map((row) => {
          const idx = row.options.indexOf(row.get(value));
          return (
            <div className="builder-row" key={row.label}>
              <span className="builder-row-label">{row.label}</span>
              <button
                type="button"
                className="builder-arrow"
                aria-label={`${row.label}: anterior`}
                onClick={() => cycle(row, -1)}
              >
                ‹
              </button>
              <span className="builder-count">
                {row.get(value) === null ? '—' : `${idx + 1}/${row.options.length}`}
              </span>
              <button
                type="button"
                className="builder-arrow"
                aria-label={`${row.label}: próximo`}
                onClick={() => cycle(row, 1)}
              >
                ›
              </button>
            </div>
          );
        })}
      </div>

      <div className="builder-actions">
        <button type="button" className="builder-chip" onClick={() => onChange(randomAppearance())}>
          🎲 Aleatório
        </button>
        {CHARACTERS.map((c) => (
          <button
            key={c.id}
            type="button"
            className="builder-chip"
            onClick={() => onChange(LEGACY_CHARACTER_APPEARANCE[c.id])}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
