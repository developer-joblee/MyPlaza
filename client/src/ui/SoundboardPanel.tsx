import { useEffect, useRef, useState } from 'react';
import {
  SOUND_LABEL_MAX,
  SOUND_VOLUME_MAX,
  SOUND_MAX_BYTES,
  SOUND_MAX_MS,
  SOUND_MAX_SLOTS,
  type SoundboardErrorReason,
  type UserSound,
} from '@together/shared';
import { runtime } from '../runtime';
import { applyVolume, persistVolume, playSound, refreshSoundboard } from '../soundboard';
import { UndecodableAudioError, decodeAudio, needsClip, prepareSound } from '../soundboard/trim';
import { ClipPicker } from './ClipPicker';
import { useStore } from '../state/store';
import { CloseIcon, SoundboardIcon } from './icons';
import { formatDuration } from './util';

/**
 * O painel do soundboard: a grade de slots, o upload e o progresso do próximo
 * nível.
 *
 * É um popover no molde exato do `AudioSettings` — mesma classe `.panel`, mesmo
 * fechamento (Escape, clique fora em captura, foco de volta no gatilho) e o
 * mesmo `data-capture-keys`, sem o qual as teclas digitadas no nome do som
 * andariam com o avatar.
 */

/** Mensagens de recusa. O servidor manda código; o texto é do cliente. */
const REASON_TEXT: Record<SoundboardErrorReason, string> = {
  'socket-down': 'Sem conexão com o servidor.',
  timeout: 'O servidor não respondeu. Tente de novo.',
  'not-configured': 'Este servidor não tem soundboard (falta o Supabase).',
  'auth-required': 'Entre com sua conta para usar o soundboard.',
  'invalid-token': 'Sua sessão expirou. Entre de novo.',
  'invalid-input': 'Nome inválido — 1 a ' + SOUND_LABEL_MAX + ' caracteres.',
  'not-unlocked': 'Este slot ainda não foi liberado.',
  'too-large': `Arquivo grande demais (máximo ${Math.round(SOUND_MAX_BYTES / 1024)} KB).`,
  'bad-format': 'Formato não aceito. Use mp3, ogg, m4a ou webm.',
  'not-found': 'Esse som já não existe.',
  error: 'Não deu para falar com o servidor. Tente de novo.',
};

