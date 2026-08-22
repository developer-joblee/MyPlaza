-- =============================================================================
-- 0016 — Editor de móveis: a camada dinâmica de móveis por mundo.
--
-- O mapa ASCII continua sendo a fonte de chão/paredes/zonas; esta tabela guarda
-- só o que foi colocado POR CIMA, pelo editor (quem administra o mundo). O
-- catálogo de móveis vive no código (`shared/src/furniture.ts`), como
-- characters/scenarios — o banco não valida `furniture_id` de propósito: a
-- fonte de verdade da validade é o TypeScript, e o servidor valida antes de
-- escrever.
--
-- Sem UNIQUE por tile: um móvel ocupa `w x h` tiles (footprint no catálogo), e
-- a sobreposição é validada pelo servidor em memória, que é quem tem o mapa.
-- =============================================================================

create table if not exists world_furniture (
  id           uuid primary key default gen_random_uuid(),
  place_id     uuid not null references places (id) on delete cascade,
  furniture_id text not null,
  tile_x       smallint not null check (tile_x >= 0),
  tile_y       smallint not null check (tile_y >= 0),
  -- reservado para a v2 (variantes de orientação); hoje sempre 0
  rotation     smallint not null default 0,
  placed_by    uuid references profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists world_furniture_place_idx on world_furniture (place_id);

-- mesmo padrão das outras tabelas: ninguém escreve pelo navegador (RLS sem
-- política de escrita; só o service_role do servidor passa)
alter table world_furniture enable row level security;

grant select, insert, update, delete on world_furniture to service_role;
