import {
  AVATAR_COLORS,
  CHAT_HISTORY_LIMIT,
  DEFAULT_APPEARANCE,
  DEFAULT_CHARACTER,
  DEFAULT_SCENARIO,
  LEGACY_CHARACTER_APPEARANCE,
  isAppearance,
  isCharacterId,
  isScenarioId,
  type Appearance,
  type CharacterId,
  type ChatMessage,
  type PlacedFurniture,
  type AssignableWorldRole,
  type PendingInvite,
  SOUND_VOLUME_DEFAULT,
  clampPeerVolume,
  clampVolume,
  type PeerAudioPrefs,
  type ScenarioId,
  type SentInvite,
  type UserSound,
  type WorldDetail,
  type WorldBinding,
  type WorldMember,
  type WorldPatch,
  type WorldRole,
  type WorldSummary,
} from '@together/shared';
import { ORG_SLUG, client, dedupe, guard } from './supabase';

/**
 * Tudo que lê e escreve nas TABELAS. Conexão, timeout e dedupe vivem em
 * `supabase.ts`; verificação de login, em `auth.ts`.
 */

/**
 * A escada de leitura da aparência, aplicada em TODO lugar que lê linha com
 * `appearance`/`character_id`: jsonb válido > tradução do personagem legado
 * (linhas de antes da 0014) > padrão. Nunca devolve null — ninguém entra sem
 * aparência, nem com o banco em qualquer estado.
 */
function toAppearance(raw: unknown, characterId: unknown): Appearance {
  if (isAppearance(raw)) return raw;
  return isCharacterId(characterId)
    ? LEGACY_CHARACTER_APPEARANCE[characterId]
    : DEFAULT_APPEARANCE;
}

// -----------------------------------------------------------------------------
// Resolução de empresa e local.
//
// `scenario_id` do jogo -> `places.id` do banco. O resultado é cacheado em
// memória (inclusive o negativo) porque não muda em runtime, e um `join` não
// deve custar duas consultas a mais. `inFlight` evita que dez pessoas entrando
// juntas disparem dez vezes a mesma busca.
// -----------------------------------------------------------------------------
let orgIdCache: string | null | undefined;

async function resolveOrgId(): Promise<string | null> {
  if (orgIdCache !== undefined) return orgIdCache;
  return dedupe('org', async () => {
    const id = await guard<string | null>(
      'resolveOrgId',
      async () => {
        const { data, error } = await client!
          .from('organizations')
          .select('id')
          .eq('slug', ORG_SLUG)
          .maybeSingle();
        if (error) throw error;
        return (data?.id as string | undefined) ?? null;
      },
      null,
    );
    if (id === null) {
      console.warn(`[db] empresa "${ORG_SLUG}" não existe — rode db/seed.sql`);
    }
    orgIdCache = id;
    return id;
  });
}

/**
 * `places.scenario_id` como `ScenarioId`, caindo no padrão quando o banco tem um
 * cenário que o código não conhece mais.
 *
 * Existe porque a lista de cenários encolheu (só o Estúdio ficou) e o banco NÃO
 * encolhe junto: um mundo criado na Praça continua com `scenario_id = 'plaza'`
 * até a `0013` rodar. Sem isto o cast mentia, e a mentira estourava longe daqui
 * — `parseMap` num `SCENARIOS[id]` undefined no `join`, e um `.label` de
 * undefined no render do lobby. A `0013` conserta os dados; isto conserta o
 * caminho de quem ainda não rodou a migração, e continua valendo para qualquer
 * cenário que saia no futuro.
 */
function toScenarioId(raw: unknown, where: string): ScenarioId {
  if (isScenarioId(raw)) return raw;
  console.warn(`[db] ${where}: cenário "${String(raw)}" não existe mais — usando ${DEFAULT_SCENARIO} (rode a 0013)`);
  return DEFAULT_SCENARIO;
}

/** O local, com o que o controle de acesso precisa saber sobre ele. */
export interface PlaceRef {
  id: string;
  organizationId: string;
  /** 'organization' = aberto a quem tem membership; 'restricted' = lista */
  visibility: 'organization' | 'restricted';
  /** teto de pessoas dentro ao mesmo tempo; null = sem limite */
  capacity: number | null;
  /**
   * Quem criou. Vem junto para o portão do `join` poder deixar o dono entrar no
   * próprio mundo restrito sem uma consulta a mais — e sem depender de ele
   * continuar em `place_members`, de onde ele poderia ter saído.
   */
  createdBy: string | null;
  /** arquivado = não existe mais para quem usa (ver 0006) */
  archivedAt: string | null;
}

const placeCache = new Map<ScenarioId, PlaceRef | null>();

