import { useStore } from '../state/store';
import { ExitIcon } from './icons';
import { colorToCss } from './util';

export function Hud() {
  const roster = useStore((s) => s.roster);
  const selfId = useStore((s) => s.selfId);
  const connected = useStore((s) => s.connected);
  const speaking = useStore((s) => s.speaking);
  const nearbyIds = useStore((s) => s.nearbyIds);
  const leave = useStore((s) => s.leave);

  const sorted = [...roster].sort((a, b) =>
    a.id === selfId ? -1 : b.id === selfId ? 1 : a.name.localeCompare(b.name),
  );

  return (
    <div className="panel hud">
      <h2 className="hud-title">
        <span>
          t<span className="accent">o</span>Gether
        </span>
        <span
          className={`conn-dot${connected ? ' on' : ''}`}
          title={connected ? 'Conectado' : 'Desconectado'}
        />
        <button
          type="button"
          className="hud-exit"
          onClick={leave}
          aria-label="Sair e voltar para a tela inicial"
          title="Sair"
        >
          <ExitIcon />
        </button>
      </h2>
      <ul className="roster">
        {sorted.map((p) => (
          <li key={p.id}>
            <span
              className={`dot${speaking[p.id] ? ' speaking' : ''}`}
              style={{ background: colorToCss(p.color) }}
            />
            <span>{p.name}</span>
            {p.id === selfId && <span className="you">(você)</span>}
            {p.id !== selfId && nearbyIds.includes(p.id) && (
              <span className="near">voz</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
