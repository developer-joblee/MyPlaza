import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  BOOBLE_MAX_MEMBERS,
  PEER_VOLUME_DEFAULT,
  PEER_VOLUME_MAX,
  type PeerAudioPrefs,
} from '@together/shared';
import { cancelPendingBooble, requestBooble } from '../booble';
import { callCooldownLeft, toggleCall } from '../call';
import { applyPeerAudio, persistPeerAudio } from '../peerAudio';
import { useStore } from '../state/store';
import { MicIcon, SoundboardIcon } from './icons';
import { colorToCss } from './util';

/** Folga entre o menu e a borda da janela, quando ele precisa virar. */
const EDGE_PAD = 8;

/**
 * Atraso entre soltar o slider e gravar no perfil.
 *
 * Espelha o 500 do `SoundboardPanel` de propósito: são o mesmo gesto (arrastar
 * um volume) e destoar faria um parecer mais lento que o outro sem motivo. Sem
 * atraso, um arrasto de ponta a ponta seria dezenas de escritas.
 */
const SAVE_DEBOUNCE_MS = 500;

/**
 * Teclas que um `<input type="range">` consome.
 *
 * **Existe para NÃO parar o Escape.** O menu fecha por um listener nativo em
 * `document`, e um `stopPropagation()` cru no `onKeyDown` do React barra o
 * evento nativo antes de ele chegar lá — com o foco no slider, o Escape
 * simplesmente pararia de fechar o menu. Ao mesmo tempo, deixar as setas subirem
 * faz o avatar andar junto com o slider. Então a propagação para **só** nestas.
 */
const RANGE_KEYS = new Set([
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
]);

/**
 * Menu de contexto de um avatar, aberto com o **botão direito** sobre o boneco.
 *
 * Mostra de quem é (bolinha da cor, nome, selo **você** no próprio) e, para as
 * outras pessoas, duas ações:
 *
 * - **booble** / **entrar na booble** — abre (ou entra na) conversa paralela com
 *   essa pessoa. Ver `client/src/booble.ts` e `docs/features/booble.md`. Este
 *   item **era** um botão na linha do HUD; ele mora aqui porque a booble é uma
 *   ação sobre *uma pessoa em particular*, e é neste menu que essas moram. Vale
 *   de **qualquer distância**: de longe o avatar vai até lá caminhando e a booble
 *   abre na chegada.
 * - **chamar** — um interruptor: pressionado significa que há um alerta seu na
 *   tela dela agora. Ver `client/src/call.ts`.
 *
 * Os dois vêm nesta ordem porque a booble é a ação sobre a pessoa; o `chamar`
 * pede que ela venha, e só faz sentido quando ir até ela não faz.
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
/**
 * Os dois sliders de "quanto eu ouço esta pessoa" — voz e sons de soundboard,
 * separados.
 *
 * Componente local, e não arquivo próprio, porque só este menu o usa (a regra do
 * repo manda extrair quando aparece em mais de um lugar). O que ele encapsula é
 * o par **aplicar já / gravar depois**, que é a mesma receita do volume global
 * do soundboard e não deveria ficar espalhada no menu.
 *
 * Três decisões que parecem detalhe e não são:
 *
 * 1. **O valor pendente vive num `ref`, não em estado.** O menu desmonta por
 *    cinco caminhos (Escape, clique fora, roda, resize, a pessoa saindo do
 *    roster), e o flush do `useEffect` tem de achar o último valor em todos
 *    eles. Com `useState` o cleanup fecharia sobre um valor velho.
 * 2. **A altura da seção não muda depois de montar.** O `useLayoutEffect` do
 *    menu mede **uma vez** para virar a caixa para dentro da janela; uma linha
 *    de aviso aparecendo depois deixaria o painel pendurado fora da tela. Por
 *    isso o estado da gravação mora num `<small>` que já existe no cabeçalho da
 *    seção, e não numa linha nova.
 * 3. **`not-configured` não é erro.** Sem Supabase o ajuste vale na sessão e
 *    ponto; avisar "não foi possível salvar" a cada arrasto num app rodando
 *    anônimo seria ruído sobre uma decisão de deploy.
 */
