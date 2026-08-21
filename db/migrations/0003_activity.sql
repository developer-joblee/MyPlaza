-- =============================================================================
-- toGether / MyPlaza — 0003_activity
-- O que acontece DURANTE uma conexão: zonas de áudio visitadas, compartilhamento
-- de tela e auditoria de emissão de token de voz.
--
-- A ideia estrutural: `sessions` (de 0001) passa a ser o **hub**. Tudo aqui
-- pendura numa sessão, e não repete `place_id`/`profile_id` — eles vêm por join.
-- Isso evita o clássico "linha de atividade com place_id que discorda da sessão".
--
-- Aplicação manual, depois de 0001 e 0002 (ver `db/README.md`). O `seed.sql`
-- popula `audio_zones` — sem ele, `zone_visits` não tem alvo de FK.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- sessions.user_agent — o servidor JÁ recebe isto no handshake do Socket.IO e
-- descartava. É o que diferencia "caiu no Safari do iPhone" de "caiu no Chrome
-- da mesa", que é a primeira pergunta ao investigar queda de conexão.
-- -----------------------------------------------------------------------------
alter table sessions add column if not exists user_agent text;

-- -----------------------------------------------------------------------------
-- audio_zones — catálogo das salas fechadas, espelhando `audioZones` de
-- `shared/src/scenarios.ts` (hoje: reunião e copa, no Estúdio).
--
-- Mesma escolha de `characters`/`scenarios`: tabela, não CHECK. O RETÂNGULO
-- (`rect`) NÃO vem para o banco — a geometria é do mapa, e duplicá-la aqui
-- criaria duas verdades sobre onde a sala fica. O banco guarda só id e rótulo,
-- para poder referenciar.
--
-- A chave natural seria (scenario_id, zone_key); o uuid existe para que
-- `zone_visits` referencie UMA coluna.
-- -----------------------------------------------------------------------------
create table if not exists audio_zones (
  id          uuid primary key default gen_random_uuid(),
  scenario_id text not null references scenarios (id) on delete cascade,
  /** o `id` do AudioZone no shared: 'reuniao', 'copa' */
  zone_key    text not null,
  label       text not null,
  created_at  timestamptz not null default now(),
  unique (scenario_id, zone_key)
);

-- -----------------------------------------------------------------------------
-- zone_visits — quem esteve em qual sala, quando, por quanto tempo.
--
-- O servidor deriva isto SOZINHO da posição, sem evento novo: `audioZoneAt()`
-- vive em `shared/` e é pura, e o servidor já tem posição e cenário. Uma linha
-- por entrada; `left_at` nulo = ainda lá dentro.
-- -----------------------------------------------------------------------------
create table if not exists zone_visits (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references sessions (id) on delete cascade,
  audio_zone_id uuid not null references audio_zones (id) on delete cascade,
  entered_at    timestamptz not null default now(),
  left_at       timestamptz
);

create index if not exists zone_visits_open_idx
  on zone_visits (session_id) where left_at is null;
create index if not exists zone_visits_zone_idx
  on zone_visits (audio_zone_id, entered_at desc);

