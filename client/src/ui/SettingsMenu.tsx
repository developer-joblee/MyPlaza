import { useEffect, useRef, useState } from 'react';
import { SCENARIOS, isProfileId, type LobbyResult } from '@together/shared';
import { createLobbyApi } from '../net/lobbyApi';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { CloseIcon, HangupIcon } from './icons';
import { REASON_TEXT } from './lobbyReason';
import { SCENARIO_EMOJI } from './scenarioEmoji';
import { copyText } from './util';

/**
 * Menu de configurações do jogo: em que mundo você está, o seu ID, adicionar
 * alguém a este mundo pelo ID dela, e sair.
 *
 * **Por que ele existe:** dar acesso a uma pessoa só era possível no lobby, e
 * chegar ao lobby exige sair do mundo — ou seja, derrubar voz, tela e posição
 * para uma operação de dez segundos. Agora dá para fazer de dentro.
 *
 * **E por que isso não custou nada no servidor:** `server/src/index.ts` registra
 * `registerLobbyHandlers` em TODA conexão, e o socket do jogo carrega o mesmo
 * token no handshake (`net/socket.ts`). O `lobby:addMember` já funcionava aqui;
 * só faltava tela. O comentário do `LobbyScreen` que diz que os dois sockets
 * nunca são simultâneos continua valendo — este menu usa o socket **do jogo**,
 * não abre um segundo.
 *
 * Popover no molde do `AudioSettings` (que o `SoundboardPanel` já copiou):
 * mesmo `role="dialog"`, mesmo fechamento por Escape/clique fora, mesmo
 * cabeçalho. Um quarto molde só faria os três divergirem.
 */
