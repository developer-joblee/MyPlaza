import { useState } from 'react';
import type {
  AssignableWorldRole,
  WorldDetail,
  WorldPatch,
  WorldSummary,
} from '@together/shared';

/**
 * Painel de gerenciamento de um mundo, dentro do cartão do lobby. Chegam aqui o
 * dono e quem ele promoveu a **host** — e o servidor confere o papel em toda
 * operação, porque esconder o botão não é controle de acesso.
 *
 * O que é só do dono (arquivar, passar a propriedade, mexer em outro host) fica
 * escondido para host, mas a recusa de verdade vem do servidor.
 *
 * As ações destrutivas (tirar membro, arquivar) usam confirmação em **dois
 * cliques no próprio botão**, em vez de `window.confirm`: o repo não tem sistema
 * de modal, e um `confirm()` nativo quebra o visual e não é estilizável.
 */
export function WorldAdmin({
  world,
  detail,
  busy,
  onUpdate,
  onArchive,
  onRemoveMember,
  onRevokeInvite,
  onSetRole,
  onTransferOwner,
  onClose,
}: {
  world: WorldSummary;
  detail: WorldDetail;
  busy: boolean;
  onUpdate: (patch: WorldPatch) => void;
  onArchive: () => void;
  onRemoveMember: (profileId: string) => void;
  onRevokeInvite: (inviteId: string) => void;
  onSetRole: (profileId: string, role: AssignableWorldRole) => void;
  onTransferOwner: (profileId: string) => void;
  onClose: () => void;
}) {
  const isOwner = world.myRole === 'owner';
  const [name, setName] = useState(world.name);
  const [capacity, setCapacity] = useState(world.capacity === null ? '' : String(world.capacity));
  const [confirming, setConfirming] = useState<string | null>(null);

  const nameChanged = name.trim() !== '' && name.trim() !== world.name;
  const capacityValue = capacity.trim() === '' ? null : Number(capacity);
  const capacityChanged = capacityValue !== world.capacity;

  /** Um clique arma, o segundo executa. Qualquer outro clique desarma. */
  const armed = (key: string) => confirming === key;
  const arm = (key: string, run: () => void) => {
    if (armed(key)) {
      setConfirming(null);
      run();
    } else {
      setConfirming(key);
    }
  };

  return (
    <div className="world-admin">
      <div className="world-admin-head">
        <h3 className="lobby-title">
          Gerenciar “{world.name}”
          {!isOwner && <span className="lobby-meta"> · você administra</span>}
        </h3>
        <button className="join-secondary lobby-action" type="button" onClick={onClose}>
          Fechar
        </button>
      </div>

      <label className="join-label" htmlFor={`name-${world.id}`}>
        Nome
      </label>
      <div className="lobby-invite">
        <input
          id={`name-${world.id}`}
          className="join-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
        />
        <button
          className="join-secondary lobby-action"
          type="button"
          disabled={busy || !nameChanged}
          onClick={() => onUpdate({ name: name.trim() })}
        >
          Salvar
        </button>
      </div>

      <label className="join-label" htmlFor={`cap-${world.id}`}>
        Lotação (vazio = sem limite) · {world.online} dentro agora
      </label>
      <div className="lobby-invite">
        <input
          id={`cap-${world.id}`}
          className="join-input"
          value={capacity}
          onChange={(e) => setCapacity(e.target.value.replace(/[^0-9]/g, ''))}
          placeholder="sem limite"
          inputMode="numeric"
        />
        <button
          className="join-secondary lobby-action"
          type="button"
          disabled={busy || !capacityChanged}
          onClick={() => onUpdate({ capacity: capacityValue })}
        >
          Salvar
        </button>
      </div>
      {capacityValue !== null && capacityValue < world.online && (
        <p className="lobby-meta">
          Menor que as {world.online} pessoas que já estão dentro — ninguém é expulso, o limite
          vale para quem entrar depois.
        </p>
      )}

      <span className="join-label">Quem entra</span>
      <div className="lobby-invite">
        <button
          className={`scenario-card${world.visibility === 'restricted' ? ' selected' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => onUpdate({ visibility: 'restricted' })}
        >
          <span className="scenario-name">Só quem eu adicionar</span>
        </button>
        <button
          className={`scenario-card${world.visibility === 'organization' ? ' selected' : ''}`}
          type="button"
          disabled={busy}
          onClick={() => onUpdate({ visibility: 'organization' })}
        >
          <span className="scenario-name">Toda a empresa</span>
        </button>
      </div>

      <span className="join-label">Com acesso ({detail.members.length})</span>
      {detail.members.length === 0 && <p className="lobby-meta">Ninguém além de você.</p>}
      {detail.members.map((m) => {
        // host não mexe em outro host: é regra do servidor, refletida aqui
        const canEdit = !m.owner && (isOwner || m.role !== 'host');
        return (
          <div key={m.profileId} className="lobby-row">
            <div className="lobby-row-main">
              <strong>{m.name}</strong>
              <span className="lobby-meta">
                {m.owner ? 'dono · criou este mundo' : m.role === 'host' ? 'administra' : 'convidado'}
              </span>
            </div>

            {canEdit && (
              <div className="lobby-row-actions">
                <button
                  className="join-secondary lobby-action"
                  type="button"
                  disabled={busy}
                  onClick={() => onSetRole(m.profileId, m.role === 'host' ? 'member' : 'host')}
                >
                  {m.role === 'host' ? 'Rebaixar' : 'Tornar admin'}
                </button>

                {isOwner && (
                  <button
                    className="join-secondary lobby-action"
                    type="button"
                    disabled={busy}
                    onClick={() => arm(`owner:${m.profileId}`, () => onTransferOwner(m.profileId))}
                  >
                    {armed(`owner:${m.profileId}`) ? 'Confirmar: passar a dono?' : 'Passar a dono'}
                  </button>
                )}

                <button
                  className="join-secondary lobby-action"
                  type="button"
                  disabled={busy}
                  onClick={() => arm(`member:${m.profileId}`, () => onRemoveMember(m.profileId))}
                >
                  {armed(`member:${m.profileId}`) ? 'Confirmar?' : 'Tirar'}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {detail.invites.length > 0 && (
        <>
          <span className="join-label">Convites pendentes ({detail.invites.length})</span>
          {detail.invites.map((inv) => (
            <div key={inv.id} className="lobby-row">
              <div className="lobby-row-main">
                <strong>{inv.email}</strong>
                <span className="lobby-meta">
                  expira em {new Date(inv.expiresAt).toLocaleDateString('pt-BR')}
                </span>
              </div>
              <button
                className="join-secondary lobby-action"
                type="button"
                disabled={busy}
                onClick={() => onRevokeInvite(inv.id)}
              >
                Cancelar
              </button>
            </div>
          ))}
        </>
      )}

      {isOwner && (
        <>
          <button
            className="join-secondary world-archive"
            type="button"
            disabled={busy}
            onClick={() => arm('archive', onArchive)}
          >
            {armed('archive')
              ? 'Confirmar: arquivar e desconectar quem está dentro?'
              : 'Arquivar este mundo'}
          </button>
          <p className="join-hint">
            Arquivar tira o mundo do lobby e bloqueia a entrada. O histórico de conversa e de
            presença continua no banco — não é exclusão. Passar a dono mantém você como
            administrador.
          </p>
        </>
      )}
    </div>
  );
}