function PeerAudioControls({ id, name }: { id: string; name: string }) {
  // a entrada CRUA do store: identidade estável, então o componente não
  // re-renderiza a cada tick de posição. O default é preenchido fora do selector
  // de propósito — `?? { ... }` aqui dentro alocaria um objeto novo por render.
  const stored = useStore((s) => s.peerAudio[id]);
  const prefs: PeerAudioPrefs = stored ?? {
    voice: PEER_VOLUME_DEFAULT,
    sound: PEER_VOLUME_DEFAULT,
  };

  const [saveFailed, setSaveFailed] = useState(false);
  const timer = useRef<number | null>(null);
  const pending = useRef<PeerAudioPrefs | null>(null);

  // fechar o menu logo depois de arrastar é o caminho MAIS provável (abre-se o
  // menu só para baixar o volume), então o flush no unmount não é conforto
  useEffect(
    () => () => {
      if (timer.current === null) return;
      window.clearTimeout(timer.current);
      timer.current = null;
      const last = pending.current;
      pending.current = null;
      if (last) void persistPeerAudio(id, last);
    },
    [id],
  );

  const change = (next: PeerAudioPrefs) => {
    applyPeerAudio(id, next); // ouve-se AGORA; o resto é persistência
    pending.current = next;
    setSaveFailed(false);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const last = pending.current;
      pending.current = null;
      if (!last) return;
      void persistPeerAudio(id, last).then((reason) => {
        setSaveFailed(reason !== null && reason !== 'not-configured');
      });
    }, SAVE_DEBOUNCE_MS);
  };

  const row = (
    kind: 'voice' | 'sound',
    label: string,
    icon: ReactNode,
    hint: string,
  ) => {
    const value = prefs[kind];
    const labelId = `peer-${kind}-label`;
    return (
      <div className={`peer-volume${value === 0 ? ' muted' : ''}`}>
        <span className="join-label" id={labelId}>
          {icon}
          {label}
          {/* mesmo slot sempre: "mudo" em vez de "0%" porque zero é um estado,
              não uma quantidade — é o que o volume global já faz */}
          <small>{value === 0 ? 'mudo' : `${value}%`}</small>
        </span>
        <input
          className="clip-range"
          type="range"
          min={0}
          max={PEER_VOLUME_MAX}
          step={1}
          value={value}
          onChange={(e) => change({ ...prefs, [kind]: Number(e.target.value) })}
          // só as teclas do próprio slider; ver `RANGE_KEYS`
          onKeyDown={(e) => {
            if (RANGE_KEYS.has(e.key)) e.stopPropagation();
          }}
          aria-labelledby={labelId}
          aria-valuetext={value === 0 ? `${label} de ${name}: mudo` : `${value} por cento`}
          title={hint}
        />
      </div>
    );
  };

  return (
    <div className="avatar-menu-audio">
      <span className="join-label avatar-menu-audio-head">
        Áudio de {name}
        {/* o aviso mora AQUI, num slot que já existe: ver a decisão 2 acima */}
        <small>{saveFailed ? 'não salvo' : ''}</small>
      </span>
      {row(
        'voice',
        'voz',
        <MicIcon />,
        `O quanto você ouve a voz de ${name}. Vale só para você, e fica salvo na sua conta.`,
      )}
      {row(
        'sound',
        'sons',
        <SoundboardIcon />,
        `O quanto você ouve os sons de soundboard de ${name}. Não mexe na voz dela.`,
      )}
    </div>
  );
}

