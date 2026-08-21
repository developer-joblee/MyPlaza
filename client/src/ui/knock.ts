/**
 * O "toc-toc" que avisa quem está ausente que alguém a chamou.
 *
 * Sintetizado na hora com WebAudio, pelo `ui/sfx.ts`: **sem asset e sem
 * dependência nova** — os packs de arte do projeto são parte não-comerciais e
 * todo asset exige crédito no README, e um aviso de 2,5s não vale esse peso.
 *
 * Por que isto toca mesmo com a pessoa "surda": ficar ausente corta o áudio da
 * conversa (`VoiceRoom.applySilence`), e o chamado existe justamente para
 * atravessar esse silêncio. É a campainha da porta, não a conversa da sala.
 */

import { audioCtx, scheduleBeats, type Beat } from './sfx';

/** Quando o chamado que está tocando termina (relógio do `ctx`), 0 = nada tocando. */
let busyUntil = 0;

/**
 * Duas batidas por ciclo — a segunda um tom acima, como quem bate na porta.
 * `at` é o deslocamento dentro do ciclo.
 */
const BEATS: Beat[] = [
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
  const ctx = audioCtx();
  if (!ctx) return;
  // dois chamados quase juntos (duas pessoas chamando) somariam dois padrões
  // de 2,5s em cima um do outro, o que só embola; o segundo é descartado —
  // quem já está ouvindo o aviso não precisa dele duas vezes
  if (ctx.currentTime < busyUntil) return;
  busyUntil = scheduleBeats(ctx, ctx.currentTime + 0.01, BEATS, {
    repeats: REPEATS,
    cycleS: CYCLE_S,
    beatMs: BEAT_MS,
    peak: PEAK,
  });
}
