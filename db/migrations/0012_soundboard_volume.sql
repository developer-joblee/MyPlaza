-- =============================================================================
-- toGether / MyPlaza — 0012_soundboard_volume
-- O volume do soundboard passa a viver no perfil.
--
-- Aplicação manual, depois de 0011 (ver `db/README.md`).
--
-- POR QUE NO BANCO, E NÃO NO `localStorage` COMO O RESTO DAS PREFERÊNCIAS DE
-- ÁUDIO: as outras (microfone escolhido, cancelamento de ruído, mute rápido do
-- soundboard) são propriedades do **dispositivo** — o microfone do laptop não é o
-- da mesa, e silenciar "agora" não é uma decisão duradoura. "Sons de soundboard
-- me incomodam a 100%" é propriedade da **pessoa**, e refazer esse ajuste em cada
-- navegador é exatamente o tipo de atrito que faz alguém desistir da feature.
--
-- POR QUE `smallint` 0..100 E NÃO UM `real` 0..1: é o número que a tela mostra e
-- que atravessa a rede duas vezes (ida e volta). Inteiro não acumula erro de
-- ponto flutuante nem aparece como `0.7000000000000001` no banco; a conversão
-- para ganho de áudio (÷100) acontece num lugar só, no `SoundPlayer` do cliente.
--
-- O default 70 espelha `SOUND_VOLUME_DEFAULT` de `shared/src/constants.ts`, e a
-- razão de não ser 100 está lá: som de soundboard é interrupção, e o arquivo é de
-- terceiro — melhor nascer com margem para subir do que fazer a primeira
-- experiência de todos ser um susto.
--
-- Idempotente: rodar de novo não muda nada.
-- =============================================================================

alter table profiles add column if not exists soundboard_volume smallint not null default 70;

-- `drop` antes de `add` porque o Postgres não tem `add constraint if not exists`
-- — mesmo idioma da 0004 e da 0009.
alter table profiles drop constraint if exists profiles_soundboard_volume_check;
alter table profiles add constraint profiles_soundboard_volume_check
  check (soundboard_volume between 0 and 100);
