-- 0014 — Aparência por camadas (Character Generator do pack pago).
--
-- Pré-requisito: 0013 aplicada.
--
-- O que muda: perfis, sessões e vínculos por mundo ganham uma coluna
-- `appearance` (jsonb) com o objeto {body, eyes, outfit, hair, accessory}.
-- A fonte de verdade da VALIDADE é o TypeScript (shared/src/appearance.ts,
-- validado por isAppearance no servidor antes de qualquer escrita), como já é
-- para characters/scenarios — por isso não há CHECK de conteúdo aqui.
--
-- `character_id` NÃO sai: continua NOT NULL com default e FK para o catálogo
-- `characters`. É o fallback de leitura para linhas de antes desta migração
-- (o servidor traduz via LEGACY_CHARACTER_APPEARANCE) e o que satisfaz a FK
-- nas escritas novas. Linha nova tem os dois: character_id legado + appearance
-- de verdade.
--
-- Nada existente quebra: coluna nova e nullable, sem reescrita de linhas.

alter table profiles       add column if not exists appearance jsonb;
alter table sessions       add column if not exists appearance jsonb;
alter table presence_state add column if not exists appearance jsonb;