export function SettingsMenu({ onClose }: { onClose: () => void }) {
  const myId = useStore((s) => s.myId);
  const worlds = useStore((s) => s.worlds);
  const selfWorldId = useStore((s) => s.selfWorldId);
  const selfWorldName = useStore((s) => s.selfWorldName);
  const selfScenario = useStore((s) => s.selfScenario);
  const leave = useStore((s) => s.leave);
  const furnitureCanEdit = useStore((s) => s.furnitureCanEdit);
  const furnitureEditing = useStore((s) => s.furnitureEditing);
  const setFurnitureEditing = useStore((s) => s.setFurnitureEditing);

  const panelRef = useRef<HTMLDivElement>(null);
  const [memberId, setMemberId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);

  /**
   * A api lê o socket na hora do envio (por isso o getter, e não o socket): numa
   * reconexão o `runtime.socket` é substituído, e uma api que guardasse a
   * referência apontaria para um socket morto. Mesma escolha do `LobbyScreen`.
   */
  const apiRef = useRef(createLobbyApi(() => runtime.socket));

  // popover não-modal: fecha em Escape ou clique fora
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    // captura para fechar antes do canvas engolir o evento
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  /**
   * Dono e host administram; membro comum só entra. Mesmo predicado do lobby
   * (`canManage`), agora aplicado ao mundo em que a pessoa está. O mundo sai da
   * lista que o lobby deixou no store — `leave()` e `chooseWorld` não a limpam.
   *
   * Sem o mundo na lista (modo anônimo, ou store ainda sem `lobby:list`) o item
   * simplesmente não aparece: o servidor recusaria com `not-allowed` de todo
   * jeito, e um campo que sempre falha é pior que campo nenhum.
   */
  const world = worlds.find((w) => w.id === selfWorldId) ?? null;
  const canAdd = Boolean(selfWorldId) && world !== null && world.myRole !== 'member';

  const addMember = async () => {
    const id = memberId.trim().toLowerCase();
    if (!selfWorldId || !isProfileId(id)) return;
    setBusy(true);
    setError(null);
    setDone(false);
    const res: LobbyResult | null = await apiRef.current.addMember(selfWorldId, id);
    // `null` = já havia uma chamada igual em vôo (o `once()` da api deduplica).
    // Não é erro nem sucesso, e quem destrava é a chamada que está acontecendo.
    if (!res) return;
    setBusy(false);
    if (!res.ok) {
      setError(REASON_TEXT[res.reason]);
      return;
    }
    /**
     * O `res.state` é DESCARTADO de propósito — nada de `setLobby()` aqui.
     *
     * Ele sobrescreveria `selfName`/`selfColor`/`selfCharacter` com o prefill do
     * perfil (`LobbyState.me`), e dentro de um mundo o nome que vale é o vínculo
     * DAQUELE mundo: quem é "Iago (cliente)" aqui viraria "Iago" no meio da
     * sessão. Esta operação muda o acesso de outra pessoa, não a minha
     * aparência — a lista de mundos do lobby é remontada na próxima ida até lá.
     */
    setMemberId('');
    setDone(true);
  };

  const copyMyId = () => {
    void copyText(myId).then((ok) => {
      if (!ok) {
        setError('Não deu para copiar. Selecione o ID e copie à mão.');
        return;
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    /*
     * `data-capture-keys` é obrigatório: sem ele o `input.ts` trata as teclas
     * como movimento e colar um uuid faz o avatar sair andando pelo mapa.
     */
    <div
      ref={panelRef}
      id="settings-popover"
      className="panel settings-popover"
      role="dialog"
      aria-label="Configurações"
      data-capture-keys
    >
      <div className="audio-head">
        Configurações
        <button type="button" className="audio-close" onClick={onClose} aria-label="Fechar">
          <CloseIcon />
        </button>
      </div>

      <p className="settings-world">
        <span aria-hidden="true">{SCENARIO_EMOJI[selfScenario]}</span>
        {/* sem mundo (modo anônimo) o que identifica o lugar é o cenário */}
        {selfWorldName ?? SCENARIOS[selfScenario].label}
      </p>

      {myId && (
        <section className="settings-section">
          <span className="join-label">Seu ID</span>
          <p className="join-hint">
            Passe para quem administra o mundo em que você quer entrar. Ele não dá acesso a
            nada por si só — só diz quem você é.
          </p>
          <div className="lobby-invite">
            <input
              className="join-input"
              value={myId}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <button className="join-secondary lobby-action" type="button" onClick={copyMyId}>
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </section>
      )}

      {canAdd && (
        <section className="settings-section">
          <span className="join-label">Adicionar alguém a este mundo</span>
          <p className="join-hint">
            Cole o ID da pessoa. Ela passa a ver este mundo no lobby dela na hora, sem passo
            de aceite — e sem você sair daqui.
          </p>
          <div className="lobby-invite">
            <input
              className="join-input"
              value={memberId}
              onChange={(e) => {
                setMemberId(e.target.value);
                setDone(false);
              }}
              placeholder="cole aqui o ID da pessoa"
            />
            <button
              className="join-secondary lobby-action"
              type="button"
              disabled={busy || !isProfileId(memberId.trim().toLowerCase())}
              onClick={() => void addMember()}
            >
              Adicionar
            </button>
          </div>
          {done && <p className="settings-ok" role="status">Pronto — a pessoa já tem acesso.</p>}
        </section>
      )}

      {error && <p className="settings-error" role="alert">{error}</p>}

      {/* editor de móveis: só aparece para quem pode editar (o servidor decide) */}
      {furnitureCanEdit && (
        <button
          className="settings-action"
          type="button"
          onClick={() => {
            setFurnitureEditing(!furnitureEditing);
            onClose();
          }}
        >
          🛋️ {furnitureEditing ? 'Concluir edição de móveis' : 'Editar móveis'}
        </button>
      )}

      {/* a divisória isola a ação destrutiva do resto, como fazia na barra */}
      <span className="settings-divider" aria-hidden="true" />

      {/* o telefone continua sendo o desenho de "sair", só que agora com rótulo */}
      <button className="settings-danger" type="button" onClick={leave}>
        <HangupIcon />
        Finalizar chamada
      </button>
    </div>
  );
}
