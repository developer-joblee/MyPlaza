import { answerCall } from '../call';
import { useStore } from '../state/store';
import { BellIcon } from './icons';
import { formatTime } from './util';

/**
 * A pilha de chamados, no canto superior direito.
 *
 * Por que não na `.notice-stack` (que é topo-centro e já tem o chamado de
 * ausente, a booble e os avisos de voz): um chamado pede uma **decisão** de quem
 * recebe, e decisão fica onde a pessoa pode deixar aberta enquanto continua
 * jogando — o topo-centro é sobre o avatar, no caminho do olho e do movimento.
 * Os cartões reusam as classes `.notice*`, então visualmente são a mesma família;
 * o que muda é a âncora.
 *
 * O nome vem do `roster` pelo id, nunca da cópia no store: é isso que faz o
 * cartão morrer quando a pessoa sai do mundo, em vez de ficar oferecendo "ir
 * até" alguém que não está mais lá. O `name` guardado só cobre a corrida de a
 * pessoa sair no mesmo instante em que o cartão aparece.
 */
export function CallAlerts() {
  const calls = useStore((s) => s.calls);
  const roster = useStore((s) => s.roster);
  if (calls.length === 0) return null;

  return (
    <div className="call-stack" role="status" aria-live="polite">
      {calls.map((c) => {
        const nome = roster.find((r) => r.id === c.id)?.name ?? c.name;
        return c.kind === 'incoming' ? (
          <div key={`in-${c.id}`} className="notice nudge">
            <BellIcon />
            <span>
              {nome} te chamou · {formatTime(c.at)}
            </span>
            <button
              type="button"
              className="notice-action"
              onClick={() => answerCall(c.id, true)}
              title={`Caminhar até ${nome}`}
            >
              Ir até
            </button>
            <button
              type="button"
              className="notice-dismiss"
              onClick={() => answerCall(c.id, false)}
              aria-label={`Dispensar o chamado de ${nome}`}
            >
              ×
            </button>
          </div>
        ) : (
          <div key={`go-${c.id}`} className="notice info">
            <span>{nome} está vindo</span>
          </div>
        );
      })}
    </div>
  );
}
