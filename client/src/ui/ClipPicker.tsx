import { useEffect, useRef, useState } from 'react';
import { SOUND_MAX_MS } from '@together/shared';
import { clampStart, peaks, previewClip } from '../soundboard/trim';

/**
 * Escolher QUAL trecho de 5s de um áudio longo vai virar o som.
 *
 * A primeira versão cortava os primeiros 5s e avisava. Funciona, e é ruim para o
 * caso mais comum: o pedaço que a pessoa quer quase nunca está no começo de um
 * arquivo — está no meio da fala, da risada, da música. Sem escolher, ela teria
 * de cortar o áudio fora do app e voltar, que é justamente o que a feature
 * existe para evitar.
 *
 * A onda é uma **miniatura para achar o trecho**, não um editor: sem zoom, sem
 * corte de fim independente (a janela é sempre de 5s), sem arrastar com o mouse
 * na onda. O `<input type="range">` é o controle de verdade — ele já vem com
 * teclado, foco e leitor de tela, que um handle desenhado em canvas não tem.
 */

const WAVE_HEIGHT = 52;
/** Buckets da onda. Mais que isso vira ruído visual num painel de 360px. */
const WAVE_BUCKETS = 180;

export interface ClipPickerProps {
  buffer: AudioBuffer;
  fileName: string;
  busy: boolean;
  onConfirm: (startSec: number) => void;
  onCancel: () => void;
}

export function ClipPicker({ buffer, fileName, busy, onConfirm, onCancel }: ClipPickerProps) {
  const max = SOUND_MAX_MS / 1000;
  const latest = Math.max(0, buffer.duration - max);
  const [start, setStart] = useState(0);
  const [playing, setPlaying] = useState(false);
  const stopRef = useRef<(() => void) | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const seconds = Math.min(max, buffer.duration - start);

  // para a prévia ao desmontar: sem isto, fechar o painel no meio deixa o som
  // tocando até o fim, sem nada na tela para pará-lo
  useEffect(() => () => stopRef.current?.(), []);

  // desenha a onda uma vez (ela não muda); a janela de seleção é um overlay em
  // CSS, para arrastar o slider não repintar o canvas a cada pixel
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.round(WAVE_HEIGHT * ratio);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width, WAVE_HEIGHT);

    // as cores saem do tema, não hardcoded: canvas não herda `currentColor`
    const style = getComputedStyle(canvas);
    ctx.fillStyle = style.getPropertyValue('--text-dim').trim() || '#9aa0b0';

    const data = peaks(buffer, WAVE_BUCKETS);
    const barWidth = width / WAVE_BUCKETS;
    const mid = WAVE_HEIGHT / 2;
    for (let i = 0; i < WAVE_BUCKETS; i++) {
      // mínimo de 1px: faixa em silêncio some por completo e a onda fica com
      // buracos que parecem falha de desenho, não silêncio
      const h = Math.max(1, data[i]! * (WAVE_HEIGHT - 4));
      ctx.fillRect(i * barWidth, mid - h / 2, Math.max(1, barWidth - 0.5), h);
    }
  }, [buffer]);

  const stop = () => {
    stopRef.current?.();
    stopRef.current = null;
    setPlaying(false);
  };

  const preview = () => {
    stop();
    stopRef.current = previewClip(buffer, clampStart(buffer.duration, start), seconds);
    setPlaying(true);
    // sem `onended` confiável aqui (o nó é interno ao helper), o estado volta
    // pelo tempo do próprio trecho
    window.setTimeout(() => setPlaying(false), seconds * 1000 + 80);
  };

  const fmt = (s: number) => {
    const total = Math.floor(s);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  };

  // janela de seleção como porcentagem, para o overlay acompanhar o slider
  const leftPct = buffer.duration > 0 ? (start / buffer.duration) * 100 : 0;
  const widthPct = buffer.duration > 0 ? (seconds / buffer.duration) * 100 : 100;

  return (
    <div className="clip-picker">
      <p className="clip-title">
        Escolha o trecho
        <small>
          {fileName} · {fmt(buffer.duration)} — o som guarda {seconds.toFixed(1)}s
        </small>
      </p>

      <div className="clip-wave">
        <canvas ref={canvasRef} height={WAVE_HEIGHT} aria-hidden="true" />
        <span className="clip-window" style={{ left: `${leftPct}%`, width: `${widthPct}%` }} />
      </div>

      <input
        className="clip-range"
        type="range"
        min={0}
        max={latest}
        step={0.05}
        value={start}
        onChange={(e) => {
          stop();
          setStart(Number(e.target.value));
        }}
        // as setas movem o slider; sem isto elas também andariam com o avatar
        onKeyDown={(e) => e.stopPropagation()}
        disabled={busy || latest === 0}
        aria-label="Início do trecho"
        aria-valuetext={`Começa em ${fmt(start)}`}
      />

      <div className="clip-marks">
        <span>{fmt(start)}</span>
        <span>{fmt(Math.min(buffer.duration, start + seconds))}</span>
      </div>

      <div className="clip-actions">
        <button
          type="button"
          className="join-secondary"
          onClick={playing ? stop : preview}
          disabled={busy}
        >
          {playing ? 'Parar' : 'Ouvir'}
        </button>
        <button
          type="button"
          className="lobby-action"
          onClick={() => {
            stop();
            onConfirm(clampStart(buffer.duration, start));
          }}
          disabled={busy}
        >
          {busy ? 'Salvando…' : 'Usar este trecho'}
        </button>
        <button
          type="button"
          className="clip-cancel"
          onClick={() => {
            stop();
            onCancel();
          }}
          disabled={busy}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}
