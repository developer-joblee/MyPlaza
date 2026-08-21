-- =============================================================================
-- toGether / MyPlaza — 0009_world_binding
-- O vínculo da pessoa com o mundo passa a guardar o NOME (e a cor).
--
-- Aplicação manual, depois de 0008 (ver `db/README.md`).
--
-- PROBLEMA QUE ISTO RESOLVE: nome, cor e personagem eram escolhidos na tela de
-- entrada e gravados só em `profiles` — de onde nunca voltavam para o cliente.
-- Resultado: toda entrada num mundo pedia o nome de novo, mesmo para quem já
-- tinha entrado ali cem vezes. A persistência era de mão única.
--
-- POR QUE `presence_state` E NÃO UMA TABELA NOVA: ela já é exatamente "uma
-- linha por (local, perfil)" — o vínculo que se queria —, já é escrita a cada
-- entrada/saída pelo mesmo `savePosition()`, e já guardava `character_id`, que
-- é aparência e não posição. Nome e cor vão para o lado dele; nada de tabela
-- nova, nada de segunda escrita por join.
--
-- POR QUE **NÃO** É `place_members`: aquela tabela é a LISTA DE ACESSO de mundo
-- restrito. Criar linha lá a cada entrada faria com que todo mundo que já
-- passou por um mundo aberto à empresa continuasse dentro no dia em que o dono
-- o tornasse restrito — um vazamento de acesso disfarçado de conveniência.
-- Vínculo (já estive aqui, e me chamo assim) e acesso (posso entrar) são coisas
-- diferentes de propósito.
--
-- POR QUE AS COLUNAS SÃO NULLABLE: linha que já existe (de quem entrou antes
-- desta migração) não tem nome, e `null` é a resposta certa — "não sei como
-- essa pessoa se chama neste mundo", que a tela de entrada resolve perguntando
-- uma vez. Um default artificial ('Anônimo') faria o app deixar de perguntar e
-- entrar com o nome errado, que é pior que perguntar.
--
-- Idempotente: rodar de novo não muda nada.
-- =============================================================================

alter table presence_state add column if not exists display_name text;
alter table presence_state add column if not exists avatar_color integer;

-- Os limites espelham `profiles`: 1..20 é o NAME_MAX_LENGTH de
-- `shared/src/constants.ts`, e a cor é o mesmo 0xRRGGBB do AVATAR_COLORS.
-- `drop` antes de `add` porque o Postgres não tem `add constraint if not
-- exists` — é o mesmo idioma da 0004.
alter table presence_state drop constraint if exists presence_state_name_len;
alter table presence_state add constraint presence_state_name_len
  check (display_name is null or char_length(display_name) between 1 and 20);

alter table presence_state drop constraint if exists presence_state_color_range;
alter table presence_state add constraint presence_state_color_range
  check (avatar_color is null or avatar_color between 0 and 16777215);

-- O lobby lê o vínculo de TODOS os mundos de uma pessoa numa consulta só
-- (`listWorldsFor`), então o índice útil é por perfil — e ele já existe desde
-- 0001 (`presence_state_profile_idx`). Nada a criar aqui.
