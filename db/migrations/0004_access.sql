-- =============================================================================
-- toGether / MyPlaza — 0004_access
-- Controle de acesso ao local: quantos cabem e quem pode.
--
-- Aplicação manual, depois de 0003 (ver `db/README.md`).
--
-- O que este arquivo NÃO faz: as regras de "quem pode" já estavam modeladas em
-- 0001 (`memberships`, `places.visibility`, `place_members`) e simplesmente não
-- eram respeitadas por ninguém. Quem passou a respeitar foi o servidor
-- (`server/src/handlers.ts`); aqui só entra o que faltava de schema.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- places.capacity — quantas pessoas cabem ao mesmo tempo. `null` = sem limite,
-- que é o default e o comportamento de antes.
--
-- Quem conta é o servidor, em memória (o mundo sabe quem está dentro agora), e
-- não uma query de `sessions` — contar sessão aberta no banco erraria para mais
-- em toda queda de conexão que não fechou a linha.
-- -----------------------------------------------------------------------------
alter table places add column if not exists capacity integer;

alter table places drop constraint if exists places_capacity_positive;
alter table places add constraint places_capacity_positive
  check (capacity is null or capacity > 0);

-- -----------------------------------------------------------------------------
-- Convite por e-mail é o caminho de entrada de gente nova: no primeiro login, o
-- servidor procura convite pendente para aquele e-mail e, achando, cria a
-- membership e marca o convite como aceito. Sem convite, não entra.
--
-- O índice de 0001 é por (empresa, e-mail); esta busca é só por e-mail, porque
-- na hora do login ainda não se sabe de qual empresa a pessoa é.
-- -----------------------------------------------------------------------------
create index if not exists invites_pending_email_idx
  on invites (lower(email))
  where accepted_at is null;

-- -----------------------------------------------------------------------------
-- Ocupação por local: quantas sessões estão abertas agora. Serve para conferir
-- a lotação de fora do processo (o servidor conta em memória).
--
-- `security_invoker` pelo mesmo motivo das views de 0003: sem ele a view fura o
-- RLS das tabelas de baixo.
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
group by pl.id, o.slug, pl.slug, pl.capacity;
