-- -----------------------------------------------------------------------------
-- 0007 — profiles.id ganha default
--
-- BUG QUE ISTO CORRIGE: `profiles` era a única das sete tabelas com
-- `uuid primary key` SEM `default gen_random_uuid()`. Era assim de propósito
-- quando o id vinha do CLIENTE (o id anônimo do antigo
-- `shared/src/identity.ts`, guardado no localStorage). Quando a identidade
-- passou para o Supabase Auth, esse arquivo foi removido — e a coluna ficou sem
-- ninguém para preenchê-la.
--
-- Efeito: todo insert de perfil (`ensureProfile`, `findOrCreateProfile`, que não
-- passam `id`) falhava com "null value in column id violates not-null
-- constraint". Como as duas funções são fail-soft, o erro virava `null`, e o
-- lobby traduzia `null` em `invalid-token` — a pessoa via "Sua sessão expirou"
-- e ninguém conseguia entrar. O sintoma não tinha nenhuma relação com a causa.
--
-- Idempotente: rodar de novo não muda nada.
-- -----------------------------------------------------------------------------

alter table profiles alter column id set default gen_random_uuid();