/** Local correspondente a este cenário nesta empresa, ou null. */
export async function resolvePlace(scenarioId: ScenarioId): Promise<PlaceRef | null> {
  if (!client) return null;
  const cached = placeCache.get(scenarioId);
  if (cached !== undefined) return cached;
  return dedupe(`place:${scenarioId}`, async () => {
    const orgId = await resolveOrgId();
    if (!orgId) return null;
    const place = await guard<PlaceRef | null>(
      'resolvePlace',
      async () => {
        const { data, error } = await client!
          .from('places')
          .select('id, organization_id, visibility, capacity, created_by, archived_at')
          .eq('organization_id', orgId)
          .eq('scenario_id', scenarioId)
          .is('archived_at', null)
          .order('is_default', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (!data) return null;
        return {
          id: data.id as string,
          organizationId: data.organization_id as string,
          visibility: data.visibility as PlaceRef['visibility'],
          capacity: (data.capacity as number | null) ?? null,
          createdBy: (data.created_by as string | null) ?? null,
          archivedAt: (data.archived_at as string | null) ?? null,
        };
      },
      null,
    );
    if (place === null) {
      console.warn(`[db] cenário "${scenarioId}" sem local em "${ORG_SLUG}" — rode db/seed.sql`);
    }
    placeCache.set(scenarioId, place);
    return place;
  });
}

// -----------------------------------------------------------------------------
// Acesso: perfil da conta, membership e convite.
//
// Estas quatro funções são o portão. Toda uma delas pode devolver null, e null
// sempre significa "não entra" — nunca "entra sem verificar".
// -----------------------------------------------------------------------------

/**
 * O perfil desta conta, criando na primeira vez.
 *
 * A chave é `auth_user_id`, não `profiles.id`: o id interno é nosso e estável, o
 * id da conta é do Supabase Auth. Foi para permitir exatamente isto que os dois
 * nasceram separados (ver "Decisões" no doc da feature).
 *
 * Nome, cor e personagem escolhidos na tela de entrada sobrescrevem o perfil a
 * cada login — a tela é a fonte de verdade dessas três coisas.
 */
export async function findOrCreateProfile(
  authUserId: string,
  displayName: string,
  avatarColor: number,
  characterId: CharacterId,
  appearance: Appearance,
): Promise<string | null> {
  return guard<string | null>(
    'findOrCreateProfile',
    async () => {
      const { data: found, error: findErr } = await client!
        .from('profiles')
        .select('id')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (findErr) throw findErr;

      if (found?.id) {
        const { error } = await client!
          .from('profiles')
          .update({
            display_name: displayName,
            avatar_color: avatarColor,
            character_id: characterId,
            appearance,
            last_seen_at: new Date().toISOString(),
          })
          .eq('id', found.id as string);
        if (error) throw error;
        return found.id as string;
      }

      const { data: created, error: insErr } = await client!
        .from('profiles')
        .insert({
          auth_user_id: authUserId,
          display_name: displayName,
          avatar_color: avatarColor,
          character_id: characterId,
          appearance,
          last_seen_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (insErr) throw insErr;
      return (created?.id as string | undefined) ?? null;
    },
    null,
  );
}

export interface MembershipRef {
  role: string;
  status: 'invited' | 'active' | 'suspended';
}

export async function findMembership(
  organizationId: string,
  profileId: string,
): Promise<MembershipRef | null> {
  return guard<MembershipRef | null>(
    'findMembership',
    async () => {
      const { data, error } = await client!
        .from('memberships')
        .select('role, status')
        .eq('organization_id', organizationId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { role: data.role as string, status: data.status as MembershipRef['status'] };
    },
    null,
  );
}

/**
 * Aceita um convite pendente para este e-mail nesta empresa e devolve a
 * membership criada. É o único caminho de entrada de gente nova: sem convite,
 * uma conta nova do Supabase Auth não vira membro de nada.
 *
 * O `token` do convite NUNCA é lido nem logado aqui — a busca é por e-mail. O
 * token existe para link de convite, que é outra história (ainda não construída).
 */
/**
 * **Dormente.** Aceite automático de convite pendente pelo e-mail de quem
 * entrou. Saiu do portão em `handlers.ts` quando a confirmação de e-mail foi
 * desligada: sem verificação, quem se cadastrasse com o e-mail de outra pessoa
 * herdaria o convite dela. Volta junto com o envio de e-mail.
 */
export async function acceptInvite(
  organizationId: string,
  email: string | null,
  profileId: string,
): Promise<MembershipRef | null> {
  if (!email) return null;
  return guard<MembershipRef | null>(
    'acceptInvite',
    async () => {
      const now = new Date().toISOString();
      const { data: invite, error: findErr } = await client!
        .from('invites')
        .select('id, role')
        .eq('organization_id', organizationId)
        .eq('email', email.toLowerCase())
        .is('accepted_at', null)
        .gt('expires_at', now)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!invite) return null;

      const role = (invite.role as string) ?? 'member';
      const { error: memErr } = await client!.from('memberships').upsert(
        {
          organization_id: organizationId,
          profile_id: profileId,
          role,
          status: 'active',
          joined_at: now,
        },
        { onConflict: 'organization_id,profile_id' },
      );
      if (memErr) throw memErr;

      // marca aceito só depois de a membership existir: se cair no meio, o
      // convite continua válido e a pessoa tenta de novo
      const { error: invErr } = await client!
        .from('invites')
        .update({ accepted_at: now, accepted_by: profileId })
        .eq('id', invite.id as string)
        .is('accepted_at', null);
      if (invErr) throw invErr;

      console.log(`[db] convite aceito -> perfil ${profileId} entrou como ${role}`);
      return { role, status: 'active' };
    },
    null,
  );
}

/** Está na lista de um local restrito? */
export async function isPlaceMember(placeId: string, profileId: string): Promise<boolean> {
  return guard(
    'isPlaceMember',
    async () => {
      const { data, error } = await client!
        .from('place_members')
        .select('profile_id')
        .eq('place_id', placeId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Posição (o "onde parou")
// -----------------------------------------------------------------------------

export interface SavedPosition {
  x: number;
  y: number;
  sitting: boolean;
}

/**
 * Onde a pessoa estava neste local na última vez. NÃO devolve `away`: voltar de
 * uma queda de internet aparecendo ausente para todos é pior que o contrário —
 * quem estava ausente de propósito tem o próprio cliente reafirmando isso no
 * `connect` (ver `GameView.tsx`).
 */
export async function loadPosition(
  placeId: string,
  profileId: string,
): Promise<SavedPosition | null> {
  return guard<SavedPosition | null>(
    'loadPosition',
    async () => {
      const { data, error } = await client!
        .from('presence_state')
        .select('x, y, sitting')
        .eq('place_id', placeId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return { x: Number(data.x), y: Number(data.y), sitting: Boolean(data.sitting) };
    },
    null,
  );
}

/**
 * Grava a posição **e o vínculo** (nome, cor, personagem) desta pessoa neste
 * mundo. É a mesma linha e a mesma escrita: `presence_state` já era uma por
 * (local, perfil) e já guardava `character_id`, então nome e cor não custam
 * consulta nem tabela nova — ver `db/migrations/0009_world_binding.sql`.
 *
 * É por isso que `handlers.ts` chama isto **na entrada** e não só no primeiro
 * passo: quem entra e sai na mesma hora precisa sair com o vínculo gravado,
 * senão o mundo pergunta o nome de novo na próxima vez.
 */
export async function savePosition(
  placeId: string,
  profileId: string,
  state: {
    x: number;
    y: number;
    sitting: boolean;
    away: boolean;
    appearance: Appearance;
    /** legado: só para a coluna `character_id` (FK/NOT NULL) — ver 0014 */
    character: CharacterId;
    name: string;
    color: number;
  },
): Promise<void> {
  await guard(
    'savePosition',
    async () => {
      const { error } = await client!.from('presence_state').upsert(
        {
          place_id: placeId,
          profile_id: profileId,
          x: state.x,
          y: state.y,
          sitting: state.sitting,
          away: state.away,
          character_id: state.character,
          appearance: state.appearance,
          display_name: state.name,
          avatar_color: state.color,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'place_id,profile_id' },
      );
      if (error) throw error;
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Móveis dinâmicos (editor de móveis) — ver shared/src/furniture.ts e a 0016.
// Fail-soft como tudo aqui: sem banco, o editor funciona só em memória.
// -----------------------------------------------------------------------------

export async function loadWorldFurniture(placeId: string): Promise<PlacedFurniture[]> {
  return guard<PlacedFurniture[]>(
    'loadWorldFurniture',
    async () => {
      const { data, error } = await client!
        .from('world_furniture')
        .select('id, furniture_id, tile_x, tile_y, rotation')
        .eq('place_id', placeId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        furnitureId: r.furniture_id as PlacedFurniture['furnitureId'],
        tileX: Number(r.tile_x),
        tileY: Number(r.tile_y),
        rotation: Number(r.rotation ?? 0),
      }));
    },
    [],
  );
}

export async function insertWorldFurniture(
  placeId: string,
  item: PlacedFurniture,
  placedBy: string | null,
): Promise<void> {
  await guard(
    'insertWorldFurniture',
    async () => {
      // o id vem do servidor (World cunha o uuid), para o broadcast não esperar o banco
      const { error } = await client!.from('world_furniture').insert({
        id: item.id,
        place_id: placeId,
        furniture_id: item.furnitureId,
        tile_x: item.tileX,
        tile_y: item.tileY,
        rotation: item.rotation,
        placed_by: placedBy,
      });
      if (error) throw error;
      return true;
    },
    false,
  );
}

export async function moveWorldFurniture(
  id: string,
  tileX: number,
  tileY: number,
  rotation: number,
): Promise<void> {
  await guard(
    'moveWorldFurniture',
    async () => {
      const { error } = await client!
        .from('world_furniture')
        .update({ tile_x: tileX, tile_y: tileY, rotation })
        .eq('id', id);
      if (error) throw error;
      return true;
    },
    false,
  );
}

export async function deleteWorldFurniture(id: string): Promise<void> {
  await guard(
    'deleteWorldFurniture',
    async () => {
      const { error } = await client!.from('world_furniture').delete().eq('id', id);
      if (error) throw error;
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Sessões (histórico de presença)
// -----------------------------------------------------------------------------

export async function openSession(
  placeId: string,
  profileId: string,
  socketId: string,
  characterId: CharacterId,
  appearance: Appearance,
  userAgent: string | null,
): Promise<string | null> {
  return guard<string | null>(
    'openSession',
    async () => {
      const { data, error } = await client!
        .from('sessions')
        .insert({
          place_id: placeId,
          profile_id: profileId,
          socket_id: socketId,
          character_id: characterId,
          appearance,
          user_agent: userAgent,
        })
        .select('id')
        .single();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
    null,
  );
}

export async function closeSession(sessionId: string, reason: string): Promise<void> {
  const now = new Date().toISOString();
  await guard(
    'closeSession',
    async () => {
      const { error } = await client!
        .from('sessions')
        .update({ left_at: now, last_seen_at: now, disconnect_reason: reason })
        .eq('id', sessionId)
        .is('left_at', null);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/** Marca "ainda estou aqui". Chamado junto com a gravação de posição. */
export async function touchSession(sessionId: string): Promise<void> {
  await guard(
    'touchSession',
    async () => {
      const { error } = await client!
        .from('sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('id', sessionId);
      if (error) throw error;
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Chat
// -----------------------------------------------------------------------------

export async function saveChatMessage(
  placeId: string,
  profileId: string | null,
  msg: ChatMessage,
): Promise<void> {
  await guard(
    'saveChatMessage',
    async () => {
      const { error } = await client!.from('chat_messages').insert({
        id: msg.id,
        place_id: placeId,
        profile_id: profileId,
        sender_name: msg.senderName,
        body: msg.text,
        created_at: new Date(msg.timestamp).toISOString(),
      });
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Últimas mensagens do local, em ordem cronológica (a mais antiga primeiro),
 * no mesmo formato que o cliente já recebe no `world:snapshot`.
 *
 * `senderId` recebe o `profile_id` — e não um `socket.id`, que já morreu. O
 * cliente usa esse campo só para achar a cor de quem falou no roster (que é
 * indexado por socket), então histórico sai na cor padrão. Trocar isso exigiria
 * expor o `profileId` no roster; ficou de fora do MVP de propósito.
 */
export async function loadChatHistory(placeId: string): Promise<ChatMessage[]> {
  return guard<ChatMessage[]>(
    'loadChatHistory',
    async () => {
      const { data, error } = await client!
        .from('chat_messages')
        .select('id, profile_id, sender_name, body, created_at')
        .eq('place_id', placeId)
        .order('created_at', { ascending: false })
        .limit(CHAT_HISTORY_LIMIT);
      if (error) throw error;
      return (data ?? [])
        .map((row) => ({
          id: row.id as string,
          senderId: (row.profile_id as string | null) ?? '',
          senderName: row.sender_name as string,
          text: row.body as string,
          timestamp: new Date(row.created_at as string).getTime(),
        }))
        .reverse();
    },
    [],
  );
}

// -----------------------------------------------------------------------------
// Atividade da sessão: zonas de áudio, compartilhamento de tela e auditoria de
// token. Tudo pendura em `sessions` — ver `db/migrations/0003_activity.sql`.
// -----------------------------------------------------------------------------

/**
 * uuid da zona de áudio a partir do par (cenário, chave do shared). Cacheado
 * como os locais: o catálogo não muda em runtime, e isto é consultado a cada
 * troca de sala.
 */
const zoneIdCache = new Map<string, string | null>();

export async function resolveAudioZoneId(
  scenarioId: ScenarioId,
  zoneKey: string,
): Promise<string | null> {
  if (!client) return null;
  const cacheKey = `${scenarioId}:${zoneKey}`;
  const cached = zoneIdCache.get(cacheKey);
  if (cached !== undefined) return cached;
  return dedupe(`zone:${cacheKey}`, async () => {
    const id = await guard<string | null>(
      'resolveAudioZoneId',
      async () => {
        const { data, error } = await client!
          .from('audio_zones')
          .select('id')
          .eq('scenario_id', scenarioId)
          .eq('zone_key', zoneKey)
          .maybeSingle();
        if (error) throw error;
        return (data?.id as string | undefined) ?? null;
      },
      null,
    );
    if (id === null) {
      console.warn(`[db] zona "${zoneKey}" (${scenarioId}) não existe — rode db/seed.sql`);
    }
    zoneIdCache.set(cacheKey, id);
    return id;
  });
}

export async function openZoneVisit(sessionId: string, audioZoneId: string): Promise<string | null> {
  return guard<string | null>(
    'openZoneVisit',
    async () => {
      const { data, error } = await client!
        .from('zone_visits')
        .insert({ session_id: sessionId, audio_zone_id: audioZoneId })
        .select('id')
        .single();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
    null,
  );
}

export async function closeZoneVisit(visitId: string): Promise<void> {
  await guard(
    'closeZoneVisit',
    async () => {
      const { error } = await client!
        .from('zone_visits')
        .update({ left_at: new Date().toISOString() })
        .eq('id', visitId)
        .is('left_at', null);
      if (error) throw error;
      return true;
    },
    false,
  );
}

export async function openScreenShare(sessionId: string): Promise<string | null> {
  return guard<string | null>(
    'openScreenShare',
    async () => {
      const { data, error } = await client!
        .from('screen_shares')
        .insert({ session_id: sessionId })
        .select('id')
        .single();
      if (error) throw error;
      return (data?.id as string | undefined) ?? null;
    },
    null,
  );
}

export async function closeScreenShare(shareId: string): Promise<void> {
  await guard(
    'closeScreenShare',
    async () => {
      const { error } = await client!
        .from('screen_shares')
        .update({ ended_at: new Date().toISOString() })
        .eq('id', shareId)
        .is('ended_at', null);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Registra a emissão de um token de voz.
 *
 * `room` e `outcome` só: **o JWT nunca entra aqui**, nem pedaço dele. É
 * credencial válida por 8h para entrar na sala — guardar seria transformar a
 * tabela de auditoria em cofre de credencial ativa.
 */
export async function recordTokenGrant(grant: {
  sessionId: string | null;
  profileId: string | null;
  socketId: string;
  room: string;
  outcome: 'granted' | 'cached' | 'error';
}): Promise<void> {
  await guard(
    'recordTokenGrant',
    async () => {
      const { error } = await client!.from('voice_token_grants').insert({
        session_id: grant.sessionId,
        profile_id: grant.profileId,
        socket_id: grant.socketId,
        room: grant.room,
        outcome: grant.outcome,
      });
      if (error) throw error;
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Lobby: listar, criar e convidar. Ver `server/src/lobby.ts` para os handlers.
// -----------------------------------------------------------------------------

/** O perfil de quem está no lobby: o id, mais a última aparência usada. */
export interface ProfileRef {
  id: string;
  /** nome, cor e personagem da última entrada — prefill de mundo sem vínculo */
  appearance: WorldBinding;
}

/**
 * O perfil desta conta, criando com valores padrão se ainda não existe.
 *
 * Diferente de `findOrCreateProfile`: aqui não há nome nem personagem escolhidos
 * (o lobby vem ANTES da tela de entrada), então o nome sai do e-mail. A tela de
 * entrada sobrescreve depois.
 *
 * Devolve a **aparência** junto com o id porque o lobby precisa dela para
 * preencher a tela de entrada de um mundo onde a pessoa ainda não tem vínculo.
 * Não custa consulta: o `select` já acontecia, só ficou com mais colunas. O
 * nome tirado do e-mail continua sendo um chute — quem tem vínculo no mundo
 * nunca vê esse valor, porque o vínculo ganha dele (ver `WorldSummary.binding`).
 */
export async function ensureProfile(
  authUserId: string,
  email: string | null,
): Promise<ProfileRef | null> {
  const fallbackName = (email?.split('@')[0] ?? 'Alguém').slice(0, 20) || 'Alguém';
  const appearanceOf = (row: Record<string, unknown>): WorldBinding => ({
    name: (row.display_name as string | null) ?? fallbackName,
    color: Number(row.avatar_color ?? AVATAR_COLORS[0]),
    appearance: toAppearance(row.appearance, row.character_id),
  });
  return guard<ProfileRef | null>(
    'ensureProfile',
    async () => {
      const { data: found, error: findErr } = await client!
        .from('profiles')
        .select('id, display_name, avatar_color, character_id, appearance')
        .eq('auth_user_id', authUserId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (found?.id) return { id: found.id as string, appearance: appearanceOf(found) };

      const { data: created, error: insErr } = await client!
        .from('profiles')
        .insert({ auth_user_id: authUserId, display_name: fallbackName })
        .select('id, display_name, avatar_color, character_id, appearance')
        .single();
      if (insErr) throw insErr;
      if (!created?.id) return null;
      return { id: created.id as string, appearance: appearanceOf(created) };
    },
    null,
  );
}

/** Empresas em que este perfil tem membership ATIVA. */
async function activeOrgIds(profileId: string): Promise<string[]> {
  return guard<string[]>(
    'activeOrgIds',
    async () => {
      const { data, error } = await client!
        .from('memberships')
        .select('organization_id')
        .eq('profile_id', profileId)
        .eq('status', 'active');
      if (error) throw error;
      return (data ?? []).map((r) => r.organization_id as string);
    },
    [],
  );
}

/**
 * Os mundos que este perfil pode ver, sem a contagem de gente online (essa é
 * do processo, não do banco — quem preenche é `lobby.ts`).
 *
 * Três caminhos de acesso, resolvidos em consultas separadas e cruzados aqui em
 * vez de num `or` do PostgREST: `place_members` é outra tabela, então o `or`
 * não alcançaria os três de uma vez, e a lista do lobby não é caminho quente.
 */
export async function listWorldsFor(
  profileId: string,
): Promise<Array<Omit<WorldSummary, 'online'>>> {
  const orgIds = await activeOrgIds(profileId);
  if (orgIds.length === 0) return [];

  // papel por mundo, e não só a presença na lista: é o que decide quais botões
  // de administração o lobby mostra
  const myRoles = await guard<Map<string, AssignableWorldRole>>(
    'listWorldsFor/placeMembers',
    async () => {
      const { data, error } = await client!
        .from('place_members')
        .select('place_id, role')
        .eq('profile_id', profileId);
      if (error) throw error;
      return new Map(
        (data ?? []).map((r) => [r.place_id as string, r.role as AssignableWorldRole]),
      );
    },
    new Map(),
  );

  /**
   * Meu vínculo em cada mundo — como eu me chamo lá. Uma consulta só para
   * todos os mundos (o índice é `presence_state_profile_idx`, de 0001).
   *
   * Vem do banco e não do cliente porque é o que o `null` significa: "não
   * existe vínculo aqui" é a única coisa que faz a tela de entrada aparecer, e
   * um cliente podendo afirmar isso poderia pular a pergunta com nome vazio.
   * Linha antiga (de antes da 0009) tem `display_name` nulo e conta como sem
   * vínculo — perguntar uma vez é melhor que entrar com o nome errado.
   */
  const myBindings = await guard<Map<string, WorldBinding>>(
    'listWorldsFor/bindings',
    async () => {
      const { data, error } = await client!
        .from('presence_state')
        .select('place_id, display_name, avatar_color, character_id, appearance')
        .eq('profile_id', profileId)
        .not('display_name', 'is', null);
      if (error) throw error;
      return new Map(
        (data ?? []).map((r) => [
          r.place_id as string,
          {
            name: r.display_name as string,
            color: Number(r.avatar_color ?? AVATAR_COLORS[0]),
            appearance: toAppearance(r.appearance, r.character_id),
          },
        ]),
      );
    },
    new Map(),
  );

  const orgNames = await guard<Map<string, string>>(
    'listWorldsFor/orgs',
    async () => {
      const { data, error } = await client!
        .from('organizations')
        .select('id, name')
        .in('id', orgIds);
      if (error) throw error;
      return new Map((data ?? []).map((r) => [r.id as string, r.name as string]));
    },
    new Map(),
  );

  return guard<Array<Omit<WorldSummary, 'online'>>>(
    'listWorldsFor/places',
    async () => {
      const { data, error } = await client!
        .from('places')
        .select('id, organization_id, scenario_id, name, visibility, capacity, created_by')
        .in('organization_id', orgIds)
        .is('archived_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? [])
        // mundo restrito só aparece para quem está na lista ou o criou —
        // aparecer e recusar na entrada seria pior que não aparecer
        .filter(
          (r) =>
            r.visibility === 'organization' ||
            myRoles.has(r.id as string) ||
            r.created_by === profileId,
        )
        .map((r) => {
          // `owner` vence o papel gravado: a propriedade vem de `created_by`,
          // não de `place_members.role`
          const myRole: WorldRole =
            r.created_by === profileId ? 'owner' : (myRoles.get(r.id as string) ?? 'member');
          return {
            id: r.id as string,
            name: r.name as string,
            scenarioId: toScenarioId(r.scenario_id, 'listWorldsFor'),
            visibility: r.visibility as WorldSummary['visibility'],
            capacity: (r.capacity as number | null) ?? null,
            myRole,
            organizationName: orgNames.get(r.organization_id as string) ?? '—',
            binding: myBindings.get(r.id as string) ?? null,
          };
        });
    },
    [],
  );
}

/** Convites pendentes para este e-mail (mundo específico ou empresa toda). */
export async function listPendingInvites(email: string | null): Promise<PendingInvite[]> {
  if (!email) return [];
  return guard<PendingInvite[]>(
    'listPendingInvites',
    async () => {
      const { data, error } = await client!
        .from('invites')
        // o `token` NÃO entra na projeção: é o segredo do link de convite e não
        // tem uso nenhum nesta tela
        .select('id, organizations(name), places(name, scenario_id)')
        .eq('email', email.toLowerCase())
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString());
      if (error) throw error;
      return (data ?? []).map((r) => {
        const org = r.organizations as { name?: string } | null;
        const place = r.places as { name?: string; scenario_id?: string } | null;
        return {
          id: r.id as string,
          worldName: place?.name ?? null,
          organizationName: org?.name ?? '—',
          // convite sem mundo não tem cenário — `null` é diferente de "cenário
          // que não existe mais", e só o segundo cai no padrão
          scenarioId:
            place?.scenario_id === undefined
              ? null
              : toScenarioId(place.scenario_id, 'listPendingInvites'),
        };
      });
    },
    [],
  );
}

/**
 * A empresa onde os mundos desta pessoa vão morar: a primeira em que ela já
 * tem membership ativa, ou uma pessoal criada agora.
 *
 * Criar a empresa pessoal e a membership de dono é uma sequência de duas
 * escritas sem transação (o PostgREST não expõe uma). Se a segunda falhar,
 * sobra uma empresa sem membro — invisível no lobby e recuperável na tentativa
 * seguinte, porque `is_personal` + `created_by` deixam achá-la.
 */
export async function ensureOrgForNewWorld(
  profileId: string,
  displayName: string,
): Promise<string | null> {
  const existing = await activeOrgIds(profileId);
  if (existing.length > 0) return existing[0];

  return guard<string | null>(
    'ensureOrgForNewWorld',
    async () => {
      // uma empresa pessoal órfã de uma tentativa anterior serve
      const { data: orphan, error: orphanErr } = await client!
        .from('organizations')
        .select('id')
        .eq('created_by', profileId)
        .eq('is_personal', true)
        .limit(1)
        .maybeSingle();
      if (orphanErr) throw orphanErr;

      let orgId = orphan?.id as string | undefined;
      if (!orgId) {
        const { data: created, error: orgErr } = await client!
          .from('organizations')
          .insert({
            slug: `p-${profileId.slice(0, 8)}-${randomSuffix()}`,
            name: `Espaço de ${displayName}`,
            is_personal: true,
            created_by: profileId,
          })
          .select('id')
          .single();
        if (orgErr) throw orgErr;
        orgId = created?.id as string | undefined;
      }
      if (!orgId) return null;

      const { error: memErr } = await client!.from('memberships').upsert(
        {
          organization_id: orgId,
          profile_id: profileId,
          role: 'owner',
          status: 'active',
          joined_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id,profile_id' },
      );
      if (memErr) throw memErr;
      return orgId;
    },
    null,
  );
}

/** Sufixo curto para slug — evita colisão sem precisar de retry. */
function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

/**
 * Slug a partir do nome. Sempre com sufixo aleatório: o slug não aparece na
 * tela (o lobby mostra `name`), então garantir unicidade numa consulta só vale
 * mais que um slug bonito com retry em caso de colisão.
 */
function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24);
  return `${base || 'mundo'}-${randomSuffix()}`;
}

export async function createWorld(
  profileId: string,
  organizationId: string,
  name: string,
  scenarioId: ScenarioId,
  capacity: number | null,
): Promise<string | null> {
  return guard<string | null>(
    'createWorld',
    async () => {
      const { data, error } = await client!
        .from('places')
        .insert({
          organization_id: organizationId,
          scenario_id: scenarioId,
          slug: slugify(name),
          name,
          capacity,
          created_by: profileId,
          // mundo criado no lobby é restrito por padrão: quem cria decide quem
          // entra, em vez de abrir para a empresa inteira sem pedir
          visibility: 'restricted',
        })
        .select('id')
        .single();
      if (error) throw error;
      const placeId = data?.id as string | undefined;
      if (!placeId) return null;

      // o dono precisa estar na lista do próprio mundo restrito
      const { error: memErr } = await client!
        .from('place_members')
        .upsert({ place_id: placeId, profile_id: profileId, role: 'host' }, {
          onConflict: 'place_id,profile_id',
        });
      if (memErr) throw memErr;
      console.log(`[lobby] mundo criado ${placeId} (${scenarioId}) por ${profileId}`);
      return placeId;
    },
    null,
  );
}

/** O mundo, com o que o portão precisa. Usado no `join` por id. */
export async function getPlaceById(placeId: string): Promise<(PlaceRef & { scenarioId: ScenarioId }) | null> {
  return guard<(PlaceRef & { scenarioId: ScenarioId }) | null>(
    'getPlaceById',
    async () => {
      const { data, error } = await client!
        .from('places')
        .select('id, organization_id, visibility, capacity, scenario_id, created_by, archived_at')
        .eq('id', placeId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id as string,
        organizationId: data.organization_id as string,
        visibility: data.visibility as PlaceRef['visibility'],
        capacity: (data.capacity as number | null) ?? null,
        createdBy: (data.created_by as string | null) ?? null,
        archivedAt: (data.archived_at as string | null) ?? null,
        scenarioId: toScenarioId(data.scenario_id, 'getPlaceById'),
      };
    },
    null,
  );
}

/**
 * Convida um e-mail para um mundo. Idempotente: convite pendente repetido para
 * o mesmo par (mundo, e-mail) só renova a validade, em vez de estourar no
 * índice único.
 */
/**
 * **Dormente.** Cria convite pendente indexado por e-mail. Nada chama isto
 * hoje: sem envio de e-mail, quem administra adiciona a pessoa pelo ID
 * (`addMemberToWorld`). Fica porque é a volta do convite por e-mail quando
 * houver domínio — ver `docs/features/autenticacao-e-acesso.md`.
 */
export async function inviteToWorld(
  placeId: string,
  organizationId: string,
  email: string,
  invitedBy: string,
): Promise<boolean> {
  return guard(
    'inviteToWorld',
    async () => {
      const lower = email.toLowerCase();
      const { data: existing, error: findErr } = await client!
        .from('invites')
        .select('id')
        .eq('place_id', placeId)
        .eq('email', lower)
        .is('accepted_at', null)
        .maybeSingle();
      if (findErr) throw findErr;

      const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (existing?.id) {
        const { error } = await client!
          .from('invites')
          .update({ expires_at: expires, invited_by: invitedBy })
          .eq('id', existing.id as string);
        if (error) throw error;
        return true;
      }

      const { error } = await client!.from('invites').insert({
        organization_id: organizationId,
        place_id: placeId,
        email: lower,
        role: 'guest',
        invited_by: invitedBy,
        expires_at: expires,
      });
      if (error) throw error;
      console.log(`[lobby] convite criado para o mundo ${placeId}`); // sem o e-mail, sem o token
      return true;
    },
    false,
  );
}

/**
 * Dá acesso a um mundo para quem já tem conta, pelo ID dela.
 *
 * Duas escritas em sequência, sem transação: membership na empresa e depois
 * `place_members`. A ordem é a mesma do aceite de convite e pela mesma razão —
 * cair no meio deixa a pessoa com acesso à empresa e sem acesso ao mundo, que é
 * recuperável repetindo a operação; o contrário deixaria linha órfã em
 * `place_members` apontando para quem não é membro.
 *
 * Devolve `'not-found'` para ID bem formado que não é de ninguém: a tela precisa
 * dizer "esse ID não existe", que é o erro que a pessoa de verdade comete
 * (copiou torto), e não "erro ao adicionar".
 */
export async function addMemberToWorld(
  placeId: string,
  organizationId: string,
  memberId: string,
): Promise<'ok' | 'not-found' | 'error'> {
  return guard<'ok' | 'not-found' | 'error'>(
    'addMemberToWorld',
    async () => {
      const { data: profile, error: findErr } = await client!
        .from('profiles')
        .select('id')
        .eq('id', memberId)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!profile) return 'not-found';

      const now = new Date().toISOString();

      /**
       * Ler antes de escrever, em vez de `upsert` direto, por um motivo
       * concreto: `upsert` com `role: 'guest'` **rebaixaria** quem já é `owner`
       * ou `admin` desta empresa. O caso mais fácil de provocar é o dono
       * adicionar o próprio ID ao seu mundo — ele perderia a própria empresa.
       * Membership que já existe só tem o `status` reativado; o papel nunca é
       * tocado.
       */
      const { data: existing, error: memFindErr } = await client!
        .from('memberships')
        .select('id, status')
        .eq('organization_id', organizationId)
        .eq('profile_id', memberId)
        .maybeSingle();
      if (memFindErr) throw memFindErr;

      if (!existing) {
        const { error } = await client!.from('memberships').insert({
          organization_id: organizationId,
          profile_id: memberId,
          role: 'guest',
          status: 'active',
          joined_at: now,
        });
        if (error) throw error;
      } else if (existing.status !== 'active') {
        const { error } = await client!
          .from('memberships')
          .update({ status: 'active', joined_at: now })
          .eq('id', existing.id as string);
        if (error) throw error;
      }

      const { error: plErr } = await client!
        .from('place_members')
        .upsert({ place_id: placeId, profile_id: memberId, role: 'member' }, {
          onConflict: 'place_id,profile_id',
        });
      if (plErr) throw plErr;

      console.log(`[lobby] ${memberId} adicionado ao mundo ${placeId}`);
      return 'ok';
    },
    'error',
  );
}

/**
 * Aceita um convite pelo id, conferindo que ele é do e-mail de quem pediu.
 *
 * Faz até três escritas em sequência, nesta ordem de propósito: membership,
 * depois `place_members`, e só então marca o convite aceito. Se cair no meio, o
 * convite continua pendente e a pessoa tenta de novo — o contrário (marcar
 * aceito primeiro) deixaria a pessoa sem acesso e sem convite.
 */
export async function acceptInviteById(
  inviteId: string,
  profileId: string,
  email: string | null,
): Promise<boolean> {
  if (!email) return false;
  return guard(
    'acceptInviteById',
    async () => {
      const now = new Date().toISOString();
      const { data: invite, error: findErr } = await client!
        .from('invites')
        .select('id, organization_id, place_id, role')
        .eq('id', inviteId)
        .eq('email', email.toLowerCase())
        .is('accepted_at', null)
        .gt('expires_at', now)
        .maybeSingle();
      if (findErr) throw findErr;
      if (!invite) return false;

      const { error: memErr } = await client!.from('memberships').upsert(
        {
          organization_id: invite.organization_id as string,
          profile_id: profileId,
          role: (invite.role as string) ?? 'guest',
          status: 'active',
          joined_at: now,
        },
        { onConflict: 'organization_id,profile_id' },
      );
      if (memErr) throw memErr;

      if (invite.place_id) {
        const { error: plErr } = await client!
          .from('place_members')
          .upsert({ place_id: invite.place_id as string, profile_id: profileId, role: 'member' }, {
            onConflict: 'place_id,profile_id',
          });
        if (plErr) throw plErr;
      }

      const { error: invErr } = await client!
        .from('invites')
        .update({ accepted_at: now, accepted_by: profileId })
        .eq('id', invite.id as string)
        .is('accepted_at', null);
      if (invErr) throw invErr;

      console.log(`[lobby] convite ${inviteId} aceito por ${profileId}`);
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Gerenciar um mundo (só o dono). Ver `server/src/lobby.ts`.
// -----------------------------------------------------------------------------

/**
 * Quem tem acesso a este mundo, e quais convites ainda estão pendentes.
 *
 * Duas consultas em vez de uma com join: o `place_members` traz nomes de
 * `profiles` e os convites vêm de outra tabela — e este painel abre por clique,
 * não em laço.
 */
export async function loadWorldDetail(
  placeId: string,
  ownerProfileId: string | null,
): Promise<WorldDetail> {
  const members = await guard<WorldMember[]>(
    'loadWorldDetail/members',
    async () => {
      const { data, error } = await client!
        .from('place_members')
        .select('profile_id, role, profiles(display_name)')
        .eq('place_id', placeId);
      if (error) throw error;
      return (data ?? []).map((r) => {
        const profile = r.profiles as { display_name?: string } | null;
        const profileId = r.profile_id as string;
        return {
          profileId,
          name: profile?.display_name ?? '—',
          role: r.role as AssignableWorldRole,
          owner: profileId === ownerProfileId,
        };
      });
    },
    [],
  );

  const invites = await guard<SentInvite[]>(
    'loadWorldDetail/invites',
    async () => {
      // sem o `token` na projeção: não tem uso nesta tela e é o segredo do link
      const { data, error } = await client!
        .from('invites')
        .select('id, email, expires_at')
        .eq('place_id', placeId)
        .is('accepted_at', null)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id as string,
        email: r.email as string,
        expiresAt: new Date(r.expires_at as string).getTime(),
      }));
    },
    [],
  );

  return { worldId: placeId, members, invites };
}

/**
 * Renomeia / muda lotação / muda visibilidade. Campo ausente no patch não é
 * tocado — `undefined` e `null` significam coisas diferentes aqui: `capacity:
 * null` é "tirar o limite", `capacity` ausente é "não mexer".
 *
 * O `slug` NÃO acompanha o nome: ele é identificador interno e já foi usado em
 * `unique (organization_id, slug)`; trocá-lo a cada rename só criaria chance de
 * colisão sem ninguém ganhar nada (a tela mostra `name`).
 */
export async function updateWorld(placeId: string, patch: WorldPatch): Promise<boolean> {
  const fields: Record<string, unknown> = {};
  if (patch.name !== undefined) fields.name = patch.name;
  if (patch.capacity !== undefined) fields.capacity = patch.capacity;
  if (patch.visibility !== undefined) fields.visibility = patch.visibility;
  if (Object.keys(fields).length === 0) return true;

  return guard(
    'updateWorld',
    async () => {
      const { error } = await client!
        .from('places')
        .update(fields)
        .eq('id', placeId)
        .is('archived_at', null);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Arquiva. Não apaga: cinco tabelas cascateiam de `places` e levariam todo o
 * chat e a presença daquele mundo (ver `0006_world_admin.sql`).
 */
export async function archiveWorld(placeId: string): Promise<boolean> {
  return guard(
    'archiveWorld',
    async () => {
      const { error } = await client!
        .from('places')
        .update({ archived_at: new Date().toISOString() })
        .eq('id', placeId)
        .is('archived_at', null);
      if (error) throw error;
      console.log(`[lobby] mundo arquivado ${placeId}`);
      return true;
    },
    false,
  );
}

/** Tira o acesso de alguém a um mundo. */
export async function removeWorldMember(placeId: string, profileId: string): Promise<boolean> {
  return guard(
    'removeWorldMember',
    async () => {
      const { error } = await client!
        .from('place_members')
        .delete()
        .eq('place_id', placeId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/** O convite pendente, para conferir de quem ele é antes de mexer. */
export async function getPendingInvite(
  inviteId: string,
): Promise<{ id: string; placeId: string | null; email: string } | null> {
  return guard<{ id: string; placeId: string | null; email: string } | null>(
    'getPendingInvite',
    async () => {
      const { data, error } = await client!
        .from('invites')
        .select('id, place_id, email')
        .eq('id', inviteId)
        .is('accepted_at', null)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id as string,
        placeId: (data.place_id as string | null) ?? null,
        email: data.email as string,
      };
    },
    null,
  );
}

/**
 * Apaga um convite pendente — usado tanto pelo dono (revogar) quanto por quem
 * foi convidado (recusar). Quem chama é que confere a legitimidade; aqui só
 * garante que um convite JÁ ACEITO não seja apagado (isso apagaria a trilha de
 * como a pessoa entrou, e não tiraria o acesso dela).
 */
export async function deletePendingInvite(inviteId: string): Promise<boolean> {
  return guard(
    'deletePendingInvite',
    async () => {
      const { error } = await client!
        .from('invites')
        .delete()
        .eq('id', inviteId)
        .is('accepted_at', null);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Meu papel neste mundo, para autorizar uma operação de administração.
 *
 * `owner` sai de `places.created_by` e ganha de qualquer coisa gravada em
 * `place_members.role` — é o que impede alguém perder a propriedade do próprio
 * mundo por uma edição de papel.
 */
export async function getMyWorldRole(
  placeId: string,
  profileId: string,
): Promise<WorldRole | null> {
  return guard<WorldRole | null>(
    'getMyWorldRole',
    async () => {
      const { data: place, error: placeErr } = await client!
        .from('places')
        .select('created_by')
        .eq('id', placeId)
        .maybeSingle();
      if (placeErr) throw placeErr;
      if (!place) return null;
      if (place.created_by === profileId) return 'owner';

      const { data: member, error: memErr } = await client!
        .from('place_members')
        .select('role')
        .eq('place_id', placeId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (memErr) throw memErr;
      return member ? ((member.role as AssignableWorldRole) ?? 'member') : null;
    },
    null,
  );
}

/** Papel gravado de alguém neste mundo, ou null se não é membro. */
export async function getMemberRole(
  placeId: string,
  profileId: string,
): Promise<AssignableWorldRole | null> {
  return guard<AssignableWorldRole | null>(
    'getMemberRole',
    async () => {
      const { data, error } = await client!
        .from('place_members')
        .select('role')
        .eq('place_id', placeId)
        .eq('profile_id', profileId)
        .maybeSingle();
      if (error) throw error;
      return data ? ((data.role as AssignableWorldRole) ?? 'member') : null;
    },
    null,
  );
}

export async function setMemberRole(
  placeId: string,
  profileId: string,
  role: AssignableWorldRole,
): Promise<boolean> {
  return guard(
    'setMemberRole',
    async () => {
      const { error } = await client!
        .from('place_members')
        .update({ role })
        .eq('place_id', placeId)
        .eq('profile_id', profileId);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Passa a propriedade do mundo.
 *
 * Três escritas nesta ordem: garante o novo dono como `host` em
 * `place_members`, troca `created_by`, e garante o dono antigo como `host`.
 *
 * A ordem importa. O `created_by` no meio é a troca de verdade; antes dele o
 * novo dono já tem acesso administrativo, e depois dele o antigo ainda tem —
 * então nenhuma falha parcial deixa o mundo sem ninguém que possa administrá-lo.
 * (E se a última falhar, o dono antigo continua entrando: o portão deixa passar
 * quem está em `place_members`, e ele estava lá antes.)
 */
export async function transferWorldOwnership(
  placeId: string,
  fromProfileId: string,
  toProfileId: string,
): Promise<boolean> {
  return guard(
    'transferWorldOwnership',
    async () => {
      const { error: upErr } = await client!
        .from('place_members')
        .upsert({ place_id: placeId, profile_id: toProfileId, role: 'host' }, {
          onConflict: 'place_id,profile_id',
        });
      if (upErr) throw upErr;

      const { error: placeErr } = await client!
        .from('places')
        .update({ created_by: toProfileId })
        .eq('id', placeId)
        .eq('created_by', fromProfileId); // só troca se ainda sou eu o dono
      if (placeErr) throw placeErr;

      const { error: oldErr } = await client!
        .from('place_members')
        .upsert({ place_id: placeId, profile_id: fromProfileId, role: 'host' }, {
          onConflict: 'place_id,profile_id',
        });
      if (oldErr) throw oldErr;

      console.log(`[lobby] propriedade do mundo ${placeId}: ${fromProfileId} -> ${toProfileId}`);
      return true;
    },
    false,
  );
}

// -----------------------------------------------------------------------------
// Soundboard: tempo acumulado, biblioteca de sons e os arquivos no Storage.
//
// Tudo aqui é fail-soft como o resto do arquivo. Consequência a ter em mente: um
// upload que falha devolve `null`, e quem chama traduz para uma recusa na tela —
// nunca para uma exceção que derrubaria o handler.
// -----------------------------------------------------------------------------

/** Nome do bucket, criado em `0010_soundboard.sql`. Privado. */
const SOUND_BUCKET = 'soundboard';

/**
 * Validade da URL assinada de leitura.
 *
 * Longa o bastante para não reassinar a cada toque (o cliente cacheia o áudio
 * decodificado por `soundId`, mas quem entra depois baixa de novo) e curta o
 * bastante para um link copiado do DevTools não virar acesso permanente ao
 * arquivo de outra pessoa. Quatro horas cobre um dia de trabalho com uma
 * reassinatura no meio.
 */
const SOUND_URL_TTL_S = 4 * 60 * 60;

/**
 * Tempo acumulado **e** volume, numa consulta só.
 *
 * Existe separada de `loadPresenceSeconds` porque os dois consumidores são
 * diferentes: montar o estado do painel precisa das duas colunas, e autorizar um
 * disparo precisa **só** do tempo — e o disparo é o caminho quente (roda a cada
 * som tocado), então ele não deve carregar coluna que não usa.
 */
export async function loadSoundboardPrefs(
  profileId: string,
): Promise<{ presenceSeconds: number; volume: number }> {
  return guard<{ presenceSeconds: number; volume: number }>(
    'loadSoundboardPrefs',
    async () => {
      const { data, error } = await client!
        .from('profiles')
        .select('presence_seconds, soundboard_volume')
        .eq('id', profileId)
        .maybeSingle();
      if (error) throw error;
      const seconds = Number(data?.presence_seconds ?? 0);
      return {
        presenceSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : 0,
        volume: clampVolume(data?.soundboard_volume),
      };
    },
    { presenceSeconds: 0, volume: SOUND_VOLUME_DEFAULT },
  );
}

/**
 * O MEU mapa de volume por pessoa, chaveado pelo **perfil** de cada pessoa.
 *
 * Lido uma vez, no `join`, e guardado em memória no socket — quem entra depois
 * é resolvido a partir desse cache, sem consulta nova. Sem isso, entrar num
 * mundo com dez pessoas custaria dez consultas, e cada pessoa que entrasse
 * depois custaria uma para cada um que já estava lá.
 *
 * Linha ausente = default (cheio), então este mapa é sempre PARCIAL: quem nunca
 * foi ajustado não aparece aqui, e é o cliente que trata a ausência.
 */
export async function loadPeerAudioPrefs(profileId: string): Promise<Map<string, PeerAudioPrefs>> {
  return guard<Map<string, PeerAudioPrefs>>(
    'loadPeerAudioPrefs',
    async () => {
      const { data, error } = await client!
        .from('peer_audio_prefs')
        .select('target_profile_id, voice_volume, sound_volume')
        .eq('profile_id', profileId);
      if (error) throw error;
      const out = new Map<string, PeerAudioPrefs>();
      for (const row of data ?? []) {
        const target = String(row.target_profile_id ?? '');
        if (!target) continue;
        out.set(target, {
          voice: clampPeerVolume(row.voice_volume),
          sound: clampPeerVolume(row.sound_volume),
        });
      }
      return out;
    },
    new Map(),
  );
}

/**
 * Grava o meu ajuste para UMA pessoa. `false` = não gravou (a tela avisa).
 *
 * Upsert do par inteiro, e não `update` de um campo: a linha pode não existir
 * (o default vive no código, não numa linha por par de gente que existe), e
 * gravar um campo só exigiria ler-modificar-escrever para não zerar o outro.
 *
 * Não apaga a linha quando os dois voltam a 100. Linha ausente e 100/100 são a
 * mesma coisa para quem lê, então apagar seria só uma escrita a mais para
 * economizar bytes que ninguém está pagando.
 */
export async function savePeerAudioPref(
  profileId: string,
  targetProfileId: string,
  voice: number,
  sound: number,
): Promise<boolean> {
  return guard<boolean>(
    'savePeerAudioPref',
    async () => {
      const { error } = await client!.from('peer_audio_prefs').upsert(
        {
          profile_id: profileId,
          target_profile_id: targetProfileId,
          voice_volume: clampPeerVolume(voice),
          sound_volume: clampPeerVolume(sound),
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'profile_id,target_profile_id' },
      );
      if (error) throw error;
      return true;
    },
    false,
  );
}

/** Grava o volume do soundboard. `false` = não gravou (a tela avisa). */
export async function saveSoundboardVolume(profileId: string, volume: number): Promise<boolean> {
  return guard<boolean>(
    'saveSoundboardVolume',
    async () => {
      const { error } = await client!
        .from('profiles')
        .update({ soundboard_volume: clampVolume(volume) })
        .eq('id', profileId);
      if (error) throw error;
      return true;
    },
    false,
  );
}

/** Tempo acumulado desta pessoa, em segundos. 0 quando não há banco. */
export async function loadPresenceSeconds(profileId: string): Promise<number> {
  return guard<number>(
    'loadPresenceSeconds',
    async () => {
      const { data, error } = await client!
        .from('profiles')
        .select('presence_seconds')
        .eq('id', profileId)
        .maybeSingle();
      if (error) throw error;
      const raw = Number(data?.presence_seconds ?? 0);
      return Number.isFinite(raw) && raw > 0 ? raw : 0;
    },
    0,
  );
}

/**
 * Credita uma fatia de presença e devolve o total novo.
 *
 * Vai por RPC porque o supabase-js não expressa `set x = x + n`: ler-e-escrever
 * da aplicação perderia crédito com duas abas abertas (as duas leem o mesmo
 * valor e a segunda escrita sobrescreve a primeira). A função
 * `app_add_presence_seconds` faz num statement só.
 */
export async function addPresenceSeconds(profileId: string, seconds: number): Promise<number> {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return guard<number>(
    'addPresenceSeconds',
    async () => {
      const { data, error } = await client!.rpc('app_add_presence_seconds', {
        p_profile: profileId,
        p_seconds: Math.round(seconds),
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    0,
  );
}

/**
 * Os sons desta pessoa, com URL de leitura já assinada.
 *
 * As URLs são assinadas em lote (`createSignedUrls`), e não uma por som: são no
 * máximo alguns arquivos, mas uma ida por som transformaria abrir o painel em N
 * chamadas de rede ao Storage. Som cujo arquivo não pôde ser assinado é
 * **omitido** em vez de vir com url vazia — melhor um slot que aparece livre do
 * que um botão que não toca nada.
 */
export async function listUserSounds(profileId: string): Promise<UserSound[]> {
  return guard<UserSound[]>(
    'listUserSounds',
    async () => {
      const { data, error } = await client!
        .from('user_sounds')
        .select('id, slot, label, storage_path, duration_ms')
        .eq('profile_id', profileId)
        .order('slot', { ascending: true });
      if (error) throw error;
      const rows = data ?? [];
      if (rows.length === 0) return [];

      const { data: signed, error: signError } = await client!.storage
        .from(SOUND_BUCKET)
        .createSignedUrls(
          rows.map((r) => String(r.storage_path)),
          SOUND_URL_TTL_S,
        );
      if (signError) throw signError;

      const urlByPath = new Map<string, string>();
      for (const item of signed ?? []) {
        if (item.signedUrl && item.path) urlByPath.set(item.path, item.signedUrl);
      }

      const out: UserSound[] = [];
      for (const row of rows) {
        const url = urlByPath.get(String(row.storage_path));
        if (!url) continue;
        out.push({
          id: String(row.id),
          slot: Number(row.slot),
          label: String(row.label),
          url,
          durationMs: Number(row.duration_ms ?? 0),
        });
      }
      return out;
    },
    [],
  );
}

/** Um som específico, só se for desta pessoa. `null` = não existe ou não é dela. */
export async function getUserSound(
  profileId: string,
  soundId: string,
): Promise<UserSound | null> {
  return guard<UserSound | null>(
    'getUserSound',
    async () => {
      const { data, error } = await client!
        .from('user_sounds')
        .select('id, slot, label, storage_path, duration_ms')
        .eq('profile_id', profileId)
        .eq('id', soundId)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      const { data: signed, error: signError } = await client!.storage
        .from(SOUND_BUCKET)
        .createSignedUrl(String(data.storage_path), SOUND_URL_TTL_S);
      if (signError) throw signError;
      if (!signed?.signedUrl) return null;

      return {
        id: String(data.id),
        slot: Number(data.slot),
        label: String(data.label),
        url: signed.signedUrl,
        durationMs: Number(data.duration_ms ?? 0),
      };
    },
    null,
  );
}

/**
 * Sobe o arquivo e grava a linha. Devolve `false` em qualquer falha.
 *
 * A ORDEM importa e é deliberada: **arquivo primeiro, linha depois**. Se a linha
 * falhar, sobra um arquivo órfão no bucket — invisível, custa bytes, e o próximo
 * upload no mesmo slot o substitui (o caminho é derivado do slot). O inverso
 * deixaria uma linha apontando para arquivo que não existe, e aí o som aparece
 * na grade e não toca — falha visível, e sem conserto automático.
 *
 * `upsert: true` no Storage porque o caminho é `<profile>/<slot>.<ext>`: trocar o
 * som de um slot é sobrescrever, e não acumular arquivo por versão.
 */
export async function insertUserSound(
  profileId: string,
  slot: number,
  label: string,
  mime: string,
  durationMs: number,
  bytes: Uint8Array,
  ext: string,
): Promise<boolean> {
  const path = `${profileId}/${slot}.${ext}`;
  return guard<boolean>(
    'insertUserSound',
    async () => {
      const { error: upError } = await client!.storage
        .from(SOUND_BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: true });
      if (upError) {
        /**
         * Nomeia o erro que já custou depuração, no mesmo espírito da sonda de
         * boot (`supabase.ts`): o Storage recusar um MIME que a whitelist do
         * `shared` aceita significa que o **bucket** foi criado com uma lista
         * velha, e reaplicar a `0010` não conserta (o insert dela é `on conflict
         * do nothing`). Sem esta linha o sintoma é "upload recusado: error" com
         * o arquivo perfeitamente válido.
         */
        if (/mime type/i.test(upError.message)) {
          console.error(
            `[db] insertUserSound: o bucket '${SOUND_BUCKET}' não aceita '${mime}'. ` +
              'A whitelist do bucket está desatualizada — rode `db/migrations/0011_soundboard_wav.sql`.',
          );
        }
        throw upError;
      }

      const { error } = await client!.from('user_sounds').upsert(
        {
          profile_id: profileId,
          slot,
          label,
          storage_path: path,
          mime,
          bytes: bytes.byteLength,
          duration_ms: Math.round(durationMs),
        },
        { onConflict: 'profile_id,slot' },
      );
      if (error) throw error;
      return true;
    },
    false,
  );
}

/**
 * Apaga o som e o arquivo. Devolve `false` se não era dela (ou não existia).
 *
 * Aqui a ordem é a inversa do upload, pela mesma lógica: **linha primeiro**. Se
 * o arquivo não sair do bucket, sobra órfão invisível; se a linha ficasse,
 * sobraria um botão que não toca.
 */
export async function deleteUserSound(profileId: string, soundId: string): Promise<boolean> {
  return guard<boolean>(
    'deleteUserSound',
    async () => {
      const { data, error } = await client!
        .from('user_sounds')
        .delete()
        .eq('profile_id', profileId)
        .eq('id', soundId)
        .select('storage_path')
        .maybeSingle();
      if (error) throw error;
      if (!data) return false;

      const { error: rmError } = await client!.storage
        .from(SOUND_BUCKET)
        .remove([String(data.storage_path)]);
      // arquivo órfão não impede o slot de ficar livre: loga e segue
      if (rmError) console.warn('[db] deleteUserSound: arquivo não removido:', rmError.message);
      return true;
    },
    false,
  );
}
