/**
 * O "toc-toc" que avisa quem está ausente que alguém a chamou.
 *
 * Sintetizado na hora com WebAudio: **sem asset e sem dependência nova** — os
 * packs de arte do projeto são parte não-comerciais e todo asset exige crédito
 * no README, e um aviso de 2,5s não vale esse peso. O timbre é onda triangular,
 * que atravessa fone e alto-falante de laptop sem virar clique.
 *
 * Por que isto toca mesmo com a pessoa "surda": ficar ausente corta o áudio da
 * conversa (`VoiceRoom.applySilence`), e o chamado existe justamente para
 * atravessar esse silêncio. É a campainha da porta, não a conversa da sala.
 */

/**
 * Um contexto só, criado no primeiro chamado. Criar um por batida estoura o
 * limite de contextos do navegador numa sessão longa.
 */
let ctx: AudioContext | null = null;

/** Quando o chamado que está tocando termina (relógio do `ctx`), 0 = nada tocando. */
let busyUntil = 0;

/**
 * Duas batidas por ciclo — a segunda um tom acima, como quem bate na porta.
 * `at` é o deslocamento dentro do ciclo.
 */
const BEATS: Array<{ at: number; freq: number }> = [
  { at: 0, freq: 660 },
  { at: 0.16, freq: 880 },
];

/**
 * O padrão inteiro dura ~2,5s, e é repetição em vez de um tom longo de propósito:
 * quem está ausente está olhando OUTRA janela, e o ouvido descarta som contínuo
 * muito mais rápido do que descarta algo que insiste. Quatro ciclos com pausa
 * audível entre eles é o que soa como "alguém batendo", não como alarme.
 */
const REPEATS = 4;
const CYCLE_S = 0.75;

const BEAT_MS = 110;
/** Volume de pico. Alto o bastante para chamar, baixo o bastante para não doer. */
const PEAK = 0.14;

export function playKnock(): void {
  try {
    ctx ??= new AudioContext();
    // um contexto criado fora de gesto do usuário nasce suspenso; retomar é
    // barato e, se o navegador recusar, o `catch` engole — o aviso na tela
    // continua sendo o canal principal, o som é o reforço
    if (ctx.state === 'suspended') void ctx.resume();

    // dois chamados quase juntos (duas pessoas chamando) somariam dois padrões
    // de 2,5s em cima um do outro, o que só embola; o segundo é descartado —
    // quem já está ouvindo o aviso não precisa dele duas vezes
    if (ctx.currentTime < busyUntil) return;

    const start = ctx.currentTime + 0.01;
    for (let ciclo = 0; ciclo < REPEATS; ciclo++) {
      for (const { at, freq } of BEATS) {
        const t = start + ciclo * CYCLE_S + at;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        // envelope explícito: sem a rampa de descida o corte estala
        gain.gain.setValueAtTime(0, t);
        gain.gain.linearRampToValueAtTime(PEAK, t + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + BEAT_MS / 1000);
        osc.connect(gain).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + BEAT_MS / 1000 + 0.02);
      }
    }
    busyUntil = start + (REPEATS - 1) * CYCLE_S + BEATS[BEATS.length - 1]!.at + BEAT_MS / 1000;
  } catch (err) {
    console.warn('[presence] não foi possível tocar o chamado:', err);
  }
}
