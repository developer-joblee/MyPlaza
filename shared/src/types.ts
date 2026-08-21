import type { CharacterId } from './constants';
import type { ScenarioId } from './scenarios';

export interface PlayerState {
  id: string;
  name: string;
  color: number;
  /** qual boneco desenhar; é por aqui que os outros clientes descobrem */
  character: CharacterId;
  x: number;
  y: number;
  /**
   * Está sentado? A **direção** não vem por aqui de propósito: ela sai do tile
   * de cadeira sob o jogador (`sitFacingAt`), que todo cliente já tem, então
   * não há como a pose divergir do cenário. O que precisa vir pela rede é só
   * isto — sem a flag, um remoto interpolando por cima de um tile de cadeira
   * apareceria sentado de relance.
   */
  sitting: boolean;
  /** ausente: sem microfone, sem áudio, e o avatar aparece no celular */
  away: boolean;
  /**
   * Em qual **booble** esta pessoa está; `null` = nenhuma. Uma booble *é* o
   * conjunto de players que compartilham este id — não existe entidade separada
   * no servidor, de propósito: com uma lista paralela haveria duas fontes de
   * verdade para dessincronizar, e o snapshot já carrega os players.
   *
   * Efêmero como o `away`: o id é gerado pelo servidor, morre com a conexão e
   * **não** é persistido no banco. Quem cai e volta é um `socket.id` novo, logo
   * uma pessoa nova sem booble — o que é o certo, porque a booble pressupõe
   * estar perto de alguém agora.
   */
  boobleId: string | null;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
}

/**
 * Resposta do servidor ao pedido de credenciais de voz. O cliente não manda
 * nada no pedido: `identity` e `room` são derivados no servidor a partir do
 * socket, então um cliente não escolhe em que sala entra nem com que identidade.
 */
export type VoiceTokenResponse =
  | { ok: true; url: string; token: string; room: string; identity: string }
  | {
      ok: false;
      /** `socket-down` e `timeout` são do cliente; o servidor nunca os emite */
      reason: 'not-configured' | 'not-joined' | 'rate-limited' | 'error' | 'socket-down' | 'timeout';
      /** quando recusado por limite: quanto esperar, em ms (o cliente não precisa adivinhar) */
      retryAfterMs?: number;
    };

/**
 * Por que a entrada no mundo foi recusada. O cliente traduz para uma frase; o
 * servidor nunca manda texto livre, para a mensagem não virar canal de
 * vazamento (ex.: "essa empresa existe, você é que não é membro").
 */
export type JoinDeniedReason =
  /** o servidor exige login e o socket chegou sem token */
  | 'auth-required'
  /** token inválido, vencido, revogado — ou o Supabase não respondeu */
  | 'invalid-token'
  /** conta válida, mas sem convite pendente para este e-mail */
  | 'no-invite'
  /** membership existe mas não está ativa (convidada ou suspensa) */
  | 'no-membership'
  /** local restrito e a pessoa não está na lista */
  | 'place-restricted'
  /** lotação cheia */
  | 'place-full'
  /** o cliente não disse em qual mundo quer entrar (o lobby é quem escolhe) */
  | 'no-world'
  /** o mundo não existe (foi apagado depois de listado) */
  | 'no-place'
  /** falha nossa (banco fora do ar no meio do processo) */
  | 'error';

// -----------------------------------------------------------------------------
// Lobby: escolher, criar e ser convidado para mundos, antes de entrar em um.
// -----------------------------------------------------------------------------

/**
 * Meu papel num mundo.
 *
 * - `owner`  — criou o mundo (`places.created_by`). Único que arquiva e que
 *              passa a propriedade adiante.
 * - `host`   — administra: convida, edita, tira membro, define papel de membro.
 * - `member` — só entra.
 *
 * `owner` não é um valor de `place_members.role`: ele é derivado de
 * `created_by`, justamente para a propriedade não poder ser perdida por uma
 * edição de papel.
 */
export type WorldRole = 'owner' | 'host' | 'member';

