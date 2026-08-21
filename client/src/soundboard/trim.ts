import {
  SOUND_MAX_BYTES,
  SOUND_MAX_MS,
  SOUND_TRIM_FADE_MS,
  SOUND_TRIM_RATE,
} from '@together/shared';

/**
 * Prepara um arquivo escolhido pela pessoa para virar um som do soundboard.
 *
 * O problema: um som tem de caber em `SOUND_MAX_MS` (5s) e em
 * `SOUND_MAX_BYTES`. Recusar "esse áudio tem 12s" é correto e é péssimo — quem
 * quer um trecho de um áudio que já tem na máquina não vai abrir um editor de
 * áudio para usar um botão de soundboard. Então **a pessoa escolhe o trecho**,
 * numa faixa de onda com uma janela de 5s que ela arrasta e ouve antes de subir
 * (`ui/ClipPicker.tsx`); os primeiros 5s são só o palpite inicial.
 *
 * Por que não cortar os bytes do arquivo comprimido: não dá. Truncar mp3/ogg/
 * webm produz arquivo inválido (frames pela metade, índices e duração no
 * cabeçalho mentindo) — o corte tem de acontecer no áudio **decodificado**, e aí
 * é preciso reencodar.
 *
 * Por que reencodar em **WAV** e não em opus/aac:
 *
 * - WAV é um cabeçalho de 44 bytes na frente de PCM. São ~40 linhas aqui, sem
 *   dependência nova e sem variação entre navegadores.
 * - A alternativa era `MediaRecorder` sobre um `MediaStreamDestination`, que dá
 *   opus (~40 KB em vez de ~220 KB). Foi descartada por duas razões: ela grava
 *   em **tempo real** — 5s de espera olhando um botão — e o suporte varia
 *   (Safari grava mp4/aac, não webm/opus), o que significaria detectar formato e
 *   manter dois caminhos. Comprimir melhor um arquivo que já cabe no teto não
 *   paga isso.
 *
 * O preço é mono a 22,05 kHz (ver `SOUND_TRIM_RATE`), e ele é baixo: som curto
 * de soundboard sai por alto-falante de laptop e ainda leva atenuação por
 * distância. Arquivo que já cabe nos dois limites passa **intacto** — a
 * recodificação só acontece quando é ela ou a recusa.
 */

export interface PreparedSound {
  bytes: ArrayBuffer;
  mime: string;
  durationMs: number;
  /** o áudio foi cortado por passar de `SOUND_MAX_MS` */
  trimmed: boolean;
  /** foi reescrito em wav (por corte, por tamanho, ou os dois) */
  reencoded: boolean;
}

/** O arquivo não é áudio que este navegador saiba decodificar. */
export class UndecodableAudioError extends Error {}

/**
 * Decodifica, corta se preciso e devolve o que subir.
 *
 * `bytes` é consumido: `decodeAudioData` **detacha** o `ArrayBuffer` que recebe,
 * então trabalhamos sobre uma cópia e devolvemos o original quando nada muda.
 */
export async function decodeAudio(bytes: ArrayBuffer): Promise<AudioBuffer> {
  // contexto descartável: este arquivo ainda pode ser recusado, e não deve
  // entrar no `AudioContext` que toca os sons de verdade
  const ctx = new AudioContext();
  try {
    // `decodeAudioData` DETACHA o buffer que recebe; a cópia preserva o original
    // para o caso de subir o arquivo intacto
    return await ctx.decodeAudioData(bytes.slice(0));
  } catch {
    throw new UndecodableAudioError('não foi possível decodificar o áudio');
  } finally {
    void ctx.close().catch(() => undefined);
  }
}

/**
 * Este arquivo precisa ser recortado/reescrito, ou pode subir como está?
 *
 * Duas razões independentes: passa de 5s (aí a pessoa escolhe o trecho) ou passa
 * do teto de bytes (aí reescrever é o que evita a recusa).
 */
