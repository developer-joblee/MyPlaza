import { useState } from 'react';
import { AVATAR_COLORS, NAME_MAX_LENGTH } from '@together/shared';
import { useStore } from '../state/store';
import { colorToCss } from './util';

export function JoinScreen() {
  const join = useStore((s) => s.join);
  const [name, setName] = useState('');
  const [color, setColor] = useState<number>(
    AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  );

  const canJoin = name.trim().length > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canJoin) join(name.trim(), color);
  };

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={submit}>
        <h1 className="join-logo">
          t<span className="accent">o</span>Gether
        </h1>
        <p className="join-tagline">o escritório virtual da equipe</p>

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

        <button className="join-button" type="submit" disabled={!canJoin}>
          Entrar no escritório
        </button>

        <p className="join-hint">
          Ande com <strong>WASD</strong> ou setas. Chegue perto de alguém para conversar por voz.
        </p>
      </form>
    </div>
  );
}
