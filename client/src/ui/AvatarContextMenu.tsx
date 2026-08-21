import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { callCooldownLeft, toggleCall } from '../call';
import { useStore } from '../state/store';
import { colorToCss } from './util';

/** Folga entre o menu e a borda da janela, quando ele precisa virar. */
const EDGE_PAD = 8;

/**
 * Menu de contexto de um avatar, aberto com o **botão direito** sobre o boneco.
 *
 * Mostra de quem é (bolinha da cor, nome, selo **você** no próprio) e, para as
 * outras pessoas, a ação **chamar** — um interruptor: pressionado significa que
 * há um alerta seu na tela dela agora. Ver `client/src/call.ts`.
 *
 * O "pressionado" vem do store (`myCalls`), e não de estado local como o
 * cooldown do botão da lista do HUD: este painel **desmonta ao fechar**, então
 * um `useState` nasceria despressionado ao reabrir o menu na mesma pessoa,
 * mentindo sobre um chamado que continua no ar.
 *
 * Quem detecta o clique é o `Game` (`Avatar.setContextMenuHandler`), que é o
 * único lugar com a árvore de exibição e, portanto, o único que sabe qual boneco
 * está na frente quando dois se sobrepõem.
 */
export function AvatarContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const close = useStore((s) => s.closeContextMenu);
  const roster = useStore((s) => s.roster);
  const selfId = useStore((s) => s.selfId);
  const myCalls = useStore((s) => s.myCalls);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  /**
   * A pessoa sai do roster ao sair do mundo. O menu **não** pode sobreviver a
   * isso: ele passaria a apontar para quem não está mais lá, e um item futuro
   * ("chamar", "booble") agiria sobre um id morto. Por isso o roster é a fonte —
   * o menu não guarda cópia de nome nenhum.
   */
  const entry = menu ? (roster.find((r) => r.id === menu.id) ?? null) : null;
  useEffect(() => {
    if (menu && !entry) close();
  }, [menu, entry, close]);

  // Escape e clique fora fecham. Em CAPTURA, como nos outros painéis: sem isso o
  // canvas do Pixi engole o `pointerdown` e o menu fica preso na tela.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && !el.contains(e.target as Node)) close();
    };
    /**
     * A roda dá zoom, e o zoom move o mundo debaixo de um menu que está preso à
     * TELA: em dois giros ele estaria em cima de outra pessoa. Fechar é mais
     * honesto que reancorar — o menu pertence ao clique que o abriu.
     */
    const onWheel = () => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onWheel);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onWheel);
    };
  }, [menu, close]);

  /**
   * Vira o menu para dentro da janela quando o clique é perto da borda. Medido
   * depois de montar (`useLayoutEffect`, antes de pintar) porque a altura
   * depende do nome e do texto — estimar em número mágico erraria no primeiro
   * item que entrar aqui.
   */
  useLayoutEffect(() => {
    if (!menu || !entry) {
      setPos(null);
      return;
    }
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const maxX = window.innerWidth - width - EDGE_PAD;
    const maxY = window.innerHeight - height - EDGE_PAD;
    setPos({
      x: Math.max(EDGE_PAD, Math.min(menu.x, maxX)),
      y: Math.max(EDGE_PAD, Math.min(menu.y, maxY)),
    });
  }, [menu, entry]);

  /**
   * Quanto falta do cooldown deste alvo, e um timer para re-renderizar quando ele
   * vencer: sem isso o item ficaria desabilitado até alguém fechar e reabrir o
   * menu, porque nada no store muda quando o tempo simplesmente passa.
   */
  const cooldown = callCooldownLeft(menu ? myCalls[menu.id] : undefined);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = window.setTimeout(() => setTick((n) => n + 1), cooldown + 20);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!menu || !entry) return null;

  const isSelf = entry.id === selfId;
  const chamando = myCalls[entry.id] !== undefined;
  /**
   * Ausente **não** é chamável por aqui: o canal de quem está no celular é o
   * botão da lista, com o "toc-toc" e o "Voltar". O item aparece desabilitado com
   * o motivo em vez de sumir — sumir faria parecer defeito.
   */
  const impedimento = entry.away
    ? `${entry.name} está ausente — use o "chamar" da lista`
    : cooldown > 0
      ? `Você acabou de chamar ${entry.name} — espere um instante`
      : null;

  return (
    <div
      ref={ref}
      className="panel avatar-menu"
      role="menu"
      aria-label={`Ações de ${entry.name}`}
      /*
       * Antes da medição o menu é desenhado no ponto do clique e escondido: sem
       * o `hidden` haveria um frame com ele meio fora da tela antes de virar.
       */
      style={{
        left: pos?.x ?? menu.x,
        top: pos?.y ?? menu.y,
        visibility: pos ? 'visible' : 'hidden',
      }}
    >
      <div className="avatar-menu-head">
        <span className="avatar-menu-dot" style={{ background: colorToCss(entry.color) }} />
        <span className="avatar-menu-name">{entry.name}</span>
        {isSelf && <span className="avatar-menu-tag">você</span>}
      </div>
      {isSelf ? (
        <p className="avatar-menu-empty">Nenhuma ação sobre você por enquanto.</p>
      ) : (
        <button
          type="button"
          role="menuitem"
          className="avatar-menu-item"
          aria-pressed={chamando}
          disabled={!chamando && impedimento !== null}
          title={
            chamando
              ? `Tirar o seu chamado da tela de ${entry.name}`
              : (impedimento ?? `Chamar ${entry.name} (toca um aviso na tela dela)`)
          }
          onClick={() => toggleCall(entry.id)}
        >
          {chamando ? 'cancelar chamado' : 'chamar'}
        </button>
      )}
    </div>
  );
}
