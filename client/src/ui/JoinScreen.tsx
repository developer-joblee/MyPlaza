import { useState } from 'react';
import {
  AVATAR_COLORS,
  CHARACTERS,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  SCENARIOS,
  type CharacterId,
  type ScenarioId,
} from '@together/shared';
import { characterPreview } from '../game/characterDefs';
import { useStore } from '../state/store';
import { colorToCss } from './util';

/**
 * Miniatura do personagem, recortada direto da spritesheet. É CSS puro em vez
 * de canvas para não depender de o PixiJS ter carregado: um div do tamanho do
 * quadro, posicionado no recorte certo, ampliado com `transform: scale`.
 */
function CharacterSprite({ id }: { id: CharacterId }) {
  const { sheet, x, y, w, h, zoom } = characterPreview(id);
  return (
    // a altura da caixa é fixa no CSS, para os cinco cartões ficarem alinhados
    // mesmo com os personagens tendo alturas de arte diferentes
    <span className="char-frame" style={{ width: w * zoom }}>
      <span
        className="char-sprite"
        style={{
          width: w,
          height: h,
          backgroundImage: `url(${sheet})`,
          backgroundPosition: `-${x}px -${y}px`,
          transform: `scale(${zoom})`,
        }}
      />
    </span>
  );
}

const SCENARIO_EMOJI: Record<ScenarioId, string> = {
  office: '🏢',
  plaza: '🌳',
  ruins: '🏛️',
  studio: '🛋️',
};

export function JoinScreen() {
  const join = useStore((s) => s.join);
  // quem acabou de sair volta com nome, cor e cenário já preenchidos
  const [name, setName] = useState(() => useStore.getState().selfName);
  const [color, setColor] = useState<number>(
    () =>
      useStore.getState().selfName
        ? useStore.getState().selfColor
        : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  );
  const [scenario, setScenario] = useState<ScenarioId>(
    () => useStore.getState().selfScenario ?? DEFAULT_SCENARIO,
  );
  const [character, setCharacter] = useState<CharacterId>(
    () => useStore.getState().selfCharacter,
  );

  const canJoin = name.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canJoin) join(name.trim(), color, scenario, character);
  };

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={submit}>
        <h1 className="join-logo">
          t<span className="accent">o</span>Gether
        </h1>
        <p className="join-tagline">o espaço virtual da equipe</p>

        <div className="join-fields">
          <label className="join-label" htmlFor="name">
            Seu nome
          </label>
          <input
            id="name"
            className="join-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            placeholder="Como a equipe te chama?"
            autoFocus
            autoComplete="off"
          />
        </div>

        <span className="join-label">Personagem</span>
        <div className="character-row">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`character-card${c.id === character ? ' selected' : ''}`}
              onClick={() => setCharacter(c.id)}
              aria-pressed={c.id === character}
            >
              <CharacterSprite id={c.id} />
              <span className="character-name">{c.label}</span>
            </button>
          ))}
        </div>

        <span className="join-label">Sua cor (nome e lista)</span>
        <div className="color-row">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${c === color ? ' selected' : ''}`}
              style={{ background: colorToCss(c) }}
              onClick={() => setColor(c)}
              aria-label={`Cor ${colorToCss(c)}`}
            />
          ))}
        </div>

        <span className="join-label">Cenário</span>
        <div className="scenario-row">
          {Object.values(SCENARIOS).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`scenario-card${s.id === scenario ? ' selected' : ''}`}
              onClick={() => setScenario(s.id)}
            >
              <span className="scenario-emoji">{SCENARIO_EMOJI[s.id]}</span>
              <span className="scenario-name">{s.label}</span>
              <span className="scenario-desc">{s.description}</span>
            </button>
          ))}
        </div>

        <button className="join-button" type="submit" disabled={!canJoin}>
          Entrar
        </button>

        <p className="join-hint">
          Ande com <strong>WASD</strong> ou setas. Chegue perto de alguém para conversar por voz.
        </p>
      </form>
    </div>
  );
}
