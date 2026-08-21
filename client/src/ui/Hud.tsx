import { useEffect, useRef, useState } from 'react';
import { NUDGE_COOLDOWN_MS } from '@together/shared';
import { nudge } from '../presence';
import { useStore, type RosterEntry } from '../state/store';
import { colorToCss } from './util';

export function Hud() {
  const roster = useStore((s) => s.roster);
  const selfId = useStore((s) => s.selfId);
  const connected = useStore((s) => s.connected);
  const speaking = useStore((s) => s.speaking);
  const nearbyIds = useStore((s) => s.nearbyIds);
  const selfBooble = useStore((s) => s.selfBooble);
  const audioZone = useStore((s) => s.audioZone);
  const canSit = useStore((s) => s.canSit);

  /**
   * Quem eu chamei e ainda está no cooldown. É estado local (não da store):
   * ninguém fora deste painel precisa saber, e o limite de verdade é imposto no
   * servidor — isto aqui só evita o clique que não teria efeito.
   */
  const [called, setCalled] = useState<Record<string, true>>({});
  const timers = useRef<number[]>([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const call = (id: string) => {
    // `false` = socket caído: não marca como chamado, senão o botão mentiria
    if (!nudge(id)) return;
    setCalled((prev) => ({ ...prev, [id]: true }));
    timers.current.push(
      window.setTimeout(() => {
        setCalled(({ [id]: _done, ...rest }) => rest);
      }, NUDGE_COOLDOWN_MS),
    );
  };

  /**
   * Está na MINHA booble? A lista mostra isso como selo, e só isso: **abrir ou
   * entrar numa booble é ação do menu de contexto do boneco**
   * (`AvatarContextMenu`), não desta lista. Aqui ficou o status, que é o que uma
   * lista de pessoas faz bem — dizer de relance com quem você está.
   */
  const inMyBooble = (p: RosterEntry): boolean =>
    selfBooble !== null && p.boobleId === selfBooble;

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
          <li key={p.id} className={p.away ? 'ausente-li' : undefined}>
            <span
              className={`dot${speaking[p.id] ? ' speaking' : ''}`}
              style={{ background: colorToCss(p.color) }}
            />
            <span>{p.name}</span>
            {p.id === selfId && <span className="you">(você)</span>}
            {/* ausente ganha do "voz": quem não está ali não conversa */}
            {p.away ? (
              <>
                <span className="ausente" title="Ausente: sem microfone e sem áudio">
                  ausente
                </span>
                {/*
                  Chamar só faz sentido para quem está ausente — quem está
                  presente ouve a sala ou lê o chat. Por isso o botão não existe
                  nas outras linhas, em vez de existir desabilitado.
                */}
                {p.id !== selfId && (
                  <button
                    type="button"
                    className="nudge-btn"
                    onClick={() => call(p.id)}
                    disabled={Boolean(called[p.id])}
                    title={
                      called[p.id]
                        ? `Você já chamou ${p.name} — espere um pouco`
                        : `Chamar ${p.name} (toca um aviso na tela dela)`
                    }
                  >
                    {called[p.id] ? 'chamado' : 'chamar'}
                  </button>
                )}
              </>
            ) : inMyBooble(p) ? (
              /*
                Precedência dos micro-badges: ausente > booble > voz. Só um deles
                pode carregar o `margin-left:auto`, então eles são exclusivos por
                construção, e a ordem é a da informação mais forte: quem não está
                ali não conversa; quem está na sua booble você ouve cheio; "voz" é
                o caso comum e por isso o último.
              */
              <span
                className="booble"
                title="Na sua booble: vocês se ouvem a 100% e o resto da sala fica a 7%"
              >
                booble
              </span>
            ) : p.id !== selfId && nearbyIds.includes(p.id) ? (
              <span className="near">voz</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