-- -----------------------------------------------------------------------------
-- screen_shares — histórico de compartilhamento de tela.
--
-- Este é o único que exigiu evento novo no protocolo (`share`), porque só o
-- cliente sabe: a tela é publicada direto no LiveKit e o servidor nunca soube
-- que alguém estava compartilhando. Agora sabe.
-- -----------------------------------------------------------------------------
create table if not exists screen_shares (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions (id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at   timestamptz
);

create index if not exists screen_shares_open_idx
  on screen_shares (session_id) where ended_at is null;

-- -----------------------------------------------------------------------------
-- voice_token_grants — trilha de auditoria da emissão de token do LiveKit.
--
-- Hoje isso existe só como `console.log`, que some no restart do contêiner.
--
-- **Nunca guarda o JWT**, nem parte dele: só metadados (sala, quando, como). O
-- token é credencial de entrar na sala de voz; persistir seria transformar o
-- banco em cofre de credencial válida por 8h.
--
-- `outcome` NÃO registra recusa por limite de taxa, de propósito: recusa é
-- barata para quem tenta e viraria amplificação de escrita (spam no
-- `voice:token` gerando INSERT). O limitador em `handlers.ts` já barra, e o log
-- de linha continua lá.
-- -----------------------------------------------------------------------------
create table if not exists voice_token_grants (
  id         uuid primary key default gen_random_uuid(),
  -- nullable: o token pode ser pedido antes de a linha de sessão existir, e por
  -- quem entrou sem perfil (sessão anônima)
  session_id uuid references sessions (id) on delete set null,
  profile_id uuid references profiles (id) on delete set null,
  socket_id  text not null,
  room       text not null,
  outcome    text not null check (outcome in ('granted', 'cached', 'error')),
  issued_at  timestamptz not null default now()
);

create index if not exists voice_token_grants_time_idx on voice_token_grants (issued_at desc);

-- -----------------------------------------------------------------------------
-- RLS. Mesma regra de 0002: servidor escreve, navegador só lê o que é da
-- empresa dele. `voice_token_grants` fica SEM política — auditoria de segurança
-- não é para membro comum ler (RLS ligada + zero política = só service_role).
-- -----------------------------------------------------------------------------
alter table audio_zones        enable row level security;
alter table zone_visits        enable row level security;
alter table screen_shares      enable row level security;
alter table voice_token_grants enable row level security;

drop policy if exists audio_zones_read on audio_zones;
create policy audio_zones_read on audio_zones
  for select to authenticated using (true);

drop policy if exists zone_visits_read on zone_visits;
create policy zone_visits_read on zone_visits
  for select to authenticated using (
    exists (
      select 1 from sessions s
      where s.id = zone_visits.session_id and app_can_see_place(s.place_id)
    )
  );

drop policy if exists screen_shares_read on screen_shares;
create policy screen_shares_read on screen_shares
  for select to authenticated using (
    exists (
      select 1 from sessions s
      where s.id = screen_shares.session_id and app_can_see_place(s.place_id)
    )
  );

-- -----------------------------------------------------------------------------
-- Views de leitura. Sem elas as tabelas guardam dado que ninguém consegue
-- perguntar: toda pergunta útil exige 4 joins.
--
-- `security_invoker = true` é OBRIGATÓRIO e é a pegadinha: por padrão uma view
-- no Postgres roda com os direitos do DONO, o que **fura o RLS** das tabelas de
-- baixo — a view viraria um buraco por onde a anon key leria a empresa toda.
-- Com invoker, o RLS de quem consulta continua valendo.
-- -----------------------------------------------------------------------------
create or replace view v_zone_occupancy with (security_invoker = true) as
select
  o.slug                                     as organization_slug,
  pl.slug                                    as place_slug,
  az.zone_key,
  az.label                                   as zone_label,
  s.profile_id,
  p.display_name,
  zv.entered_at,
  zv.left_at,
  coalesce(zv.left_at, now()) - zv.entered_at as duration,
  zv.left_at is null                          as ongoing
from zone_visits zv
join sessions s       on s.id = zv.session_id
join places pl        on pl.id = s.place_id
join organizations o  on o.id = pl.organization_id
join profiles p       on p.id = s.profile_id
join audio_zones az   on az.id = zv.audio_zone_id;

create or replace view v_place_activity with (security_invoker = true) as
select
  pl.id                                          as place_id,
  o.slug                                         as organization_slug,
  pl.slug                                        as place_slug,
  pl.scenario_id,
  count(s.id)                                    as sessions_total,
  count(distinct s.profile_id)                   as people_total,
  count(s.id) filter (where s.left_at is null)   as sessions_open,
  sum(coalesce(s.left_at, now()) - s.joined_at)  as time_total,
  max(s.joined_at)                               as last_join
from places pl
join organizations o on o.id = pl.organization_id
left join sessions s on s.place_id = pl.id
group by pl.id, o.slug, pl.slug, pl.scenario_id;

create or replace view v_screen_share_summary with (security_invoker = true) as
select
  o.slug                                             as organization_slug,
  pl.slug                                            as place_slug,
  s.profile_id,
  p.display_name,
  count(*)                                           as shares_total,
  sum(coalesce(sh.ended_at, now()) - sh.started_at)  as time_total,
  max(sh.started_at)                                 as last_share
from screen_shares sh
join sessions s      on s.id = sh.session_id
join places pl       on pl.id = s.place_id
join organizations o on o.id = pl.organization_id
join profiles p      on p.id = s.profile_id
group by o.slug, pl.slug, s.profile_id, p.display_name;
