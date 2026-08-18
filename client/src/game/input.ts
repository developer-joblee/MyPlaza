const MOVEMENT_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable)
  );
}

export class Keyboard {
  private pressed = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e)) return;
    if (!MOVEMENT_CODES.has(e.code)) return;
    e.preventDefault();
    this.pressed.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code);
  };

  private onBlur = () => {
    this.pressed.clear();
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** Vetor de direção normalizado {-1..1} */
  get axis(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) x -= 1;
    if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) x += 1;
    if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) y -= 1;
    if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) y += 1;
    if (x !== 0 && y !== 0) {
      const inv = 1 / Math.SQRT2;
      x *= inv;
      y *= inv;
    }
    return { x, y };
  }
}
