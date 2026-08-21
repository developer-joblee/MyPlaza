-- =============================================================================
-- toGether / MyPlaza — 0002_rls
-- Row Level Security em TODAS as tabelas.
--
-- Regra do MVP, em uma frase: **o servidor escreve, o navegador só lê o que é
-- da sua empresa.**
--
-- Por que isso importa: a `anon key` do Supabase vai para o bundle do navegador
-- por design (é publicável). O que impede alguém de ler o banco com ela não é a
-- chave — é o RLS. Sem política, RLS nega tudo, e é exatamente esse o default
-- que queremos: NÃO existe nenhuma política de INSERT/UPDATE/DELETE aqui.
-- Escrita acontece só pelo `service_role` (o servidor), que passa por cima do
-- RLS por definição e nunca sai de `server/src/`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Quem sou eu, do ponto de vista do banco. `auth.uid()` é a conta; aqui vira o
-- id interno do perfil. Enquanto o login não existir, isto devolve NULL para
-- todo mundo — e todas as políticas abaixo negam. É o comportamento desejado:
-- hoje ninguém lê pelo navegador.
-- -----------------------------------------------------------------------------
create or replace function app_current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from profiles where auth_user_id = auth.uid();
$$;

-- -----------------------------------------------------------------------------
-- Sou membro ativo desta empresa?
--
-- `security definer` é OBRIGATÓRIO aqui: a função lê `memberships`, e
-- `memberships` tem política que chama esta função. Sem `definer` isso é
-- recursão infinita de RLS e o Postgres aborta a query.
-- -----------------------------------------------------------------------------
create or replace function app_is_org_member(org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from memberships m
    where m.organization_id = org
      and m.status = 'active'
      and m.profile_id = app_current_profile_id()
  );
$$;

-- Posso ver este local? Aberto à empresa, ou explicitamente convidado nele.
create or replace function app_can_see_place(place uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from places p
    where p.id = place
      and app_is_org_member(p.organization_id)
      and (
        p.visibility = 'organization'
        or exists (
          select 1 from place_members pm
          where pm.place_id = p.id
            and pm.profile_id = app_current_profile_id()
        )
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Liga o RLS. Tabela com RLS ligada e sem política = ninguém lê (menos o
-- service_role). É o default seguro.
-- -----------------------------------------------------------------------------
alter table characters     enable row level security;
alter table scenarios      enable row level security;
alter table organizations  enable row level security;
alter table profiles       enable row level security;
alter table memberships    enable row level security;
alter table invites        enable row level security;
alter table places         enable row level security;
alter table place_members  enable row level security;
alter table sessions       enable row level security;
alter table presence_state enable row level security;
alter table chat_messages  enable row level security;

-- -----------------------------------------------------------------------------
-- Leitura. `drop policy if exists` antes de cada uma para o arquivo poder ser
-- reaplicado (Postgres não tem `create policy if not exists`).
-- -----------------------------------------------------------------------------

-- Referência (ids de personagem e cenário): não é segredo, é catálogo.
drop policy if exists characters_read on characters;
create policy characters_read on characters
  for select to authenticated using (true);

drop policy if exists scenarios_read on scenarios;
create policy scenarios_read on scenarios
  for select to authenticated using (true);

drop policy if exists organizations_read on organizations;
create policy organizations_read on organizations
  for select to authenticated using (app_is_org_member(id));

-- O próprio perfil, sempre; os outros, só se dividem uma empresa comigo.
drop policy if exists profiles_read on profiles;
create policy profiles_read on profiles
  for select to authenticated using (
    id = app_current_profile_id()
    or exists (
      select 1 from memberships mine
      join memberships theirs on theirs.organization_id = mine.organization_id
      where mine.profile_id = app_current_profile_id()
        and mine.status = 'active'
        and theirs.profile_id = profiles.id
        and theirs.status = 'active'
    )
  );

drop policy if exists memberships_read on memberships;
create policy memberships_read on memberships
  for select to authenticated using (app_is_org_member(organization_id));

-- Convite NÃO é legível pelo navegador: o `token` é o segredo do link, e quem
-- pode ler a linha pode entrar na empresa. Aceitar convite passa pelo servidor.
-- (RLS ligada, nenhuma política = negado.)

drop policy if exists places_read on places;
create policy places_read on places
  for select to authenticated using (app_can_see_place(id));

drop policy if exists place_members_read on place_members;
create policy place_members_read on place_members
  for select to authenticated using (app_can_see_place(place_id));

drop policy if exists sessions_read on sessions;
create policy sessions_read on sessions
  for select to authenticated using (app_can_see_place(place_id));

drop policy if exists presence_state_read on presence_state;
create policy presence_state_read on presence_state
  for select to authenticated using (app_can_see_place(place_id));

drop policy if exists chat_messages_read on chat_messages;
create policy chat_messages_read on chat_messages
  for select to authenticated using (app_can_see_place(place_id));
