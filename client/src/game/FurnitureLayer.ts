import { Container, Sprite } from 'pixi.js';
import {
  TILE_SIZE,
  furnitureDef,
  isSolid,
  type FurnitureId,
  type PlacedFurniture,
  type WorldMap,
} from '@together/shared';
import type { TileArt } from './ModernTilemap';
import { furnitureFrame } from './furnitureArt';

/**
 * A camada dinâmica de móveis (editor). Sprites entram no `playersLayer` do
 * Game (y-sort), com a MESMA âncora e o mesmo `zIndex` do `addProp` do tilemap
 * — um móvel colocado pelo editor e um do mapa são indistinguíveis na tela.
 *
 * O estado vem 100% dos broadcasts do servidor (`furniture:snapshot/changed/
 * removed`) — inclusive o de quem editou. O ghost (prévia que segue o ponteiro
 * no modo de edição) também mora aqui, porque usa a mesma conta de posição.
 */
export class FurnitureLayer {
  private sprites = new Map<string, Sprite>();
  private ghost: Sprite | null = null;

  constructor(
    private art: TileArt,
    private map: WorldMap,
    /** o playersLayer do Game (sortableChildren) */
    private layer: Container,
  ) {}

  /** Móvel dinâmico cujo footprint cobre este tile, para pegar/remover. */
  itemAt(items: PlacedFurniture[], tileX: number, tileY: number): PlacedFurniture | null {
    for (const item of items) {
      const def = furnitureDef(item.furnitureId);
      if (
        tileX >= item.tileX && tileX < item.tileX + def.w &&
        tileY >= item.tileY && tileY < item.tileY + def.h
      ) {
        return item;
      }
    }
    return null;
  }

  /** Validação local do ghost — espelho do `World.footprintFree` (sem o teto). */
  footprintFree(furnitureId: FurnitureId, tileX: number, tileY: number, items: PlacedFurniture[], ignoreId?: string): boolean {
    const def = furnitureDef(furnitureId);
    for (let dy = 0; dy < def.h; dy++) {
      for (let dx = 0; dx < def.w; dx++) {
        const x = tileX + dx;
        const y = tileY + dy;
        if (x < 0 || y < 0 || x >= this.map.cols || y >= this.map.rows) return false;
        if (isSolid(this.map.tiles[y][x])) return false;
      }
    }
    for (const other of items) {
      if (other.id === ignoreId) continue;
      const o = furnitureDef(other.furnitureId);
      if (
        tileX < other.tileX + o.w && other.tileX < tileX + def.w &&
        tileY < other.tileY + o.h && other.tileY < tileY + def.h
      ) {
        return false;
      }
    }
    return true;
  }

  private position(sprite: Sprite, furnitureId: FurnitureId, tileX: number, tileY: number): void {
    const def = furnitureDef(furnitureId);
    sprite.anchor.set(0.5, 1);
    const baseY = (tileY + def.h) * TILE_SIZE - 1;
    sprite.position.set((tileX + def.w / 2) * TILE_SIZE, baseY);
    sprite.zIndex = baseY;
  }

  set(item: PlacedFurniture): void {
    let sprite = this.sprites.get(item.id);
    if (!sprite) {
      sprite = new Sprite();
      this.sprites.set(item.id, sprite);
      this.layer.addChild(sprite);
    }
    sprite.texture = this.art.sheet.textures[furnitureFrame(item.furnitureId, item.rotation)];
    this.position(sprite, item.furnitureId, item.tileX, item.tileY);
  }

  remove(id: string): void {
    const sprite = this.sprites.get(id);
    if (!sprite) return;
    sprite.destroy();
    this.sprites.delete(id);
  }

  replaceAll(items: PlacedFurniture[]): void {
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.sprites.clear();
    for (const item of items) this.set(item);
  }

  /**
   * A prévia translúcida do modo de edição. Verde-normal quando o lugar serve,
   * avermelhada quando não — a mesma regra que o servidor vai aplicar, para o
   * clique recusado ser exceção (latência), não surpresa.
   */
  showGhost(furnitureId: FurnitureId, rotation: number, tileX: number, tileY: number, valid: boolean): void {
    if (!this.ghost) {
      this.ghost = new Sprite();
      this.ghost.alpha = 0.6;
      this.layer.addChild(this.ghost);
    }
    this.ghost.texture = this.art.sheet.textures[furnitureFrame(furnitureId, rotation)];
    this.ghost.visible = true;
    this.ghost.tint = valid ? 0xffffff : 0xff6b6b;
    this.position(this.ghost, furnitureId, tileX, tileY);
    // o ghost desenha por cima do que estiver no tile, para a prévia nunca sumir
    this.ghost.zIndex += TILE_SIZE;
  }

  hideGhost(): void {
    if (this.ghost) this.ghost.visible = false;
  }
}
