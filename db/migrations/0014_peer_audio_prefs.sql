-- =============================================================================
-- toGether / MyPlaza — 0014_peer_audio_prefs
-- Volume por pessoa: quanto EU ouço a voz e os sons de soundboard de CADA um.
--
-- Aplicação manual, depois de 0013 (ver `db/README.md`).
--
-- POR QUE UMA TABELA, E NÃO MAIS DUAS COLUNAS EM `profiles`: o dado é uma
-- relação (eu × ela), não um atributo meu. `profiles.soundboard_volume` é
-- "quanto eu ouço soundboard" e cabe numa coluna porque é um número por pessoa;
-- "quanto eu ouço o Bruno" é um número por PAR, e par não cabe em coluna.
--
-- POR QUE PERSISTIR ISSO, se o mute por pessoa que já existe (`mutedSenders` no
-- cliente) é de sessão de propósito: são coisas diferentes. Aquele é um
-- "silencia agora" chaveado por `socket.id`, que morre com a conexão porque
-- silenciar alguém para sempre é moderação. Este é uma mixagem — "a voz dela
-- estoura no meu fone, os sons dela me interrompem" — e refazer isso a cada F5,
-- pessoa por pessoa, é o tipo de atrito que faz alguém desistir da feature. É o
-- mesmo argumento que colocou `soundboard_volume` no banco na 0012.
--
-- POR QUE `smallint` 0..100 E NÃO `real` 0..1: mesma razão da 0012 — é o número
-- que o slider mostra e que atravessa a rede duas vezes. Inteiro não vira
-- `0.5000000000000001`; a divisão por 100 acontece num lugar só, no cliente.
--
-- POR QUE O DEFAULT É 100 (e não 70 como o volume global do soundboard): quem
-- nunca ajustou ninguém não pode ouvir o mundo diferente de ontem. Linha ausente
-- e linha com 100/100 significam a mesma coisa, e o servidor trata as duas
-- igual — é por isso que ele grava o par inteiro em vez de apagar no 100.
--
-- Idempotente: rodar de novo não muda nada.
-- =============================================================================

create table if not exists peer_audio_prefs (
  -- quem OUVE (dono da preferência)
  profile_id        uuid not null references profiles(id) on delete cascade,
  -- de QUEM (a pessoa ouvida)
  target_profile_id uuid not null references profiles(id) on delete cascade,
  voice_volume smallint not null default 100,
  sound_volume smallint not null default 100,
  updated_at   timestamptz not null default now(),
  -- um ajuste por par, e é ele que faz a escrita ser upsert em vez de acumular
  -- histórico: ninguém quer saber que o Bruno já esteve em 40%.
  primary key (profile_id, target_profile_id),
  constraint peer_audio_prefs_voice_check check (voice_volume between 0 and 100),
  constraint peer_audio_prefs_sound_check check (sound_volume between 0 and 100),
  -- ajustar o próprio volume não existe (o menu de contexto no seu boneco não
  -- mostra os sliders). A checagem existe para o banco não guardar um estado que
  -- nenhuma tela sabe ler.
  constraint peer_audio_prefs_not_self  check (profile_id <> target_profile_id)
);

-- O servidor lê SEMPRE por `profile_id` (o mapa inteiro de quem entrou), nunca
-- pelo alvo — então a PK já é o índice de que ele precisa e não há segundo
-- índice aqui de propósito.

-- ------------------------------------------------------------------ RLS
alter table peer_audio_prefs enable row level security;

-- Leitura só das próprias linhas. Isto é mais que higiene: a linha revela que
-- EU baixei o volume DAQUELA pessoa, e ela não tem nada a ver com isso — é o
-- tipo de dado que, vazando, muda a relação entre duas pessoas. Por isso a
-- política olha `profile_id` (quem ouve) e nunca `target_profile_id`.
--
-- E, como em todo o resto do schema, **nenhuma** política de escrita: o servidor
-- escreve com `service_role`.
drop policy if exists peer_audio_prefs_select_own on peer_audio_prefs;
create policy peer_audio_prefs_select_own on peer_audio_prefs
  for select to authenticated
  using (profile_id = app_current_profile_id());

-- --------------------------------------------------------------- grant
--
-- As *default privileges* da 0008 já cobririam esta tabela — mas só se ela for
-- criada pelo MESMO papel que rodou a 0008, e a própria 0008 existe porque essa
-- aposta já falhou uma vez neste projeto. O sintoma sem o grant é
-- `42501 permission denied for table peer_audio_prefs`, e ele é especialmente
-- ruim aqui: o `db.ts` é fail-soft, então o volume simplesmente nunca persiste,
-- sem erro nenhum na tela.
--
-- Só o `service_role`, por menor privilégio: nem `anon` nem `authenticated`
-- escrevem em nada neste app.
grant all privileges on table peer_audio_prefs to service_role;
