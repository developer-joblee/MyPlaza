/**
 * O editor de móveis: uma camada DINÂMICA de móveis por mundo, por cima do mapa
 * ASCII (que continua sendo a única fonte de chão, paredes, zonas e colisão
 * estática). Quem edita é quem administra o mundo; todo mundo vê na hora, e o
 * resultado persiste por mundo no banco (`world_furniture`, migração 0016).
 *
 * O catálogo vive aqui porque os DOIS lados o usam: o servidor valida
 * (`furnitureId` existe, footprint dentro do mapa e sobre piso caminhável, sem
 * sobrepor outro móvel, teto por mundo) e o cliente desenha e mostra a paleta.
 * A ARTE de cada móvel não está aqui de propósito — arte não é protocolo; o
 * frame do atlas correspondente mora em `client/src/game/furnitureArt.ts`.
 *
 * Desde a v2, os móveis do editor COLIDEM como os do mapa (`solid: true` em
 * todos — são objetos físicos): o cliente soma a camada dinâmica ao
 * `isSolidAt`, e o servidor recusa colocar em cima de alguém e não restaura
 * posição salva dentro de móvel.
 */

export interface FurnitureDef {
  id: string;
  label: string;
  /** footprint em tiles (a arte pode ser mais alta; a base é o que ocupa) */
  w: number;
  h: number;
  /** colide como os móveis do mapa (v2); `false` seria puramente decorativo */
  solid: boolean;
}

export const FURNITURE_CATALOG: readonly FurnitureDef[] = [
  { id: 'plant_small', label: 'Planta', w: 1, h: 1, solid: true },
  { id: 'plant_palm', label: 'Palmeira', w: 1, h: 1, solid: true },
  { id: 'globe', label: 'Globo', w: 1, h: 1, solid: true },
  { id: 'stool', label: 'Banqueta', w: 1, h: 1, solid: true },
  { id: 'fridge', label: 'Geladeira', w: 1, h: 1, solid: true },
  { id: 'vending', label: 'Máquina de venda', w: 1, h: 1, solid: true },
  { id: 'sofa_small', label: 'Sofá pequeno', w: 2, h: 1, solid: true },
  { id: 'sofa_big', label: 'Sofá grande', w: 3, h: 1, solid: true },
  { id: 'shelf', label: 'Estante', w: 2, h: 1, solid: true },
  { id: 'counter', label: 'Balcão', w: 2, h: 1, solid: true },
  { id: 'coffee_station', label: 'Estação de café', w: 2, h: 1, solid: true },
  { id: 'easel', label: 'Cavalete', w: 2, h: 1, solid: true },
] as const;

export type FurnitureId = (typeof FURNITURE_CATALOG)[number]['id'];

export function furnitureDef(id: FurnitureId): FurnitureDef {
  // o catálogo é pequeno e isto roda em clique, não em tick
  return FURNITURE_CATALOG.find((d) => d.id === id)!;
}

export function isFurnitureId(v: unknown): v is FurnitureId {
  return typeof v === 'string' && FURNITURE_CATALOG.some((d) => d.id === v);
}

/** Um móvel colocado num mundo. O `id` é cunhado no servidor (uuid). */
export interface PlacedFurniture {
  id: string;
  furnitureId: FurnitureId;
  tileX: number;
  tileY: number;
  /**
   * Índice de VARIANTE de arte (a tecla R do editor). Não é rotação geométrica:
   * o pack não tem os móveis girados, então "girar" alterna entre as artes
   * disponíveis (cor/estilo) — quantas há é decisão do client
   * (`furnitureArt.ts`); o servidor só guarda o índice (0..7).
   */
  rotation: number;
}

/**
 * Resposta dos pedidos de edição. Os motivos são códigos, nunca texto livre
 * (mesma razão do `join:denied`): 'forbidden' (não administra o mundo),
 * 'invalid' (id/coordenada malformados), 'blocked' (footprint fora do mapa,
 * em cima de parede/móvel do mapa ou de outro móvel dinâmico), 'full' (teto
 * do mundo), 'not-found' (mover/remover algo que já não existe),
 * 'error' (transporte/banco).
 */
export interface FurnitureResult {
  ok: boolean;
  reason?: 'forbidden' | 'invalid' | 'blocked' | 'full' | 'not-found' | 'error';
}
