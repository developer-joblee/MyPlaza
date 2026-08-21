-- =============================================================================
-- toGether / MyPlaza — 0010_soundboard
-- Soundboard gamificado: sons do próprio usuário, liberados por tempo na
-- plataforma.
--
-- Aplicação manual, depois de 0009 (ver `db/README.md`).
--
-- Três coisas entram aqui:
--   1. `profiles.presence_seconds` — o tempo acumulado que libera os slots;
--   2. `user_sounds`               — os sons de cada pessoa (metadado; o arquivo
--                                   vive no Storage);
--   3. o bucket privado `soundboard`.
--
-- POR QUE UMA COLUNA ACUMULADA, E NÃO UMA VIEW SOMANDO `sessions`: os dados
-- brutos estão lá (`joined_at`/`left_at`), mas somar é uma armadilha conhecida
-- neste schema — sessão que morre com o processo fica com `left_at is null`
-- para sempre, e `coalesce(left_at, now())` (o que a `v_place_activity` faz)
-- contaria dias de alguém que saiu. O servidor credita em fatias de
-- `PRESENCE_CREDIT_MS`, então uma queda custa no máximo uma fatia. De quebra, a
-- leitura no `join` é um campo em vez de um `sum` sobre o histórico inteiro.
--
-- POR QUE UMA FUNÇÃO PARA INCREMENTAR: o supabase-js não expressa
-- `set x = x + n` — só manda valores. Ler-e-escrever da aplicação perderia
-- crédito com duas abas abertas (as duas leem 100, as duas escrevem 160, e um
-- minuto some). O incremento tem de acontecer no banco, num statement só.
--
-- POR QUE O ARQUIVO NÃO VAI NO POSTGRES: áudio é binário grande e frio; a linha
-- aqui guarda o CAMINHO no Storage. O bucket é **privado** e o servidor assina
-- a URL de leitura na hora — mesmo desenho do token do LiveKit em
-- `server/src/voice.ts`.
--
-- SEM POLÍTICA DE ESCRITA, como em todas as outras tabelas: quem escreve é o
-- `service_role` (o servidor), que passa por cima do RLS. Ver `0002_rls.sql`.
--
-- Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- ---------------------------------------------------------------- 1. o tempo
alter table profiles add column if not exists presence_seconds bigint not null default 0;

-- Não existe tempo negativo, e um número negativo aqui liberaria zero slot em
-- silêncio (`slotsFor` devolve 0) — melhor o banco recusar a escrita torta.
alter table profiles drop constraint if exists profiles_presence_seconds_check;
alter table profiles add constraint profiles_presence_seconds_check
  check (presence_seconds >= 0);

/*
 * Credita presença de forma atômica. `security definer` para poder ser chamada
 * sem depender do papel de quem chama (hoje só o `service_role` chama), e
 * `search_path` fixo porque `security definer` sem isso é um vetor de
 * escalonamento clássico no Postgres.
 *
 * Devolve o total novo: o servidor precisa dele para decidir slots sem uma
 * segunda consulta.
 */
create or replace function app_add_presence_seconds(p_profile uuid, p_seconds integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  total bigint;
begin
  -- fatia negativa ou absurda é bug de quem chama, não crédito: ignora e
  -- devolve o total atual, sem falhar (o servidor é fail-soft e engoliria o
  -- erro de qualquer forma — melhor não sujar o dado)
  if p_seconds is null or p_seconds <= 0 or p_seconds > 86400 then
    select presence_seconds into total from profiles where id = p_profile;
    return coalesce(total, 0);
  end if;

  update profiles
     set presence_seconds = presence_seconds + p_seconds
   where id = p_profile
  returning presence_seconds into total;

  return coalesce(total, 0);
end;
$$;

-- --------------------------------------------------------------- 2. os sons
create table if not exists user_sounds (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null references profiles (id) on delete cascade,
  -- posição na grade; o teto real (SOUND_MAX_SLOTS) é o último marco de
  -- `shared/src/levels.ts`. Aqui vai um limite frouxo de sanidade, porque a
  -- tabela de marcos pode crescer sem migração.
  slot         smallint not null check (slot >= 1 and slot <= 32),
  label        text not null check (char_length(label) between 1 and 24),
  -- caminho no bucket `soundboard`, ex.: `<profile_id>/<uuid>.mp3`
  storage_path text not null unique,
  mime         text not null,
  bytes        integer not null check (bytes > 0),
  -- medida no navegador de quem subiu; o servidor não decodifica áudio, então
  -- isto é informativo (a tela mostra "0:03"), nunca controle de acesso
  duration_ms  integer,
  created_at   timestamptz not null default now(),
  -- um som por slot: é o que faz "trocar o som do slot 2" ser remover e subir,
  -- em vez de acumular arquivos órfãos no Storage
  unique (profile_id, slot)
);

create index if not exists user_sounds_profile_idx on user_sounds (profile_id, slot);

-- ------------------------------------------------------------------ 3. RLS
alter table user_sounds enable row level security;

-- Leitura só dos próprios sons. Som é pessoal e global (segue a pessoa em
-- qualquer mundo), então não há nada de empresa nem de local para consultar
-- aqui — diferente de `presence_state`. E, como em todo o resto do schema,
-- **nenhuma** política de escrita: o servidor escreve com `service_role`.
drop policy if exists user_sounds_select_own on user_sounds;
create policy user_sounds_select_own on user_sounds
  for select to authenticated
  using (profile_id = app_current_profile_id());

-- --------------------------------------------------------------- 4. bucket
/*
 * Bucket PRIVADO. Sem política em `storage.objects`, então nem `anon` nem
 * `authenticated` alcançam o arquivo: só o `service_role`, que assina a URL de
 * leitura por algumas horas quando alguém toca o som.
 *
 * Público seria mais simples e está errado: URL de bucket público é adivinhável
 * a partir do caminho, e o caminho contém o `profile_id`. O áudio é do usuário,
 * não do mundo.
 */
-- NOTA: a whitelist abaixo ganha `audio/wav` na `0011` (o corte automático de
-- áudio no cliente reescreve em wav). Este arquivo fica como foi aplicado.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'soundboard',
  'soundboard',
  false,
  524288, -- SOUND_MAX_BYTES (512 KB) de `shared/src/constants.ts`
  array['audio/mpeg', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac']
)
on conflict (id) do nothing;
