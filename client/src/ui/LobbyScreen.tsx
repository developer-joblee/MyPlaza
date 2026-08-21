import { useEffect, useRef, useState } from 'react';
import {
  SCENARIOS,
  isProfileId,
  type AssignableWorldRole,
  type LobbyResult,
  type ScenarioId,
  type WorldPatch,
  type WorldSummary,
} from '@together/shared';
import { createLobbyApi } from '../net/lobbyApi';
import { createSocket, type AppSocket } from '../net/socket';
import { useStore } from '../state/store';
import { signOut } from '../auth/supabase';
import { REASON_TEXT } from './lobbyReason';
import { SCENARIO_EMOJI } from './scenarioEmoji';
import { copyText } from './util';
import { WorldAdmin } from './WorldAdmin';

/**
 * Lobby: escolher um mundo, criar um, e responder a convites.
 *
 * Tem **socket próprio**, aberto ao montar e fechado ao desmontar. O socket do
 * jogo nasce no `GameView` e morre com ele; ter um só, vivo entre as duas telas,
 * exigiria tirar o ciclo de vida de dentro do `GameView` — onde também mora o
 * `join` no `connect`. Duas conexões curtas e nunca simultâneas custam menos que
 * essa reestruturação.
 */
export function LobbyScreen() {
  const worlds = useStore((s) => s.worlds);
  const invites = useStore((s) => s.pendingInvites);
  const authEmail = useStore((s) => s.authEmail);
  /** o ID desta pessoa — o que ela passa para ser adicionada a um mundo */
  const myId = useStore((s) => s.myId);
  const setLobby = useStore((s) => s.setLobby);
  const chooseWorld = useStore((s) => s.chooseWorld);
  const worldDetail = useStore((s) => s.worldDetail);
  const closeWorldDetail = useStore((s) => s.closeWorldDetail);

  const socketRef = useRef<AppSocket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // formulário de criação
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newScenario, setNewScenario] = useState<ScenarioId>('studio');
  const [newCapacity, setNewCapacity] = useState('');

  // adicionar gente: qual mundo está com o campo aberto
  const [invitingId, setInvitingId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState('');
  /** feedback do botão de copiar o próprio ID */
  const [copied, setCopied] = useState(false);

  /**
   * A api é criada uma vez e lê o socket na hora do envio (por isso o getter):
   * o socket nasce dentro do `useEffect`, depois do primeiro render.
   */
  const apiRef = useRef(createLobbyApi(() => socketRef.current));
  const api = apiRef.current;

  useEffect(() => {
    const socket = createSocket();
    socketRef.current = socket;
    const onConnect = () => {
      void api.list().then((res) => {
        setLoading(false);
        apply(res);
      });
    };
    socket.on('connect', onConnect);
    socket.on('connect_error', () => {
      setLoading(false);
      setError('Não foi possível falar com o servidor.');
    });
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.removeAllListeners('connect_error');
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Aplica a resposta. `null` = já havia uma chamada igual em vôo (a api
   * deduplica), então não é erro nem sucesso: não mexe em nada.
   *
   * O `busy` sai SEMPRE, inclusive em falha de transporte — era exatamente o
   * defeito de antes: sem timeout, um ack que nunca chegava deixava todos os
   * botões desabilitados até o componente remontar.
   */
  const apply = (res: LobbyResult | null): boolean => {
    // `null` antes de mexer no `busy`: a chamada que está em vôo é de outro
    // clique, e é ela que vai destravar o botão. Limpar aqui reabilitaria a tela
    // no meio da requisição que ainda está acontecendo.
    if (!res) return false;
    setBusy(false);
    if (res.ok) {
      setLobby(res.state, res.detail);
      setError(null);
      return true;
    }
    setError(REASON_TEXT[res.reason]);
    return false;
  };

  /** Roda uma operação da api e aplica o resultado. */
  const run = async (op: Promise<LobbyResult | null>): Promise<boolean> => {
    setBusy(true);
    return apply(await op);
  };

  const manage = (worldId: string) => void run(api.world(worldId));
  const updateWorld = (worldId: string, patch: WorldPatch) =>
    void run(api.update(worldId, patch));
  const removeMember = (worldId: string, profileId: string) =>
    void run(api.removeMember(worldId, profileId));
  const revokeInvite = (inviteId: string) => void run(api.revokeInvite(inviteId));
  const setRole = (worldId: string, profileId: string, role: AssignableWorldRole) =>
    void run(api.setMemberRole(worldId, profileId, role));
  const transferOwner = (worldId: string, profileId: string) =>
    void run(api.transferOwner(worldId, profileId));
  const decline = (inviteId: string) => void run(api.decline(inviteId));
  const accept = (inviteId: string) => void run(api.accept(inviteId));

  const archive = async (worldId: string) => {
    // fecha o painel só se arquivou de verdade
    if (await run(api.archive(worldId))) closeWorldDetail();
  };

  const create = async () => {
    const name = newName.trim();
    if (!name) return;
    const capacity = newCapacity.trim() === '' ? null : Number(newCapacity);
    if (capacity !== null && (!Number.isInteger(capacity) || capacity < 1)) {
      setError('Lotação precisa ser um número inteiro maior que zero (ou vazio).');
      return;
    }
    // sem guarda de `busy` aqui: quem impede o clique duplo é o `once()` da api,
    // que não depende de o React já ter re-renderizado
    if (await run(api.create(name, newScenario, capacity))) {
      setShowCreate(false);
      setNewName('');
      setNewCapacity('');
    }
  };

  const addMember = async (worldId: string) => {
    const id = memberId.trim().toLowerCase();
    if (!isProfileId(id)) return;
    if (await run(api.addMember(worldId, id))) {
      setInvitingId(null);
      setMemberId('');
    }
  };

  /**
   * Copiar é o caminho normal — o ID é um uuid, e ninguém digita 36 caracteres
   * sem errar. O caminho de falha (contexto não seguro) está em `copyText`; aqui
   * ele vira a saída manual, com o texto continuando selecionável na tela.
   */
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

  /** Dono e host administram; membro comum só entra. */
  const canManage = (world: WorldSummary) => world.myRole !== 'member';

  const enter = (world: WorldSummary) => {
    if (world.capacity !== null && world.online >= world.capacity) return;
    // com vínculo isto vai DIRETO para o jogo; sem, para a tela de entrada
    chooseWorld(world);
  };

  /**
   * Abre a tela de entrada com o vínculo preenchido, para trocar nome, cor ou
   * personagem neste mundo. Só aparece havendo vínculo: sem ele a tela de
   * entrada já vai aparecer sozinha, e um botão "Editar" ali prometeria editar
   * algo que ainda não existe.
   */
  const editEntry = (world: WorldSummary) => chooseWorld(world, { edit: true });

  return (
    <div className="join-screen">
      <div className="lobby-card">
        <header className="lobby-header">
          <h1 className="join-logo">
            t<span className="accent">o</span>Gether
          </h1>
          <span className="lobby-email">{authEmail}</span>
        </header>

        {error && (
          <p className="join-denied" role="alert">
            {error}
          </p>
        )}

        {invites.length > 0 && (
          <section className="lobby-section">
            <h2 className="lobby-title">Convites</h2>
            {invites.map((inv) => (
              <div key={inv.id} className="lobby-row">
                <div className="lobby-row-main">
                  <strong>{inv.worldName ?? inv.organizationName}</strong>
                  <span className="lobby-meta">
                    {inv.worldName
                      ? `mundo em ${inv.organizationName}`
                      : 'acesso a toda a empresa'}
                  </span>
                </div>
                <div className="lobby-row-actions">
                  <button
                    className="join-secondary lobby-action"
                    type="button"
                    disabled={busy}
                    onClick={() => decline(inv.id)}
                  >
                    Recusar
                  </button>
                  <button
                    className="join-button lobby-action"
                    type="button"
                    disabled={busy}
                    onClick={() => accept(inv.id)}
                  >
                    Aceitar
                  </button>
                </div>
              </div>
            ))}
          </section>
        )}

        <section className="lobby-section">
          <h2 className="lobby-title">Seus mundos</h2>

          {loading && <p className="lobby-meta">Carregando…</p>}

          {!loading && worlds.length === 0 && (
            <p className="lobby-meta">
              Você ainda não tem mundo nenhum. Crie o primeiro, ou peça um convite a quem já tem.
            </p>
          )}

          {worlds.map((w) => {
            const full = w.capacity !== null && w.online >= w.capacity;
            return (
              <div key={w.id} className="lobby-row">
                <div className="lobby-row-main">
                  <strong>
                    {SCENARIO_EMOJI[w.scenarioId]} {w.name}
                  </strong>
                  <span className="lobby-meta">
                    {SCENARIOS[w.scenarioId].label}
                    {' · '}
                    {w.online} dentro
                    {w.capacity !== null && ` de ${w.capacity}`}
                    {w.myRole === 'owner' && ' · você criou'}
                    {w.myRole === 'host' && ' · você administra'}
                    {w.visibility === 'restricted' && ' · restrito'}
                    {/* com vínculo, "Entrar" não pergunta mais nada — então o
                        nome que vai ser usado precisa estar à vista aqui */}
                    {w.binding && ` · como ${w.binding.name}`}
                  </span>

                  {invitingId === w.id && (
                    <div className="lobby-invite">
                      <input
                        className="join-input"
                        value={memberId}
                        onChange={(e) => setMemberId(e.target.value)}
                        placeholder="cole aqui o ID da pessoa"
                        autoFocus
                      />
                      <button
                        className="join-secondary lobby-action"
                        type="button"
                        disabled={busy || !isProfileId(memberId)}
                        onClick={() => void addMember(w.id)}
                      >
                        Adicionar
                      </button>
                    </div>
                  )}
                </div>

                <div className="lobby-row-actions">
                  {canManage(w) && (
                    <button
                      className="join-secondary lobby-action"
                      type="button"
                      onClick={() => {
                        setInvitingId(invitingId === w.id ? null : w.id);
                        setMemberId('');
                      }}
                    >
                      {invitingId === w.id ? 'Cancelar' : 'Adicionar'}
                    </button>
                  )}
                  {canManage(w) && (
                    <button
                      className="join-secondary lobby-action"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        worldDetail?.worldId === w.id ? closeWorldDetail() : manage(w.id)
                      }
                    >
                      {worldDetail?.worldId === w.id ? 'Fechar' : 'Gerenciar'}
                    </button>
                  )}
                  {w.binding && (
                    <button
                      className="join-secondary lobby-action"
                      type="button"
                      onClick={() => editEntry(w)}
                      title="Trocar seu nome, cor ou personagem neste mundo"
                    >
                      Editar
                    </button>
                  )}
                  <button
                    className="join-button lobby-action"
                    type="button"
                    disabled={full}
                    onClick={() => enter(w)}
                  >
                    {full ? 'Cheio' : 'Entrar'}
                  </button>
                </div>

                {worldDetail?.worldId === w.id && (
                  <WorldAdmin
                    world={w}
                    detail={worldDetail}
                    busy={busy}
                    onUpdate={(patch) => updateWorld(w.id, patch)}
                    onArchive={() => void archive(w.id)}
                    onRemoveMember={(profileId) => removeMember(w.id, profileId)}
                    onRevokeInvite={revokeInvite}
                    onSetRole={(profileId, role) => setRole(w.id, profileId, role)}
                    onTransferOwner={(profileId) => transferOwner(w.id, profileId)}
                    onClose={closeWorldDetail}
                  />
                )}
              </div>
            );
          })}
        </section>

        <section className="lobby-section">
          {!showCreate ? (
            <button className="join-secondary" type="button" onClick={() => setShowCreate(true)}>
              Criar um mundo
            </button>
          ) : (
            <form
              className="lobby-create"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <h2 className="lobby-title">Novo mundo</h2>

              <label className="join-label" htmlFor="world-name">
                Nome
              </label>
              <input
                id="world-name"
                className="join-input"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Escritório do time"
                maxLength={40}
                autoFocus
              />

              <span className="join-label">Cenário</span>
              <div className="scenario-row">
                {Object.values(SCENARIOS).map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    className={`scenario-card${sc.id === newScenario ? ' selected' : ''}`}
                    onClick={() => setNewScenario(sc.id)}
                  >
                    <span className="scenario-emoji">{SCENARIO_EMOJI[sc.id]}</span>
                    <span className="scenario-name">{sc.label}</span>
                  </button>
                ))}
              </div>

              <label className="join-label" htmlFor="world-capacity">
                Lotação (vazio = sem limite)
              </label>
              <input
                id="world-capacity"
                className="join-input"
                value={newCapacity}
                onChange={(e) => setNewCapacity(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="ex.: 8"
                inputMode="numeric"
              />

              <button className="join-button" type="submit" disabled={busy || !newName.trim()}>
                {busy ? 'Criando…' : 'Criar'}
              </button>
              <button
                className="join-secondary"
                type="button"
                onClick={() => setShowCreate(false)}
              >
                Cancelar
              </button>

              <p className="join-hint">
                Mundo novo nasce <strong>restrito</strong>: só entra quem você adicionar pelo
                ID.
              </p>
            </form>
          )}
        </section>

        {myId && (
          <section className="lobby-section">
            <span className="join-label">Seu ID</span>
            <p className="join-hint">
              Passe este ID para quem administra o mundo em que você quer entrar. Ele não dá
              acesso a nada por si só — só diz quem você é.
            </p>
            <div className="lobby-invite">
              <input className="join-input" value={myId} readOnly onFocus={(e) => e.target.select()} />
              <button
                className="join-secondary lobby-action"
                type="button"
                onClick={copyMyId}
              >
                {copied ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </section>
        )}

        <button className="join-secondary" type="button" onClick={() => void signOut()}>
          Sair da conta
        </button>
      </div>
    </div>
  );
}
