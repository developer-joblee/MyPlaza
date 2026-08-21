-- -----------------------------------------------------------------------------
-- 0008 — privilégios de tabela para o service_role
--
-- BUG QUE ISTO CORRIGE:
--   [db] ensureProfile: { code: '42501',
--     message: 'permission denied for table profiles',
--     hint: 'GRANT SELECT ON public.profiles TO service_role;' }
--
-- Nenhuma migração nossa revoga nada — o service_role simplesmente nunca
-- recebeu o privilégio. O Supabase concede acesso às tabelas de `public` por
-- DEFAULT PRIVILEGES, e default privilege é registrada **por papel que cria o
-- objeto**: ela vale para o que o `postgres` cria. Schema aplicado por outro
-- papel (`supabase_admin`, um superusuário próprio, alguma ferramenta de
-- migração) cria tabela sem esses grants, e o service_role fica de fora.
--
-- Importante: `service_role` tem BYPASSRLS, mas ignorar RLS **não** dispensa
-- privilégio de tabela. São dois controles distintos, e faltava o segundo — por
-- isso o erro aparecia mesmo com RLS "aberto" para ele.
--
-- Sintoma no app: `ensureProfile` falha, o lobby responde `error` e ninguém
-- entra. (Antes da correção de diagnóstico da 0007 isso aparecia como
-- "Sua sessão expirou", que não tinha relação com a causa.)
--
-- POR QUE SÓ O service_role, e não `anon`/`authenticated`: só o servidor lê e
-- escreve neste app — o navegador fala por Socket.IO, não com o banco. As
-- políticas de leitura do `0002_rls.sql` existem como rede de segurança, não
-- como caminho em uso. Menor privilégio: quem não precisa, não recebe. Se algum
-- dia o client for ler direto (com a anon key), o grant a `anon, authenticated`
-- é uma decisão explícita a se tomar ali — e é segura porque as 15 tabelas têm
-- RLS habilitado e nenhuma política de escrita.
--
-- Idempotente: `grant` repetido não muda nada. Rodar de novo é seguro.
-- -----------------------------------------------------------------------------

grant usage on schema public to service_role;

-- as tabelas que existem agora (0001 → 0007)
grant all privileges on all tables in schema public to service_role;

-- não há coluna `serial` hoje (as PKs são uuid), então isto é no-op — fica para
-- não virar o próximo 42501 se alguém adicionar uma
grant all privileges on all sequences in schema public to service_role;

-- e as tabelas que vierem depois desta migração, para o problema não voltar.
-- Vale para objetos criados pelo papel que EXECUTA este comando — rode as
-- migrações sempre com o mesmo papel.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
