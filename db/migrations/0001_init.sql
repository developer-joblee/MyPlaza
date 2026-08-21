-- =============================================================================
-- toGether / MyPlaza — 0001_init
-- Schema base: organizações, perfis, acesso, locais, sessões, posição e chat.
--
-- Aplicação MANUAL por enquanto: cole este arquivo inteiro no SQL Editor do
-- Supabase (ver `db/README.md`). É idempotente o suficiente para rodar de novo
-- num projeto novo, mas NÃO é reversível — não há `down`.
--
-- Requer Supabase (usa o schema `auth`). Em Postgres puro, o FK para
-- `auth.users` em `profiles` falha.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Gatilho de updated_at. Uma função só, reusada por todas as tabelas que têm a
-- coluna — em vez de repetir `now()` em cada UPDATE do servidor e esquecer num.
-- -----------------------------------------------------------------------------
create or replace function app_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Tabelas de referência: espelham ids que vivem em `shared/src/`.
--
-- São tabelas, e não CHECK constraints, de propósito: adicionar um personagem
-- ou cenário passa a ser um INSERT (dado) em vez de uma migration (schema).
-- A FONTE DE VERDADE continua sendo o TypeScript — `shared/src/constants.ts`
-- (CHARACTERS) e `shared/src/scenarios.ts` (SCENARIOS). O banco só guarda o id
-- para poder referenciá-lo; geometria, colisão e spawns não vêm para cá.
-- -----------------------------------------------------------------------------
create table if not exists characters (
  id          text primary key,
  label       text not null,
  sort_order  smallint not null default 0
);

create table if not exists scenarios (
  id          text primary key,
  label       text not null,
  description text,
  sort_order  smallint not null default 0
);

