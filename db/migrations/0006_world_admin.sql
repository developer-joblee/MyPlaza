-- =============================================================================
-- toGether / MyPlaza — 0006_world_admin
-- Gerenciar o mundo depois de criado: arquivar, renomear, mudar lotação e
-- visibilidade, tirar membro, revogar convite.
--
-- Aplicação manual, depois de 0005 (ver `db/README.md`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- places.archived_at — "remover" um mundo é arquivar, não apagar.
--
-- CINCO tabelas referenciam `places` com `on delete cascade`: place_members,
-- sessions, presence_state, chat_messages e invites. Um `delete from places`
-- levaria embora todo o histórico de conversa e de presença daquele mundo, sem
-- volta e sem aviso — e é justamente o histórico que o resto do schema existe
-- para guardar.
--
-- Arquivar faz o que a tela promete (o mundo sai do lobby e ninguém entra mais)
-- e é reversível: `update places set archived_at = null`. Quem quiser apagar de
-- verdade faz o `delete` à mão, ciente do que vai junto.
-- -----------------------------------------------------------------------------
alter table places add column if not exists archived_at timestamptz;

-- A listagem do lobby e o portão do `join` filtram por isto, sempre.
create index if not exists places_active_idx
  on places (organization_id)
  where archived_at is null;

-- -----------------------------------------------------------------------------
-- Mundo arquivado não conta em nenhuma view de operação: ele não existe mais do
-- ponto de vista de quem usa. O histórico continua consultável pelas tabelas.
-- -----------------------------------------------------------------------------
create or replace view v_place_occupancy with (security_invoker = true) as
select
  pl.id                                          as place_id,
  o.slug                                         as organization_slug,
  pl.slug                                        as place_slug,
  pl.capacity,
  count(s.id) filter (where s.left_at is null)   as inside_now,
  case
    when pl.capacity is null then null
    else greatest(pl.capacity - count(s.id) filter (where s.left_at is null), 0)
  end                                            as seats_left
from places pl
join organizations o on o.id = pl.organization_id
left join sessions s on s.place_id = pl.id
where pl.archived_at is null
group by pl.id, o.slug, pl.slug, pl.capacity;

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
where pl.archived_at is null
group by pl.id, o.slug, pl.slug, pl.scenario_id;