export function SoundboardPanel({ onClose }: { onClose: () => void }) {
  const board = useStore((s) => s.soundboard);
  const muted = useStore((s) => s.soundboardMuted);
  const setMuted = useStore((s) => s.setSoundboardMuted);
  const volume = useStore((s) => s.soundboardVolume);

  const panelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Em qual slot o arquivo escolhido vai entrar. Definido pelo clique no slot vazio. */
  const targetSlot = useRef<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** aviso que não é erro: "cortei o seu áudio" precisa ser dito, sem alarmar */
  const [info, setInfo] = useState<string | null>(null);
  /**
   * Arquivo decodificado esperando a escolha do trecho. Fica no estado (e não
   * numa ref) porque a tela troca por causa dele: enquanto existe, o painel
   * mostra o seletor em vez da grade.
   */
  const [pending, setPending] = useState<
    { slot: number; label: string; bytes: ArrayBuffer; mime: string; buffer: AudioBuffer; name: string } | null
  >(null);
  const [fired, setFired] = useState<string | null>(null);
  const firedTimer = useRef<number | null>(null);
  const volumeTimer = useRef<number | null>(null);

  // pede a biblioteca ao abrir: ela pode ter mudado em outra aba, e o tempo
  // acumulado muda sozinho a cada minuto
  useEffect(() => {
    void (async () => {
      const reason = await refreshSoundboard();
      if (reason) setError(REASON_TEXT[reason as SoundboardErrorReason] ?? REASON_TEXT.error);
    })();
  }, []);

  // popover não-modal: Escape, clique fora, e o pointerdown em CAPTURA para
  // fechar antes de o canvas do jogo engolir o evento
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    const onDown = (e: PointerEvent) => {
      const panel = panelRef.current;
      if (panel && !panel.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  useEffect(() => () => {
    if (firedTimer.current) window.clearTimeout(firedTimer.current);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
  }, []);

  /**
   * Aplica na hora, grava depois.
   *
   * Arrastar um `<input type="range">` dispara `change` a cada movimento — sem o
   * atraso, um arrasto seria dezenas de escritas no perfil. 500ms é depois do
   * dedo parar e antes de a pessoa fechar o painel; e como o painel persiste no
   * unmount não é possível perder o último valor.
   */
  const onVolume = (next: number) => {
    applyVolume(next);
    if (volumeTimer.current) window.clearTimeout(volumeTimer.current);
    volumeTimer.current = window.setTimeout(() => {
      void persistVolume(next).then((reason) => {
        // falhou gravar: o volume continua valendo nesta sessão, mas dizer que
        // não ficou salvo é honesto — senão ela reabre amanhã e acha que sumiu
        if (reason) setInfo('Volume aplicado, mas não foi possível salvar no seu perfil.');
      });
    }, 500);
  };

  /**
   * Fechar o painel grava o valor pendente imediatamente. Sem isto, mexer no
   * slider e fechar em menos de 500ms perderia a mudança — e é exatamente o que
   * alguém faz quando o único motivo de abrir o painel era baixar o volume.
   */
  useEffect(() => {
    const pendingVolume = volume;
    return () => {
      if (!volumeTimer.current) return;
      window.clearTimeout(volumeTimer.current);
      volumeTimer.current = null;
      void persistVolume(pendingVolume);
    };
  }, [volume]);

  const unlocked = board?.slots ?? 0;

  const onPick = (slot: number) => {
    targetSlot.current = slot;
    setError(null);
    setInfo(null);
    fileRef.current?.click();
  };

  const onFile = async (file: File | undefined) => {
    const slot = targetSlot.current;
    targetSlot.current = null;
    if (!file || slot === null) return;
    setError(null);

    setBusy(true);
    setInfo(null);
    try {
      const bytes = await file.arrayBuffer();
      // nome do arquivo sem extensão vira o rótulo; a pessoa renomeia o arquivo
      // se quiser outro, o que evita um segundo campo de formulário aqui
      const label = file.name.replace(/\.[^.]+$/, '').slice(0, SOUND_LABEL_MAX) || `Som ${slot}`;

      let buffer: AudioBuffer;
      try {
        buffer = await decodeAudio(bytes);
      } catch (err) {
        if (err instanceof UndecodableAudioError) {
          setError(REASON_TEXT['bad-format']);
          return;
        }
        throw err;
      }

      /**
       * Áudio que não cabe **não é recusado**: a pessoa escolhe qual trecho de 5s
       * fica. Só o que já cabe nos dois limites sobe direto, e sobe **intacto** —
       * preservando a compressão que ele já tinha.
       */
      if (needsClip(buffer, bytes.byteLength)) {
        setPending({ slot, label, bytes, mime: file.type, buffer, name: file.name });
        return;
      }
      await send(slot, label, bytes, file.type, buffer, 0);
    } finally {
      setBusy(false);
      // limpa o input: sem isto, escolher o MESMO arquivo de novo não dispara
      // `change` e o botão parece morto
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  /** Recorta (se preciso) e sobe. Compartilhado pelo caminho direto e pelo seletor. */
  const send = async (
    slot: number,
    label: string,
    bytes: ArrayBuffer,
    mime: string,
    buffer: AudioBuffer,
    startSec: number,
  ) => {
    const prepared = await prepareSound(bytes, mime, buffer, startSec);

    // o recorte tem teto conhecido (~215 KB), então isto só dispara para um
    // arquivo que já cabia em 5s e ainda assim é grande — wav sem compressão
    if (prepared.bytes.byteLength > SOUND_MAX_BYTES) {
      setError(REASON_TEXT['too-large']);
      return;
    }

    const res = await runtime.soundApi?.upload(
      slot,
      label,
      prepared.mime,
      prepared.durationMs,
      prepared.bytes,
    );
    // `null` = já havia um upload igual em vôo; não é erro
    if (!res) return;
    if (!res.ok) {
      setError(REASON_TEXT[res.reason] ?? REASON_TEXT.error);
      return;
    }
    useStore.getState().setSoundboard(res.state);
    for (const sound of res.state.sounds) runtime.soundboard?.preload(sound.id, sound.url);
    setPending(null);
    /**
     * Diz o que foi feito com o arquivo. Recortar em silêncio seria pior que
     * recusar: a pessoa acharia que subiu o áudio inteiro e só descobriria ao
     * tocar — e isto é informação, não erro, então não vai no `error`.
     */
    if (prepared.trimmed) {
      setInfo(`Guardado o trecho de ${(prepared.durationMs / 1000).toFixed(1)}s que você escolheu.`);
    } else if (prepared.reencoded) {
      setInfo('Reescrito em qualidade menor para caber no limite.');
    }
  };

  const onConfirmClip = async (startSec: number) => {
    if (!pending) return;
    setError(null);
    setBusy(true);
    try {
      await send(pending.slot, pending.label, pending.bytes, pending.mime, pending.buffer, startSec);
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (sound: UserSound) => {
    setError(null);
    setBusy(true);
    try {
      const res = await runtime.soundApi?.remove(sound.id);
      if (!res) return;
      if (!res.ok) {
        setError(REASON_TEXT[res.reason] ?? REASON_TEXT.error);
        return;
      }
      runtime.soundboard?.forget(sound.id);
      useStore.getState().setSoundboard(res.state);
    } finally {
      setBusy(false);
    }
  };

  const onPlay = (sound: UserSound) => {
    if (!playSound(sound.id)) {
      setError(REASON_TEXT['socket-down']);
      return;
    }
    // acende o slot pelo tempo do som, para o clique ter resposta visível mesmo
    // quando o áudio está bloqueado pelo navegador
    setFired(sound.id);
    if (firedTimer.current) window.clearTimeout(firedTimer.current);
    firedTimer.current = window.setTimeout(() => setFired(null), Math.max(400, sound.durationMs));
  };

  const soundBySlot = new Map<number, UserSound>();
  for (const sound of board?.sounds ?? []) soundBySlot.set(sound.slot, sound);

  return (
    <div
      ref={panelRef}
      id="soundboard-popover"
      className="panel soundboard-popover"
      role="dialog"
      aria-label="Soundboard"
      data-capture-keys
    >
      <div className="audio-head">
        Soundboard
        <button type="button" className="audio-close" onClick={onClose} aria-label="Fechar">
          <CloseIcon />
        </button>
      </div>

      {pending ? (
        <ClipPicker
          buffer={pending.buffer}
          fileName={pending.name}
          busy={busy}
          onConfirm={(startSec) => void onConfirmClip(startSec)}
          onCancel={() => {
            setPending(null);
            setError(null);
          }}
        />
      ) : board ? (
        <>
          <p className="soundboard-level">
            {board.levelLabel ? (
              <>
                <strong>
                  Nível {board.level} · {board.levelLabel}
                </strong>
                {` — ${board.slots} ${board.slots === 1 ? 'som' : 'sons'}`}
              </>
            ) : (
              <strong>Nenhum som liberado ainda</strong>
            )}
            <small>
              {board.nextSlots === null
                ? `${formatDuration(board.presenceSeconds)} por aqui. Você está no último nível.`
                : `${formatDuration(board.presenceSeconds)} por aqui — faltam ` +
                  `${formatDuration(board.secondsToNext)} para o ${board.nextSlots}º som.`}
            </small>
          </p>

          <div className="soundboard-grid">
            {Array.from({ length: SOUND_MAX_SLOTS }, (_, i) => i + 1).map((slot) => {
              const sound = soundBySlot.get(slot);
              const locked = slot > unlocked;
              if (locked) {
                return (
                  <div key={slot} className="sound-slot locked" aria-label={`Slot ${slot} bloqueado`}>
                    <span className="sound-slot-lock" aria-hidden="true">
                      🔒
                    </span>
                    <span className="sound-slot-name">Slot {slot}</span>
                  </div>
                );
              }
              if (!sound) {
                return (
                  <button
                    key={slot}
                    type="button"
                    className="sound-slot empty"
                    onClick={() => onPick(slot)}
                    disabled={busy}
                    title={`Subir um som para o slot ${slot}`}
                  >
                    <span className="sound-slot-lock" aria-hidden="true">
                      +
                    </span>
                    <span className="sound-slot-name">Slot {slot}</span>
                  </button>
                );
              }
              return (
                <div key={slot} className={`sound-slot filled${fired === sound.id ? ' fired' : ''}`}>
                  <button
                    type="button"
                    className="sound-slot-play"
                    onClick={() => onPlay(sound)}
                    title={`Tocar ${sound.label}`}
                  >
                    <SoundboardIcon />
                    <span className="sound-slot-name">{sound.label}</span>
                    {sound.durationMs > 0 && (
                      <span className="sound-slot-time">{(sound.durationMs / 1000).toFixed(1)}s</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="sound-slot-remove"
                    onClick={() => void onRemove(sound)}
                    disabled={busy}
                    aria-label={`Remover ${sound.label}`}
                    title="Remover"
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <p className="audio-empty">
          {error ?? 'Carregando seus sons…'}
        </p>
      )}

      {board && error && (
        <p className="soundboard-error" role="status">
          {error}
        </p>
      )}

      {board && !error && info && (
        <p className="soundboard-info" role="status">
          {info}
        </p>
      )}

      {!pending && (
        <p className="soundboard-hint">
          {`Arquivo de áudio (mp3, ogg, m4a). Se passar de ${SOUND_MAX_MS / 1000}s, você escolhe o trecho.`}
        </p>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => void onFile(e.target.files?.[0])}
      />

      {!pending && (
        <div className={`sound-volume${muted ? ' muted' : ''}`}>
          <span className="join-label" id="sound-volume-label">
            Volume dos sons
            <small>{muted ? 'silenciado' : `${volume}%`}</small>
          </span>
          <input
            className="clip-range"
            type="range"
            min={0}
            max={SOUND_VOLUME_MAX}
            step={1}
            value={volume}
            onChange={(e) => onVolume(Number(e.target.value))}
            // as setas movem o slider; sem isto elas também andariam com o avatar
            onKeyDown={(e) => e.stopPropagation()}
            disabled={muted}
            aria-labelledby="sound-volume-label"
            aria-valuetext={`${volume} por cento`}
          />
          <small className="sound-volume-hint">
            Só o soundboard — a voz das pessoas não muda. Fica salvo no seu perfil.
          </small>
        </div>
      )}

      {!pending && (
      <button
        type="button"
        className={`audio-toggle${!muted ? ' on' : ''}`}
        onClick={() => {
          setMuted(!muted);
          if (!muted) runtime.soundboard?.stopAll();
        }}
        aria-pressed={!muted}
      >
        <span className="audio-toggle-track" aria-hidden="true">
          <span className="audio-toggle-knob" />
        </span>
        <span className="audio-toggle-text">
          Ouvir sons de outras pessoas
          <small>
            {muted
              ? 'Silenciado — você continua podendo tocar os seus'
              : 'Sons de quem está perto tocam, com o volume caindo pela distância'}
          </small>
        </span>
      </button>
      )}
    </div>
  );
}