/** Papel gravável em `place_members.role` — `owner` não entra aqui. */
export type AssignableWorldRole = 'host' | 'member';

/**
 * Como EU entro num mundo específico: o vínculo, guardado no banco
 * (`presence_state`, uma linha por local × perfil).
 *
 * É por mundo, e não por conta, de propósito: a mesma pessoa pode ser "Iago" no
 * mundo do time e "Iago (Joblee)" no mundo de um cliente. `null` no
 * `WorldSummary` significa "nunca entrei neste mundo" — e é só isso que faz a
 * tela de entrada aparecer.
 */
export interface WorldBinding {
  name: string;
  color: number;
  character: CharacterId;
}

/** Um mundo na lista do lobby. */
export interface WorldSummary {
  id: string;
  name: string;
  /** qual mapa este mundo usa — o cliente NÃO escolhe mais, o mundo define */
  scenarioId: ScenarioId;
  /** 'organization' = todo membro entra; 'restricted' = só quem está na lista */
  visibility: 'organization' | 'restricted';
  /** teto de pessoas ao mesmo tempo; null = sem limite */
  capacity: number | null;
  /** quantas pessoas estão dentro AGORA (contado em memória no servidor) */
  online: number;
  /** meu papel aqui — é o que habilita (ou não) os botões de administrar */
  myRole: WorldRole;
  organizationName: string;
  /**
   * Meu vínculo com este mundo: como eu me chamo aqui, e com que aparência.
   * `null` = nunca entrei neste mundo, então a tela de entrada precisa
   * perguntar. Com vínculo, clicar em "Entrar" vai direto para o jogo.
   */
  binding: WorldBinding | null;
}

/**
 * Convite pendente para o e-mail de quem está logado.
 *
 * **Dormente.** Enquanto não houver domínio para enviar e-mail, ninguém é
 * convidado por e-mail — quem administra um mundo adiciona a pessoa pelo ID
 * dela (`lobby:addMember`). O tipo e o caminho de aceite ficam porque são a
 * volta para o convite por e-mail quando o envio existir; a lista simplesmente
 * chega vazia. Ver `docs/features/autenticacao-e-acesso.md`.
 */
export interface PendingInvite {
  id: string;
  /** nome do mundo, ou null quando o convite é para a empresa toda */
  worldName: string | null;
  organizationName: string;
  scenarioId: ScenarioId | null;
}

export interface LobbyState {
  worlds: WorldSummary[];
  invites: PendingInvite[];
  /**
   * O ID desta pessoa — é o que ela passa a quem administra um mundo para ser
   * adicionada. Vem do servidor porque o cliente **não** pode saber o próprio
   * `profiles.id` de outra forma (o `join` deixou de carregar identidade), e é
   * seguro exibir: por si só ele não dá acesso a nada, só nomeia quem já tem
   * conta. Quem decide o acesso é quem administra o mundo.
   */
  myId: string;
  /**
   * A última aparência que esta pessoa usou, vinda de `profiles`.
   *
   * Não é o vínculo de nenhum mundo — é o **prefill** da tela de entrada quando
   * ela entra num mundo onde ainda não tem vínculo (`binding: null`). Sem isto,
   * um mundo novo abriria a tela com o campo de nome vazio depois de cada
   * logout, que é exatamente a chateação que o vínculo existe para remover.
   *
   * Separado de `myId` porque as duas coisas não têm nada a ver: `myId` é o
   * identificador que se compartilha, `me` é aparência que se edita.
   */
  me: WorldBinding;
}

/** Quem tem acesso a um mundo. Só quem administra vê esta lista. */
export interface WorldMember {
  profileId: string;
  name: string;
  role: AssignableWorldRole;
  /** é quem criou o mundo — não pode ser removido nem ter o papel mudado */
  owner: boolean;
}

/** Convite que EU mandei e ninguém aceitou ainda. **Dormente** — ver `PendingInvite`. */
export interface SentInvite {
  id: string;
  email: string;
  expiresAt: number;
}

/** Painel de gerenciamento de um mundo. Só dono e host recebem. */
export interface WorldDetail {
  worldId: string;
  members: WorldMember[];
  invites: SentInvite[];
}

