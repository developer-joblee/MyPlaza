import { useEffect, useRef, useState } from 'react';
import { BOOBLE_MAX_MEMBERS, NUDGE_COOLDOWN_MS } from '@together/shared';
import { joinBooble } from '../booble';
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
  const boobleReachIds = useStore((s) => s.boobleReachIds);
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
   * Quanta gente há numa booble. Sai do roster porque o roster já é a lista
   * completa do mundo — contar aqui evita mandar o tamanho pela rede e evita a
   * janela em que o número enviado envelhece.
   */
  const boobleSize = (boobleId: string | null): number =>
    boobleId === null ? 0 : roster.filter((r) => r.boobleId === boobleId).length;

  const inMyBooble = (p: RosterEntry): boolean =>
    selfBooble !== null && p.boobleId === selfBooble;

  /**
   * Dá para entrar na booble desta pessoa? Booble que ela ainda não tem sempre
   * dá (nasce com dois). O teto é conferido de novo no servidor — esconder o
   * botão é conforto, não limite (mesma regra do "chamar").
   */
  const canJoinBooble = (p: RosterEntry): boolean =>
    p.boobleId === null || boobleSize(p.boobleId) < BOOBLE_MAX_MEMBERS;

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
            ) : p.id !== selfId && boobleReachIds.includes(p.id) ? (
              /*
                `boobleReachIds`, não `nearbyIds`: o alcance de abrir uma booble
                é 2 tiles, e o audível é 5. Com o predicado do áudio o botão
                apareceria para quem está longe demais, e o clique morreria numa
                recusa silenciosa do servidor.
              */
              canJoinBooble(p) ? (
                <button
                  type="button"
                  className="booble-btn"
                  onClick={() => joinBooble(p.id)}
                  title={
                    p.boobleId !== null
                      ? `Entrar na booble de ${p.name}` +
                        (selfBooble !== null ? ' (você sai da sua)' : '')
                      : `Abrir uma booble com ${p.name}: vocês se ouvem a 100% e o resto da sala a 7%`
                  }
                >
                  {p.boobleId !== null ? 'entrar' : 'booble'}
                </button>
              ) : (
                <span className="near">voz</span>
              )
            ) : p.id !== selfId && nearbyIds.includes(p.id) ? (
              <span className="near">voz</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
