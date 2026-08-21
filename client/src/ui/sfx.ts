/**
 * A primitiva de som do app: um `AudioContext` só e um agendador de batidas.
 *
 * Existe porque há **dois** avisos sonoros sintetizados (o "toc-toc" de quem
 * está ausente e o "pin" do chamado pelo menu de contexto) e os dois querem
 * exatamente a mesma coisa: nenhum asset novo (os packs de arte do projeto são
 * em parte não-comerciais e todo asset exige crédito no README), um contexto
 * compartilhado (criar um por som estoura o limite de contextos do navegador
 * numa sessão longa — era o que o comentário do `knock.ts` já pedia) e um
 * envelope explícito, porque sem a rampa de descida o corte estala.
 *
 * O que **não** vive aqui é a trava de "já está tocando": cada padrão guarda a
 * sua. Uma trava compartilhada faria um pin de 200ms engolir um toc-toc de 2,5s,
 * e os dois avisos são de coisas diferentes.
 */

/** Uma batida: `at` é o deslocamento dentro do ciclo, em segundos. */
export interface Beat {
  at: number;
  freq: number;
}

export interface BeatsOptions {
  /** quantos ciclos, e de quanto em quanto tempo cada um começa */
  repeats: number;
  cycleS: number;
  /** duração de cada batida, em ms */
  beatMs: number;
  /** volume de pico (0..1) */
  peak: number;
}

let ctx: AudioContext | null = null;

/**
 * O contexto compartilhado, criado no primeiro som. Devolve `null` quando o
 * navegador não deixa criar — quem chama trata isso como "sem som", nunca como
 * erro: em todos os usos o canal principal é visual e o som é reforço.
 */
export function audioCtx(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    // um contexto criado fora de gesto do usuário nasce suspenso; retomar é
    // barato e, se o navegador recusar, o som simplesmente não sai
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch (err) {
    console.warn('[sfx] sem AudioContext:', err);
    return null;
  }
}

/**
 * Agenda `repeats` ciclos de `beats` a partir de `start` (relógio do `ctx`) e
 * devolve o instante em que o último som termina — que é o que quem chama guarda
 * como "estou ocupado até".
 *
 * O timbre é onda triangular, que atravessa fone e alto-falante de laptop sem
 * virar clique.
 */
export function scheduleBeats(
  ctx: AudioContext,
  start: number,
  beats: Beat[],
  { repeats, cycleS, beatMs, peak }: BeatsOptions,
): number {
  const beatS = beatMs / 1000;
  for (let ciclo = 0; ciclo < repeats; ciclo++) {
    for (const { at, freq } of beats) {
      const t = start + ciclo * cycleS + at;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      // envelope explícito: sem a rampa de descida o corte estala
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(peak, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + beatS);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + beatS + 0.02);
    }
  }
  return start + (repeats - 1) * cycleS + (beats[beats.length - 1]?.at ?? 0) + beatS;
}
