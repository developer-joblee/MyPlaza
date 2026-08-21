-- =============================================================================
-- toGether / MyPlaza — seed
--
-- NÃO é migration: é dado inicial. Rode depois de `0001_init.sql`,
-- `0002_rls.sql` e `0003_activity.sql`. Pode rodar de novo sem estragar nada
-- (tudo é upsert).
--
-- Duas partes:
--   1. Catálogo (characters, scenarios, audio_zones) — espelho de `shared/src/`.
--      OBRIGATÓRIO: sem ele os FKs de profiles/places/sessions/presence_state e
--      zone_visits não fecham.
--   2. Empresa de demonstração + um local por cenário. Isto é conveniência do
--      MVP: o servidor procura a empresa por slug (SUPABASE_ORG_SLUG) e o local
--      pelo par (empresa, cenário).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Catálogo — os ids TÊM que casar com `shared/src/constants.ts` (CHARACTERS)
--    e `shared/src/scenarios.ts` (SCENARIOS). Adicionou um lá? Adicione aqui.
-- -----------------------------------------------------------------------------
insert into characters (id, label, sort_order) values
  ('adam',   'Adam',   1),
  ('alex',   'Alex',   2),
  ('amelia', 'Amélia', 3),
  ('bob',    'Bob',    4)
on conflict (id) do update
  set label = excluded.label,
      sort_order = excluded.sort_order;

-- Três cenários do MESMO estilo de arte (Modern Interiors + Modern Office,
-- LimeZu). O `office` daqui NÃO é o escritório procedural antigo — aquele saiu
-- com a `0013_single_scenario.sql` (que é o único lugar que remove; rode-a
-- antes deste seed num banco de antes). Este insert não apaga nada.
insert into scenarios (id, label, description, sort_order) values
  ('studio', 'Estúdio',    'Escritório moderno', 1),
  ('office', 'Escritório', 'Open space com reunião e copa', 2),
  ('cafe',   'Café',       'Balcão, mesas e sala reservada', 3)
on conflict (id) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order;

-- Zonas de áudio (salas fechadas), espelhando `audioZones` de
-- `shared/src/scenarios.ts`. Só id e rótulo: o retângulo é do mapa, e ter a
-- geometria em dois lugares é ter duas verdades. Hoje só o Estúdio tem zonas.
-- Requer `0003_activity.sql` aplicado.
insert into audio_zones (scenario_id, zone_key, label) values
  ('studio', 'reuniao',   'Sala de reunião'),
  ('studio', 'copa',      'Copa'),
  ('office', 'reuniao',   'Sala de reunião'),
  ('office', 'copa',      'Copa'),
  ('cafe',   'reservada', 'Sala reservada')
on conflict (scenario_id, zone_key) do update
  set label = excluded.label;

-- -----------------------------------------------------------------------------
-- 2. Empresa de demonstração.
--    Troque `demo` / 'Equipe demo' pelo slug e nome reais, e mantenha o
--    SUPABASE_ORG_SLUG do `.env` igual ao slug daqui.
-- -----------------------------------------------------------------------------
insert into organizations (slug, name) values
  ('demo', 'Equipe demo')
on conflict (slug) do update set name = excluded.name;

-- Um local por cenário — hoje, portanto, um só: o Estúdio (que é também o
-- DEFAULT_SCENARIO do shared). O slug do local é o próprio id do cenário para o
-- MVP: um local por cenário por empresa. Quando existirem dois Estúdios na mesma
-- empresa, os slugs passam a divergir e nada aqui precisa mudar.
--
-- O `cross join` continua: entrando um cenário novo no catálogo acima, o local
-- dele nasce na próxima rodada do seed.
insert into places (organization_id, scenario_id, slug, name, is_default)
select o.id, s.id, s.id, s.label, (s.id = 'studio')
from organizations o
cross join scenarios s
where o.slug = 'demo'
on conflict (organization_id, slug) do update
  set name = excluded.name,
      scenario_id = excluded.scenario_id;