/** Campos editáveis de um mundo. Ausente = não mexe. */
export interface WorldPatch {
  name?: string;
  /** null = sem limite */
  capacity?: number | null;
  visibility?: 'organization' | 'restricted';
}

export type LobbyErrorReason =
  /**
   * `socket-down` e `timeout` são do CLIENTE; o servidor nunca os emite — mesma
   * convenção do `VoiceTokenResponse` acima. Ficam no mesmo union em vez de num
   * resultado de transporte separado porque aninhar dois `ok` (`res.ok &&
   * res.value.ok`) só transferiria a checagem para cada chamador.
   */
  | 'socket-down'
  | 'timeout'
  /** o servidor não tem Supabase: não existe lobby, só o modo anônimo */
  | 'not-configured'
  | 'auth-required'
  | 'invalid-token'
  /** nome de mundo vazio, longo demais, ou ID de pessoa malformado */
  | 'invalid-input'
  /** não é dono do mundo (só quem administra adiciona gente) */
  | 'not-allowed'
  /** o mundo, o convite ou o ID da pessoa não existe (ou não é seu) */
  | 'not-found'
  | 'error';

/**
 * Resposta de qualquer operação do lobby. Sempre por ack, e sempre com o
 * estado novo em caso de sucesso — assim a tela não precisa refazer o `list`
 * depois de criar, convidar ou aceitar.
 */
export type LobbyResult =
  /**
   * `detail` vem junto nas operações de gerenciamento (abrir o painel, editar,
   * tirar membro, revogar convite): elas mudam as duas coisas ao mesmo tempo, e
   * duas idas ao servidor deixariam metade da tela velha.
   */
  | { ok: true; state: LobbyState; detail?: WorldDetail }
  | { ok: false; reason: LobbyErrorReason };

// -----------------------------------------------------------------------------
// Soundboard: sons curtos, do próprio usuário, tocados para quem está por perto.
// A quantidade de sons é conquistada pelo tempo na plataforma (`levels.ts`).
// -----------------------------------------------------------------------------

/**
 * Um som meu. **Não** carrega os bytes: carrega a URL assinada com que o
 * navegador de quem ouve baixa o arquivo uma vez e guarda em cache.
 *
 * `url` é temporária por desenho — o bucket é privado, e é o servidor que assina
 * (mesmo padrão do token do LiveKit). Quem recebe não deve persistir essa
 * string: ela vence, e o `soundId` é a identidade estável.
 */
export interface UserSound {
  id: string;
  /** Posição na grade, 1..`SOUND_MAX_SLOTS`. */
  slot: number;
  label: string;
  /** URL assinada de leitura, válida por algumas horas. */
  url: string;
  /** Medida no navegador de quem subiu (o servidor não decodifica áudio). */
  durationMs: number;
}

/**
 * Todo o estado do soundboard de quem pediu: o que já tem e o que falta para o
 * próximo slot. Vem inteiro em toda resposta de sucesso, como no lobby — a tela
 * nunca precisa refazer o `list` depois de subir ou remover.
 */
export interface SoundboardState {
  sounds: UserSound[];
  /**
   * Volume com que EU ouço o soundboard, 0..`SOUND_VOLUME_MAX`.
   *
   * Preferência **persistida no perfil**, e por isso vem no estado em vez de
   * viver só no navegador: quem baixou o volume porque a equipe abusa não quer
   * refazer isso em cada máquina. O mute rápido é outra coisa e continua local —
   * ver `soundboardMuted` no store do cliente.
   */
  volume: number;
  /** Tempo acumulado na plataforma, em segundos (`profiles.presence_seconds`). */
  presenceSeconds: number;
  /** Slots liberados por esse tempo — `slotsFor(presenceSeconds)`. */
  slots: number;
  /** Nível atual (`null` = ainda não alcançou o primeiro marco). */
  level: number | null;
  /** Rótulo do nível atual, para a tela não reimplementar a busca na tabela. */
  levelLabel: string | null;
  /** Segundos até o próximo marco; `0` quando já está no último. */
  secondsToNext: number;
  /** Quantos slots o próximo marco dá; `null` quando já está no último. */
  nextSlots: number | null;
}