export function AvatarContextMenu() {
  const menu = useStore((s) => s.contextMenu);
  const close = useStore((s) => s.closeContextMenu);
  const roster = useStore((s) => s.roster);
  const selfId = useStore((s) => s.selfId);
  const myCalls = useStore((s) => s.myCalls);
  const selfBooble = useStore((s) => s.selfBooble);
  /**
   * Quem está ao alcance de **abrir** uma booble (2 tiles e mesma zona), medido
   * pelo `Game`. É a mesma fonte que o botão do HUD usava, e por dois motivos que
   * continuam valendo aqui: o raio da booble não é o audível (5 tiles), e o tick
   * da voz — de onde sai o `nearbyIds` — **não roda** sem LiveKit configurado.
   */
  const boobleReachIds = useStore((s) => s.boobleReachIds);
  const pendingBooble = useStore((s) => s.pendingBooble);
  const selfAway = useStore((s) => s.away);

  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  /**
   * A pessoa sai do roster ao sair do mundo. O menu **não** pode sobreviver a
   * isso: ele passaria a apontar para quem não está mais lá, e os itens
   * ("booble", "chamar") agiriam sobre um id morto. Por isso o roster é a fonte —
   * o menu não guarda cópia de nome nenhum. E é dele que sai também o
   * `boobleId` do alvo, que decide entre "booble" e "entrar na booble".
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
     *
     * **Menos quando o cursor está sobre o próprio menu.** Antes isso era grátis
     * (não havia nada com que interagir dentro dele); com os sliders, rolar a
     * roda mirando um deles fecharia o painel na cara de quem estava mexendo. E
     * não há incoerência: o zoom escuta a roda no **canvas**, então uma roda em
     * cima do painel não move o mundo nenhum — não há nada para o fechamento
     * proteger.
     */
    const onWheel = (e: Event) => {
      const el = ref.current;
      if (el && e.target instanceof Node && el.contains(e.target)) return;
      close();
    };
    const onResize = () => close();
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
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

  /** Já estamos na mesma booble? Aí não há ação: o servidor trata como no-op. */
  const juntos = selfBooble !== null && entry.boobleId === selfBooble;
  /** Estou a caminho DESTA pessoa? Então o item é o botão de desistir. */
  const indo = pendingBooble === entry.id;
  /** Já dá para abrir agora, sem caminhar (2 tiles e mesma zona). */
  const aoAlcance = boobleReachIds.includes(entry.id);
  /**
   * Quanta gente há na booble desta pessoa. Sai do roster, que já é a lista
   * completa do mundo — contar aqui evita mandar o tamanho pela rede e a janela
   * em que o número enviado envelhece.
   */
  const boobleSize =
    entry.boobleId === null ? 0 : roster.filter((r) => r.boobleId === entry.boobleId).length;
  /**
   * Por que **não** dá para abrir/entrar. Espelha as recusas de
   * `World.joinBooble`, na ordem em que elas importam para quem lê — **menos a
   * distância**, que aqui não é impedimento: de longe o clique manda o avatar
   * caminhar até lá (`requestBooble`), e é a chegada que abre a booble. É o único
   * lugar onde a interface deliberadamente aceita um clique que o servidor
   * recusaria *neste instante*.
   *
   * Como no `chamar`, o item aparece **desabilitado com o motivo** em vez de
   * sumir: sumir faria parecer defeito.
   */
  const boobleImpedimento = juntos
    ? `Vocês já estão na mesma booble — para sair, use o "Sair" no aviso do topo`
    : selfAway
      ? 'Você está ausente — volte para abrir uma booble'
      : entry.away
        ? `${entry.name} está ausente`
        : entry.boobleId !== null && boobleSize >= BOOBLE_MAX_MEMBERS
          ? `A booble de ${entry.name} está cheia (${BOOBLE_MAX_MEMBERS} pessoas)`
          : null;

  return (
    <div
      ref={ref}
      className="panel avatar-menu"
      role="menu"
      aria-label={`Ações de ${entry.name}`}
      /*
       * Sem isto, mexer nos sliders com o teclado anda com o avatar: o
       * `game/input.ts` escuta a `window` e só ignora quem está dentro de um
       * `[data-capture-keys]`. A armadilha registrada no doc deste menu ("vira
       * problema no primeiro item com input") era exatamente este dia. O
       * atributo na raiz basta — o filtro por tecla no `<input>` é para o Escape
       * continuar fechando o menu, que é outro problema.
       */
      data-capture-keys
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
        <>
          <button
            type="button"
            role="menuitem"
            className={`avatar-menu-item booble-join${juntos || indo ? ' on-booble' : ''}`}
            /*
             * `!indo` na frente, como no `chamar`: desistir nunca pode ficar
             * indisponível. Se o alvo ficar ausente no meio do caminho, um item
             * desabilitado prenderia a caminhada até o prazo vencer.
             */
            disabled={!indo && boobleImpedimento !== null}
            title={
              indo
                ? `Desistir de ir até ${entry.name}`
                : (boobleImpedimento ??
                  (entry.boobleId !== null
                    ? `Entrar na booble de ${entry.name}` +
                      (selfBooble !== null ? ' (você sai da sua)' : '')
                    : `Abrir uma booble com ${entry.name}: vocês se ouvem a 100% e o resto da sala a 7%`) +
                    (aoAlcance ? '' : ' — você vai até lá primeiro'))
            }
            /*
             * Um clique, dois destinos: perto abre na hora, longe começa a
             * caminhada. Quem decide é `requestBooble`, e não este componente —
             * a UI não deve conhecer o raio.
             */
            onClick={() => {
              if (indo) {
                cancelPendingBooble();
                return;
              }
              requestBooble(entry.id);
              /*
               * Fecha só quando vai caminhar. O menu é `fixed` e não segue o
               * avatar: deixá-lo aberto o abandonaria no ponto do clique
               * enquanto o boneco atravessa a sala. Abrindo na hora ele fica,
               * porque é ali que se vê o item virar "na sua booble".
               */
              if (!aoAlcance) close();
            }}
          >
            {juntos
              ? 'na sua booble'
              : indo
                ? 'cancelar'
                : entry.boobleId !== null
                  ? 'entrar na booble'
                  : 'booble'}
          </button>
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
          {/*
           * O volume vem DEPOIS das duas ações, e separado por uma linha: booble
           * e chamar são coisas que se fazem *com* a pessoa; isto é um ajuste
           * sobre como eu a ouço. Sem a separação o menu leria como uma lista de
           * quatro coisas do mesmo tipo.
           */}
          <PeerAudioControls id={entry.id} name={entry.name} />
        </>
      )}
    </div>
  );
}