export function needsClip(buffer: AudioBuffer, byteLength: number): boolean {
  return Math.round(buffer.duration * 1000) > SOUND_MAX_MS || byteLength > SOUND_MAX_BYTES;
}

/**
 * Prepara o que subir a partir de um buffer já decodificado.
 *
 * `startSec` é onde o trecho começa — a escolha da pessoa. Ignorado quando o
 * arquivo cabe nos dois limites, porque nesse caso ele sobe **intacto**: manter o
 * arquivo original preserva a compressão e a qualidade que ela já tinha.
 */
export async function prepareSound(
  bytes: ArrayBuffer,
  mime: string,
  buffer: AudioBuffer,
  startSec = 0,
): Promise<PreparedSound> {
  const durationMs = Math.round(buffer.duration * 1000);
  if (!needsClip(buffer, bytes.byteLength)) {
    return { bytes, mime, durationMs, trimmed: false, reencoded: false };
  }

  const max = SOUND_MAX_MS / 1000;
  const start = clampStart(buffer.duration, startSec);
  const seconds = Math.min(max, buffer.duration - start);
  const rendered = await renderClip(buffer, start, seconds);
  return {
    bytes: encodeWav(rendered),
    mime: 'audio/wav',
    durationMs: Math.round(seconds * 1000),
    trimmed: durationMs > SOUND_MAX_MS,
    reencoded: true,
  };
}

/**
 * Mantém o início dentro do arquivo, deixando ao menos um trecho útil à frente.
 *
 * Existe para o slider e o render usarem a **mesma** conta: um `startSec` a 0,1s
 * do fim renderizaria um som de 0,1s sem ninguém pedir, e a tela mostraria "5,0s".
 */
export function clampStart(duration: number, startSec: number): number {
  const max = SOUND_MAX_MS / 1000;
  const latest = Math.max(0, duration - max);
  if (!Number.isFinite(startSec)) return 0;
  return Math.min(Math.max(0, startSec), latest);
}

/**
 * Picos por faixa, para desenhar a onda.
 *
 * Devolve o **máximo absoluto** de cada bucket, não a média: média de sinal de
 * áudio tende a zero (ele oscila em torno de zero) e desenharia uma linha reta.
 * Lê só o primeiro canal — é uma miniatura para achar o trecho, não um editor.
 */
export function peaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const out = new Float32Array(buckets);
  const per = Math.max(1, Math.floor(data.length / buckets));
  for (let b = 0; b < buckets; b++) {
    const start = b * per;
    const end = Math.min(data.length, start + per);
    let peak = 0;
    for (let i = start; i < end; i++) {
      const v = Math.abs(data[i]!);
      if (v > peak) peak = v;
    }
    out[b] = peak;
  }
  return out;
}

/**
 * Renderiza `seconds` a partir de `start`, em mono, a `SOUND_TRIM_RATE`, com
 * fade nas duas pontas.
 *
 * Três conversões acontecem de graça no `OfflineAudioContext`, e é por isso que
 * ele é usado em vez de copiar amostras à mão: pedir **1 canal** faz o downmix
 * de estéreo pelas regras da spec (não é média ingênua), pedir uma
 * `sampleRate` diferente da do buffer faz o `AudioBufferSourceNode` reamostrar,
 * e `start(0, start, seconds)` faz o recorte.
 */
