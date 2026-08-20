import { useStore } from '../state/store';
import { colorToCss } from './util';

export function Hud() {
  const roster = useStore((s) => s.roster);
  const selfId = useStore((s) => s.selfId);
  const connected = useStore((s) => s.connected);
  const speaking = useStore((s) => s.speaking);
  const nearbyIds = useStore((s) => s.nearbyIds);
  const audioZone = useStore((s) => s.audioZone);
  const canSit = useStore((s) => s.canSit);

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
      </h2>
      {audioZone && (
        <div className="hud-zone" title="Só quem está nesta sala ouve o que se fala aqui">
          🔇 {audioZone}
        </div>
      )}
      {canSit && (
        <div className="hud-hint">
          <kbd>E</kbd> para sentar
        </div>
      )}
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
