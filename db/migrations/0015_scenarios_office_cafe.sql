-- =============================================================================
-- 0015 — Cenários novos: Escritório (office) e Café (cafe).
--
-- Espelho de `shared/src/scenarios.ts` (SCENARIOS) no catálogo, mais as zonas
-- de áudio de cada um. Pré-requisito: 0013 aplicada (ela limpa o catálogo dos
-- cenários ANTIGOS — o `office` daqui é outro, do estilo Modern; sem a 0013 o
-- upsert abaixo só renomearia a linha antiga, e locais pré-históricos apontando
-- para ela passariam a abrir o mapa novo, o que é aceitável mas surpreende).
--
-- Idempotente: rodar de novo não estraga nada. O local de demonstração de cada
-- cenário novo nasce na próxima rodada do `seed.sql` (cross join de lá).
-- =============================================================================

insert into scenarios (id, label, description, sort_order) values
  ('office', 'Escritório', 'Open space com reunião e copa', 2),
  ('cafe',   'Café',       'Balcão, mesas e sala reservada', 3)
on conflict (id) do update
  set label = excluded.label,
      description = excluded.description,
      sort_order = excluded.sort_order;

insert into audio_zones (scenario_id, zone_key, label) values
  ('office', 'reuniao',   'Sala de reunião'),
  ('office', 'copa',      'Copa'),
  ('cafe',   'reservada', 'Sala reservada')
on conflict (scenario_id, zone_key) do update
  set label = excluded.label;