export type SoundboardErrorReason =
  /** `socket-down` e `timeout` são do CLIENTE — mesma convenção do `LobbyResult`. */
  | 'socket-down'
  | 'timeout'
  /** o servidor não tem Supabase: sem Storage e sem tempo acumulado, sem soundboard */
  | 'not-configured'
  | 'auth-required'
  | 'invalid-token'
  /** nome vazio/longo demais, slot fora da faixa, id malformado */
  | 'invalid-input'
  /** o tempo acumulado ainda não libera esse slot */
  | 'not-unlocked'
  /** passou de `SOUND_MAX_BYTES` */
  | 'too-large'
  /** MIME fora da whitelist, ou o arquivo não é áudio decodificável */
  | 'bad-format'
  /**
   * O som não existe, ou não é seu.
   *
   * Não existe um `slot-taken` aqui de propósito: subir num slot ocupado
   * **substitui** o som (o caminho no Storage é derivado do slot, e a linha é
   * upsert por `(profile_id, slot)`). Recusar exigiria remover antes para
   * trocar, o que é um passo a mais para o caso comum — e deixaria arquivo
   * órfão se a remoção falhasse no meio.
   */
  | 'not-found'
  | 'error';

/** Resposta das operações do soundboard. Sucesso devolve o estado novo inteiro. */
export type SoundboardResult =
  | { ok: true; state: SoundboardState }
  | { ok: false; reason: SoundboardErrorReason };

/**
 * O quanto EU ouço UMA pessoa — a voz dela e os sons de soundboard dela, em
 * escalas independentes de 0 a `PEER_VOLUME_MAX`.
 *
 * É preferência de quem OUVE, não propriedade de quem fala: dois clientes na
 * mesma sala têm mapas diferentes para a mesma pessoa, e é isso que a feature
 * promete ("para mim o Bruno é 50%"). Por isso ela nunca é difundida — cada
 * cliente recebe só o próprio mapa.
 *
 * Os dois campos são separados porque respondem a incômodos diferentes: "a voz
 * dela estoura no meu fone" não é "os sons dela me interrompem".
 */
export interface PeerAudioPrefs {
  /** multiplica o volume da VOZ dela (a geometria decide o resto) */
  voice: number;
  /** multiplica o volume dos SONS de soundboard dela */
  sound: number;
}

/**
 * Mapa de preferências chaveado por **`socket.id`** — não por perfil.
 *
 * O servidor guarda por perfil (é o que faz o ajuste sobreviver ao F5) e
 * **traduz** para socket ao enviar, porque é assim que o cliente chaveia tudo:
 * roster, distâncias, participantes do LiveKit, `mutedSenders`. Traduzir num
 * lugar só evita que o `profileId` de terceiros entre no protocolo por uma razão
 * que não pede isso.
 *
 * Sempre **parcial**: quem não está no mapa está no default (cheio).
 */
export type PeerAudioMap = Record<string, PeerAudioPrefs>;

export type PeerAudioErrorReason =
  /** `socket-down` e `timeout` são do CLIENTE — mesma convenção do `SoundboardResult`. */
  | 'socket-down'
  | 'timeout'
  /** o servidor não tem Supabase: dá para ajustar na sessão, mas não para salvar */
  | 'not-configured'
  | 'auth-required'
  | 'invalid-token'
  /** alvo malformado, alvo = eu mesmo, volume fora de 0..`PEER_VOLUME_MAX` */
  | 'invalid-input'
  /** o alvo não está neste mundo (ou saiu antes do pedido chegar) */
  | 'not-found'
  | 'error';

/**
 * Resposta de `audio:setPeer`. Sucesso é vazio de propósito: o cliente já
 * aplicou o valor localmente antes de pedir (é um slider), então devolver o
 * estado só criaria a chance de a tela pular para trás.
 */
export type PeerAudioResult = { ok: true } | { ok: false; reason: PeerAudioErrorReason };
