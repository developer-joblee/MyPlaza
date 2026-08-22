import type { FurnitureId } from '@together/shared';

/**
 * Quais frames do atlas desenham cada móvel do catálogo do editor. Vive no
 * client (arte não é protocolo) e reaproveita frames que os cenários já usam.
 *
 * Cada móvel tem uma lista de VARIANTES — é o que a tecla R do editor alterna
 * (o `rotation` do `PlacedFurniture` é o índice aqui, módulo o tamanho). Não é
 * rotação geométrica: o pack não tem os móveis girados, então "girar" troca a
 * arte (cor/estilo). Móvel de variante única simplesmente ignora o R.
 *
 * A paleta da UI usa `variants[0]` como ícone. Um móvel novo no catálogo é uma
 * linha aqui + uma no `shared/src/furniture.ts` (+ o frame no manifest do
 * atlas, se for arte inédita).
 */
export const FURNITURE_VARIANTS: Record<FurnitureId, readonly string[]> = {
  plant_small: ['studio/plant_1', 'studio/plant_2'],
  plant_palm: ['studio/plant_3'],
  globe: ['studio/globe_1', 'studio/globe_2'],
  stool: ['studio/stool'],
  fridge: ['studio/fridge'],
  vending: ['office/vending'],
  sofa_small: ['studio/sofa_small'],
  sofa_big: ['studio/sofa_big'],
  shelf: ['studio/shelf_1', 'studio/shelf_2'],
  counter: ['studio/counter_1', 'studio/counter_2'],
  coffee_station: ['cafe/coffee_station'],
  easel: ['studio/easel'],
};

/** O frame desta variante (o índice dá a volta — R pode girar para sempre). */
export function furnitureFrame(id: FurnitureId, rotation: number): string {
  const variants = FURNITURE_VARIANTS[id];
  return variants[((rotation % variants.length) + variants.length) % variants.length];
}
