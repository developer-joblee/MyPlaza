import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../state/store';
import { colorToCss } from './util';

/** Folga entre o menu e a borda da janela, quando ele precisa virar. */
const EDGE_PAD = 8;

/**
 * Menu de contexto de um avatar, aberto com o **botão direito** sobre o boneco.
 *
 * **Está vazio de propósito** — por enquanto ele só prova o caminho inteiro:
 * clique direito no Pixi → store → menu do DOM no lugar certo, sobre a pessoa
 * certa. Os itens entram depois. Um painel sem conteúdo nenhum pareceria
 * quebrado, então ele mostra de quem é e diz que ainda não há ação.
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

  if (!menu || !entry) return null;

  const isSelf = entry.id === selfId;

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
      <p className="avatar-menu-empty">Nenhuma ação por enquanto.</p>
    </div>
  );
}
