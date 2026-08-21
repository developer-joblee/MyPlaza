-- =============================================================================
-- toGether / MyPlaza — 0005_lobby
-- Mundo criado por gente, e convite para UM mundo.
--
-- Até aqui os locais vinham do `seed.sql` e o convite era para a empresa toda.
-- O lobby inverte isso: quem cria o mundo é o usuário, e convidar é para o
-- mundo específico.
--
-- Aplicação manual, depois de 0004 (ver `db/README.md`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem criou. Em `places` é o dono do mundo (pode convidar); em `organizations`
-- serve para saber de quem é a empresa pessoal.
--
-- `on delete set null`: apagar o perfil não pode apagar o mundo onde outras
-- pessoas estão. Mundo sem dono é órfão, não inexistente.
-- -----------------------------------------------------------------------------
alter table places add column if not exists created_by uuid references profiles (id) on delete set null;
alter table organizations add column if not exists created_by uuid references profiles (id) on delete set null;

/**
 * Empresa pessoal: criada automaticamente para quem cria o primeiro mundo sem
 * pertencer a nenhuma empresa.
 *
 * Por que não deixar o mundo sem empresa: `organizations` é a raiz de todo o
 * acesso e de todas as políticas de RLS (`app_is_org_member`). Um local órfão
 * exigiria um segundo caminho de autorização em cada política — o dobro de
 * superfície para o mesmo resultado. A empresa pessoal mantém um caminho só, e
 * `is_personal` permite ao lobby não mostrá-la (a pessoa não pediu por uma
 * empresa; ela pediu por um mundo).
 */
alter table organizations add column if not exists is_personal boolean not null default false;

create index if not exists places_created_by_idx on places (created_by);

-- -----------------------------------------------------------------------------
-- Convite para um mundo específico. `place_id` nulo = convite para a empresa
-- toda (o comportamento de 0001, que continua valendo).
--
-- Aceitar um convite com `place_id` faz DUAS coisas: cria a membership na
-- empresa (senão a pessoa não passa pelo portão) e a linha em `place_members`
-- (senão ela não entra num mundo restrito).
-- -----------------------------------------------------------------------------
alter table invites add column if not exists place_id uuid references places (id) on delete cascade;

-- O unique parcial de 0001 era (empresa, e-mail) e agora precisaria contar o
-- mundo. Dois índices parciais em vez de um com `coalesce`: cada um diz em
-- português o que proíbe, e o planejador usa os dois.
drop index if exists invites_pending_unique;

create unique index if not exists invites_pending_org_unique
  on invites (organization_id, lower(email))
  where accepted_at is null and place_id is null;

create unique index if not exists invites_pending_place_unique
  on invites (place_id, lower(email))
  where accepted_at is null and place_id is not null;

create index if not exists invites_place_idx on invites (place_id) where accepted_at is null;

-- -----------------------------------------------------------------------------
-- Mundos criados por gente não são o mundo "padrão" de ninguém: `is_default`
-- continua sendo do seed. Nada a fazer aqui além de registrar a intenção — o
-- índice único parcial de 0001 (um default por empresa) já garante.
-- -----------------------------------------------------------------------------
