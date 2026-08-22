import type { CharacterId } from './constants';

/**
 * A aparência por camadas (Character Generator do Modern Interiors FULL).
 *
 * Isto é PROTOCOLO e formato de banco ao mesmo tempo: o objeto viaja no `join`
 * e no `PlayerState`, e é gravado como jsonb (`profiles.appearance`,
 * `sessions.appearance`, `presence_state.appearance` — migração 0014). Os ids
 * são derivados dos nomes de arquivo do pack (`hair_09_05` = Hairstyle_09 na
 * cor 05) e correspondem 1:1 aos PNGs curados em
 * `client/public/characters/v2/{body,eyes,hair,outfit}/` — copiados por
 * `npm run assets:characters` (a curadoria vive lá, em
 * `scripts/build-character-assets.mjs`).
 *
 * Adicionar um id novo é seguro (entra no array + roda o script). REMOVER um id
 * é quebra de dado: perfis gravados com ele passam a falhar em `isAppearance` e
 * caem no `DEFAULT_APPEARANCE` — se um dia for preciso, migre as linhas antes.
 *
 * O catálogo `characters` do banco e o `CharacterId` continuam existindo como
 * legado: perfis antigos têm só `character_id`, e o mapa
 * `LEGACY_CHARACTER_APPEARANCE` os traduz na leitura.
 */

export const BODY_IDS = [
  'body_01', 'body_02', 'body_03', 'body_04', 'body_05',
  'body_06', 'body_07', 'body_08', 'body_09',
] as const;

export const EYES_IDS = [
  'eyes_01', 'eyes_02', 'eyes_03', 'eyes_04', 'eyes_05', 'eyes_06', 'eyes_07',
] as const;

/** 10 estilos × 2 cores. `null` na aparência = sem cabelo (careca é opção). */
export const HAIR_IDS = [
  'hair_01_01', 'hair_01_05', 'hair_02_01', 'hair_02_05',
  'hair_04_01', 'hair_04_05', 'hair_05_01', 'hair_05_05',
  'hair_09_01', 'hair_09_05', 'hair_10_01', 'hair_10_05',
  'hair_13_01', 'hair_13_05', 'hair_17_01', 'hair_17_05',
  'hair_21_01', 'hair_21_05', 'hair_25_01', 'hair_25_05',
] as const;

export const OUTFIT_IDS = [
  'outfit_01_01', 'outfit_02_01', 'outfit_03_01', 'outfit_04_01', 'outfit_06_01',
  'outfit_08_01', 'outfit_10_01', 'outfit_13_01', 'outfit_16_01', 'outfit_18_01',
  'outfit_20_01', 'outfit_22_01', 'outfit_24_01', 'outfit_27_01', 'outfit_30_01',
] as const;

export type BodyId = (typeof BODY_IDS)[number];
export type EyesId = (typeof EYES_IDS)[number];
export type HairId = (typeof HAIR_IDS)[number];
export type OutfitId = (typeof OUTFIT_IDS)[number];

export interface Appearance {
  body: BodyId;
  eyes: EyesId;
  outfit: OutfitId;
  /** null = sem cabelo */
  hair: HairId | null;
  /** reservado (o pack tem 84 acessórios); sempre null na v1 */
  accessory: null;
}

export const DEFAULT_APPEARANCE: Appearance = {
  body: 'body_01',
  eyes: 'eyes_01',
  outfit: 'outfit_01_01',
  hair: 'hair_01_01',
  accessory: null,
};

/**
 * Os quatro bonecos do elenco antigo, como combinações do gerador. É o
 * fallback de leitura para `character_id` sem `appearance` (perfis e vínculos
 * criados antes da 0014) e as sugestões prontas da tela de entrada. As combos
 * são aproximações estéticas dos premades da fase 1, não réplicas.
 */
export const LEGACY_CHARACTER_APPEARANCE: Record<CharacterId, Appearance> = {
  adam: { body: 'body_02', eyes: 'eyes_01', outfit: 'outfit_02_01', hair: 'hair_01_01', accessory: null },
  alex: { body: 'body_01', eyes: 'eyes_02', outfit: 'outfit_08_01', hair: 'hair_09_05', accessory: null },
  amelia: { body: 'body_01', eyes: 'eyes_03', outfit: 'outfit_16_01', hair: 'hair_13_01', accessory: null },
  bob: { body: 'body_04', eyes: 'eyes_01', outfit: 'outfit_27_01', hair: 'hair_02_05', accessory: null },
};

const bodySet: ReadonlySet<string> = new Set(BODY_IDS);
const eyesSet: ReadonlySet<string> = new Set(EYES_IDS);
const hairSet: ReadonlySet<string> = new Set(HAIR_IDS);
const outfitSet: ReadonlySet<string> = new Set(OUTFIT_IDS);

/** Valida o objeto inteiro vindo da rede ou do banco — campo a campo. */
export function isAppearance(v: unknown): v is Appearance {
  if (typeof v !== 'object' || v === null) return false;
  const a = v as Record<string, unknown>;
  return (
    typeof a.body === 'string' && bodySet.has(a.body) &&
    typeof a.eyes === 'string' && eyesSet.has(a.eyes) &&
    typeof a.outfit === 'string' && outfitSet.has(a.outfit) &&
    (a.hair === null || (typeof a.hair === 'string' && hairSet.has(a.hair))) &&
    a.accessory === null
  );
}

/** Chave estável de cache/comparação: os campos na ordem de composição. */
export function appearanceKey(a: Appearance): string {
  return `${a.body}.${a.eyes}.${a.outfit}.${a.hair ?? '-'}`;
}

/** Sorteio da tela de entrada. `Math.random` de propósito: é escolha de UI. */
export function randomAppearance(): Appearance {
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
  // sem cabelo entra no sorteio com o mesmo peso de cada estilo
  const hairPool: (HairId | null)[] = [...HAIR_IDS, null];
  return {
    body: pick(BODY_IDS),
    eyes: pick(EYES_IDS),
    outfit: pick(OUTFIT_IDS),
    hair: pick(hairPool),
    accessory: null,
  };
}