async function renderClip(buffer: AudioBuffer, start: number, seconds: number): Promise<AudioBuffer> {
  const frames = Math.max(1, Math.ceil(seconds * SOUND_TRIM_RATE));
  const offline = new OfflineAudioContext(1, frames, SOUND_TRIM_RATE);

  const source = offline.createBufferSource();
  source.buffer = buffer;

  /**
   * Fade nas DUAS pontas agora que o trecho pode começar no meio do arquivo: um
   * corte que entra no meio de uma onda estala igual ao que sai dela. Com o
   * corte fixo no começo isso não aparecia, porque quase todo arquivo começa em
   * silêncio.
   */
  const gain = offline.createGain();
  const fade = Math.min(SOUND_TRIM_FADE_MS / 1000, seconds / 2);
  gain.gain.setValueAtTime(0, 0);
  gain.gain.linearRampToValueAtTime(1, fade);
  gain.gain.setValueAtTime(1, Math.max(fade, seconds - fade));
  // linear até um valor pequeno, não `exponentialRampToValueAtTime(0)`, que é
  // proibido pela spec (o alvo de uma rampa exponencial não pode ser zero)
  gain.gain.linearRampToValueAtTime(0.0001, seconds);

  source.connect(gain).connect(offline.destination);
  source.start(0, start, seconds);
  return offline.startRendering();
}

/**
 * PCM 16-bit little-endian com cabeçalho RIFF. Mono — o buffer que chega aqui já
 * veio do `OfflineAudioContext` com um canal só.
 *
 * Exportada para poder ser exercitada **sem navegador**: `AudioContext` e
 * `OfflineAudioContext` não existem no Node, então o resto deste arquivo só se
 * verifica na tela — mas um cabeçalho RIFF errado produz arquivo que não toca em
 * lugar nenhum, e isso dá para conferir num script (basta um objeto com
 * `sampleRate` e `getChannelData`).
 */
export function encodeWav(buffer: Pick<AudioBuffer, 'sampleRate' | 'getChannelData'>): ArrayBuffer {
  const samples = buffer.getChannelData(0);
  const bytesPerSample = 2;
  const out = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(out);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true); // tamanho do bloco fmt
  view.setUint16(20, 1, true); // 1 = PCM sem compressão
  view.setUint16(22, 1, true); // canais
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * bytesPerSample, true); // bytes por segundo
  view.setUint16(32, bytesPerSample, true); // alinhamento de bloco
  view.setUint16(34, 16, true); // bits por amostra
  writeText(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    /**
     * O clamp não é paranoia: WebAudio trabalha em float e um som já
     * normalizado no talo passa de 1.0 depois do resample. Sem o clamp, o
     * `setInt16` daria a volta no complemento de dois e o estouro viraria
     * **estalo**, não distorção suave.
     */
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += bytesPerSample;
  }
  return out;
}

/**
 * Toca um trecho do buffer para a pessoa ouvir antes de subir, e devolve como
 * parar.
 *
 * `AudioContext` próprio, descartado no fim, em vez do `SoundPlayer`: aquele é o
 * dono dos sons **do soundboard**, indexados por `soundId` e com teto de
 * simultâneos. Isto é um arquivo que ainda pode ser descartado, e misturar os
 * dois faria uma prévia contar como som tocando.
 *
 * O fade das pontas é o mesmo do render (`SOUND_TRIM_FADE_MS`) para a prévia
 * soar como o resultado — prévia que soa diferente do que vai ser salvo é pior
 * que nenhuma.
 */
export function previewClip(buffer: AudioBuffer, startSec: number, seconds: number): () => void {
  let ctx: AudioContext;
  try {
    ctx = new AudioContext();
  } catch {
    return () => undefined;
  }
  const stop = () => {
    try {
      source.stop();
    } catch {
      // já terminou por conta própria
    }
    void ctx.close().catch(() => undefined);
  };

  if (ctx.state === 'suspended') void ctx.resume();
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const gain = ctx.createGain();
  const fade = Math.min(SOUND_TRIM_FADE_MS / 1000, seconds / 2);
  const t0 = ctx.currentTime + 0.01;
  gain.gain.setValueAtTime(0, t0);
  gain.gain.linearRampToValueAtTime(1, t0 + fade);
  gain.gain.setValueAtTime(1, t0 + Math.max(fade, seconds - fade));
  gain.gain.linearRampToValueAtTime(0.0001, t0 + seconds);

  source.connect(gain).connect(ctx.destination);
  source.onended = () => void ctx.close().catch(() => undefined);
  source.start(t0, startSec, seconds);
  return stop;
}