-- -----------------------------------------------------------------------------
-- organizations — a empresa. Raiz de tudo: todo local e todo acesso pendura
-- aqui, o que deixa o app multi-tenant desde o primeiro dia.
-- -----------------------------------------------------------------------------
create table if not exists organizations (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique
             check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),
  name       text not null check (char_length(name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace trigger organizations_touch
  before update on organizations
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- profiles — a pessoa dentro do produto.
--
-- `id` NÃO tem default e NÃO é o id do Supabase Auth: é o id interno do app,
-- estável para sempre, hoje gerado pelo próprio client (uuid guardado em
-- localStorage). `auth_user_id` é o vínculo com a conta, preenchido quando o
-- login existir. Assim, transformar um perfil anônimo em perfil logado é um
-- UPDATE de UMA coluna — e não um re-key de toda FK que aponta para cá.
-- -----------------------------------------------------------------------------
create table if not exists profiles (
  id            uuid primary key,
  auth_user_id  uuid unique references auth.users (id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 20),
  -- cor do avatar como inteiro 0xRRGGBB, igual ao AVATAR_COLORS do shared
  avatar_color  integer not null default 15087942
                check (avatar_color between 0 and 16777215),
  character_id  text not null default 'adam' references characters (id),
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace trigger profiles_touch
  before update on profiles
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- memberships — quem tem acesso a qual empresa, e como.
-- É o N:N que responde tanto "empresas que terão esses usuários" quanto
-- "acesso de pessoas".
-- -----------------------------------------------------------------------------
create table if not exists memberships (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  profile_id      uuid not null references profiles (id) on delete cascade,
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member', 'guest')),
  status          text not null default 'active'
                  check (status in ('invited', 'active', 'suspended')),
  invited_by      uuid references profiles (id) on delete set null,
  joined_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, profile_id)
);

create index if not exists memberships_profile_idx on memberships (profile_id);

create or replace trigger memberships_touch
  before update on memberships
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- invites — cadastro por convite. O token é o segredo do link; ele NUNCA
-- aparece em log (ver `server/src/db.ts`).
-- -----------------------------------------------------------------------------
create table if not exists invites (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  email           text not null check (position('@' in email) > 1),
  role            text not null default 'member'
                  check (role in ('owner', 'admin', 'member', 'guest')),
  token           text not null unique default encode(gen_random_bytes(24), 'hex'),
  invited_by      uuid references profiles (id) on delete set null,
  expires_at      timestamptz not null default now() + interval '7 days',
  accepted_at     timestamptz,
  accepted_by     uuid references profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

-- um convite pendente por e-mail por empresa (aceitos não contam)
create unique index if not exists invites_pending_unique
  on invites (organization_id, lower(email))
  where accepted_at is null;

-- -----------------------------------------------------------------------------
-- places — o local: uma instância de um cenário dentro de uma empresa.
--
-- Hoje o servidor tem um mundo por `scenario_id` global; o local é a camada que
-- permite duas empresas terem cada uma o seu Estúdio, sem se ver.
-- -----------------------------------------------------------------------------
create table if not exists places (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  scenario_id     text not null references scenarios (id),
  slug            text not null
                  check (slug ~ '^[a-z0-9][a-z0-9-]{0,38}[a-z0-9]$'),
  name            text not null check (char_length(name) between 1 and 120),
  visibility      text not null default 'organization'
                  check (visibility in ('organization', 'restricted')),
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);

-- um local padrão por empresa (é onde cai quem entra sem escolher)
create unique index if not exists places_one_default_per_org
  on places (organization_id)
  where is_default;

create index if not exists places_org_scenario_idx
  on places (organization_id, scenario_id);

create or replace trigger places_touch
  before update on places
  for each row execute function app_touch_updated_at();

-- -----------------------------------------------------------------------------
-- place_members — só vale quando `places.visibility = 'restricted'`. Local
-- 'organization' é aberto a quem tem membership ativa, e não precisa de linha
-- aqui (evita ter que popular N linhas por local no caso comum).
-- -----------------------------------------------------------------------------
create table if not exists place_members (
  place_id   uuid not null references places (id) on delete cascade,
  profile_id uuid not null references profiles (id) on delete cascade,
  role       text not null default 'member' check (role in ('host', 'member')),
  created_at timestamptz not null default now(),
  primary key (place_id, profile_id)
);

create index if not exists place_members_profile_idx on place_members (profile_id);

-- -----------------------------------------------------------------------------
-- sessions — histórico de presença: uma linha por entrada no local.
-- `socket_id` é o id do Socket.IO daquela conexão (efêmero, e também a
-- identidade no LiveKit). Guardar é o que permite responder "quem estava
-- online quando aquilo aconteceu" e depurar quedas por `disconnect_reason`.
-- -----------------------------------------------------------------------------
create table if not exists sessions (
  id                uuid primary key default gen_random_uuid(),
  place_id          uuid not null references places (id) on delete cascade,
  profile_id        uuid not null references profiles (id) on delete cascade,
  socket_id         text not null,
  character_id      text not null references characters (id),
  joined_at         timestamptz not null default now(),
  last_seen_at      timestamptz not null default now(),
  left_at           timestamptz,
  disconnect_reason text
);

-- sessões abertas: é a consulta de "quem está online agora"
create index if not exists sessions_open_idx on sessions (place_id) where left_at is null;
create index if not exists sessions_profile_idx on sessions (profile_id, joined_at desc);

-- -----------------------------------------------------------------------------
-- presence_state — ONDE A PESSOA PAROU. Uma linha por (local, perfil),
-- sobrescrita; não é histórico (isso é `sessions`).
--
-- x/y em PIXELS do mapa, no mesmo sistema do `PlayerState` do shared. Isso
-- amarra a linha ao mapa do cenário: editar o ASCII pode deixar uma posição
-- salva dentro de uma parede, então o servidor VALIDA ao restaurar e cai no
-- spawn se não der (ver `server/src/world.ts`).
-- -----------------------------------------------------------------------------
create table if not exists presence_state (
  place_id     uuid not null references places (id) on delete cascade,
  profile_id   uuid not null references profiles (id) on delete cascade,
  x            double precision not null check (x >= 0),
  y            double precision not null check (y >= 0),
  sitting      boolean not null default false,
  away         boolean not null default false,
  character_id text not null references characters (id),
  updated_at   timestamptz not null default now(),
  primary key (place_id, profile_id)
);

create index if not exists presence_state_profile_idx on presence_state (profile_id);

-- -----------------------------------------------------------------------------
-- chat_messages — o chat, que hoje morre a cada restart do servidor.
-- `sender_name` é SNAPSHOT do nome no momento do envio: histórico não deve
-- mudar retroativamente porque a pessoa trocou de nome depois.
-- -----------------------------------------------------------------------------
create table if not exists chat_messages (
  id          uuid primary key default gen_random_uuid(),
  place_id    uuid not null references places (id) on delete cascade,
  profile_id  uuid references profiles (id) on delete set null,
  sender_name text not null,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists chat_messages_place_time_idx
  on chat_messages (place_id, created_at desc);
