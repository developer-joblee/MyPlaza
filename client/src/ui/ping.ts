/**
 * O "pin" do chamado pelo menu de contexto.
 *
 * Duas notas ascendentes curtas, **um** ciclo, ~200ms no total — e a diferença
 * em relação ao "toc-toc" (`ui/knock.ts`, 2,5s de batidas repetidas) é
 * deliberada: aqui quem recebe está **na frente da tela**, com o alerta
 * aparecendo no canto no mesmo instante. O som só precisa virar a atenção para
 * ele, não competir com outra janela. Um padrão insistente para quem já está
 * olhando soa como alarme, e é o tipo de som que faz desligar o volume do app.
 *
 * Ascendente (e não descendente) porque pergunta em vez de encerrar: é um
 * convite para ir até alguém, não um aviso de que algo terminou.
 */

import { audioCtx, scheduleBeats, type Beat } from './sfx';

/** Até quando o pin que está tocando dura (relógio do `ctx`). */
let busyUntil = 0;

const BEATS: Beat[] = [
  { at: 0, freq: 880 },
  { at: 0.09, freq: 1320 },
];

const BEAT_MS = 95;
/**
 * Um pouco abaixo do `PEAK` do toc-toc: notas mais agudas soam mais altas com o
 * mesmo ganho, e este som toca com a pessoa de fone no meio de uma conversa.
 */
const PEAK = 0.11;

export function playCallPing(): void {
  const ctx = audioCtx();
  if (!ctx) return;
  // duas pessoas chamando quase junto não viram dois pins embolados; o alerta
  // na tela já mostra os dois cartões
  if (ctx.currentTime < busyUntil) return;
  busyUntil = scheduleBeats(ctx, ctx.currentTime + 0.01, BEATS, {
    repeats: 1,
    cycleS: 0,
    beatMs: BEAT_MS,
    peak: PEAK,
  });
}
