const MOVEMENT_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD',
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
]);

/** Teclas de ação: valem uma vez por pressionada, não a cada frame. */
const ACTION_CODES = new Set(['KeyE']);

function isTypingTarget(e: KeyboardEvent): boolean {
  const t = e.target;
  return (
    t instanceof HTMLInputElement ||
    t instanceof HTMLTextAreaElement ||
    (t instanceof HTMLElement && t.isContentEditable) ||
    // painéis que usam as setas para navegar (ex.: a lista de microfones):
    // sem isto, navegar a lista moveria o avatar ao mesmo tempo
    (t instanceof HTMLElement && t.closest('[data-capture-keys]') !== null)
  );
}

export class Keyboard {
  private pressed = new Set<string>();
  /** ações apertadas desde a última leitura (consumidas em consumeAction) */
  private actions = new Set<string>();

  private onKeyDown = (e: KeyboardEvent) => {
    if (isTypingTarget(e)) return;
    if (ACTION_CODES.has(e.code)) {
      e.preventDefault();
      // `e.repeat` é a repetição automática do sistema ao segurar a tecla;
      // sem isto, segurar E alternaria sentar/levantar continuamente
      if (!e.repeat) this.actions.add(e.code);
      return;
    }
    if (!MOVEMENT_CODES.has(e.code)) return;
    e.preventDefault();
    this.pressed.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent) => {
    this.pressed.delete(e.code);
  };

  private onBlur = () => {
    this.pressed.clear();
    // solta a janela com E pendente => a ação não deve disparar depois
    this.actions.clear();
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

  /**
   * Consome a tecla de interagir: devolve true no primeiro tick depois de ela
   * ser apertada, e false nos seguintes. Ler já limpa o estado, então o
   * chamador não precisa se lembrar disso.
   */
  consumeInteract(): boolean {
    if (!this.actions.has('KeyE')) return false;
    this.actions.delete('KeyE');
    return true;
  }

  /** Alguma tecla de movimento está pressionada agora? */
  get moving(): boolean {
    for (const code of this.pressed) if (MOVEMENT_CODES.has(code)) return true;
    return false;
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
