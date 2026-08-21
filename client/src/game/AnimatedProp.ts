import { Sprite, type Texture } from 'pixi.js';

/**
 * Um prop do cenário que troca de textura sozinho — máquina de café passando,
 * aquário, TV ligada. Mesmo mecanismo do `Avatar.update` (acumulador de tempo e
 * troca manual de textura), de propósito: um jeito só de animar no projeto,
 * sem `AnimatedSprite` nem ticker próprio. Quem chama `update(dt)` é o
 * `TilemapBase.animate`, que o `Game` já aciona todo frame.
 */
export class AnimatedProp {
  readonly sprite: Sprite;
  private timer = 0;
  private index = 0;

  constructor(
    private frames: readonly Texture[],
    private frameS: number,
    /**
     * Faixa `[início, fim]` (inclusiva) do loop. Sem ela, a tira inteira
     * repete. Com ela, os quadros antes do início tocam UMA vez (intro — é o
     * "4-7 loop" dos nomes de arquivo do pack) e o loop fica na faixa.
     */
    private loop?: readonly [number, number],
  ) {
    this.sprite = new Sprite(frames[0]);
  }

  update(dt: number): void {
    this.timer += dt;
    if (this.timer < this.frameS) return;
    this.timer %= this.frameS;
    this.index++;
    if (this.loop) {
      if (this.index > this.loop[1]) this.index = this.loop[0];
    } else if (this.index >= this.frames.length) {
      this.index = 0;
    }
    this.sprite.texture = this.frames[this.index];
  }
}
