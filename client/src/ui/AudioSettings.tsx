import { useEffect, useRef, useState } from 'react';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { saveMicPreference } from '../voice/mic';
import { CheckIcon, CloseIcon } from './icons';
import { useMicLevel } from './useMicLevel';

const STATUS_TEXT: Record<string, { label: string; cls: string }> = {
  idle: { label: 'Voz desligada', cls: '' },
  connecting: { label: 'Conectando à voz…', cls: 'warn' },
  connected: { label: 'Voz conectada', cls: 'on' },
  reconnecting: { label: 'Reconectando…', cls: 'warn' },
  unavailable: { label: 'Voz não configurada neste servidor', cls: '' },
  error: { label: 'Voz desconectada', cls: 'err' },
};

export function AudioSettings({ onClose }: { onClose: () => void }) {
  const devices = useStore((s) => s.micDevices);
  const activeMicId = useStore((s) => s.activeMicId);
  const micAvailable = useStore((s) => s.micAvailable);
  const micEnabled = useStore((s) => s.micEnabled);
  const deafened = useStore((s) => s.deafened);
  const micSwitching = useStore((s) => s.micSwitching);
  const voiceStatus = useStore((s) => s.voiceStatus);

  const panelRef = useRef<HTMLDivElement>(null);
  const meterRef = useRef<HTMLSpanElement>(null);
  const [focusedId, setFocusedId] = useState<string | null>(activeMicId);

  const muted = !micAvailable || !micEnabled || deafened;
  useMicLevel(meterRef, !muted && voiceStatus === 'connected');

  // relista ao abrir e sempre que o SO ganhar/perder um dispositivo
  useEffect(() => {
    void runtime.voice?.refreshDevices();
    const onChange = () => void runtime.voice?.refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', onChange);
  }, []);

  // foco inicial na entrada selecionada
  useEffect(() => {
    const el = panelRef.current?.querySelector<HTMLButtonElement>('.device-row.selected')
      ?? panelRef.current?.querySelector<HTMLButtonElement>('.device-row');
    el?.focus();
  }, []);

  // popover não-modal: fecha em Escape, clique fora, ou foco saindo do painel
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
    // captura para fechar antes do canvas engolir o evento
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown, true);
    };
  }, [onClose]);

  const select = (deviceId: string) => {
    saveMicPreference(deviceId);
    void runtime.voice?.switchMic(deviceId);
  };

  /**
   * Listbox, não radiogroup: no radiogroup a seta já seleciona, e passar por 5
   * microfones dispararia 5 trocas de dispositivo. Aqui a seta move o foco e a
   * seleção só acontece no Enter/clique.
   */
  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    // as setas também andariam com o avatar (input.ts escuta na window)
    e.preventDefault();
    e.stopPropagation();
    const rows = [...(panelRef.current?.querySelectorAll<HTMLButtonElement>('.device-row') ?? [])];
    if (rows.length === 0) return;
    const i = rows.findIndex((r) => r === document.activeElement);
    const next =
      e.key === 'Home' ? 0
      : e.key === 'End' ? rows.length - 1
      : e.key === 'ArrowDown' ? Math.min(rows.length - 1, i + 1)
      : Math.max(0, i - 1);
    rows[next]?.focus();
    setFocusedId(devices[next]?.deviceId ?? null);
  };

  const status = STATUS_TEXT[voiceStatus] ?? STATUS_TEXT.idle;
  const caption = micSwitching
    ? 'Trocando de microfone…'
    : !micAvailable
      ? 'Sem permissão de microfone — recarregue a página para permitir.'
      : deafened
        ? 'Modo surdo ligado — o microfone está mutado.'
        : !micEnabled
          ? 'Microfone desativado.'
          : voiceStatus === 'connected'
            ? 'Fale para ver o nível se mover.'
            : 'Aguardando a conexão de voz.';

  return (
    <div
      ref={panelRef}
      id="audio-popover"
      className="panel audio-popover"
      role="dialog"
      aria-label="Configurações de áudio"
      data-capture-keys
      onKeyDown={onListKeyDown}
    >
      <div className="audio-head">
        Áudio
        <button type="button" className="audio-close" onClick={onClose} aria-label="Fechar">
          <CloseIcon />
        </button>
      </div>

      <div className={`audio-status ${status.cls}`}>
        <span className="audio-status-dot" />
        {status.label}
      </div>

      <span className="join-label" id="audio-mic-label">Microfone</span>
      {devices.length === 0 ? (
        <p className="audio-empty">Nenhum microfone encontrado. Conecte um e ele aparece aqui.</p>
      ) : (
        <div className="audio-devices" role="listbox" aria-labelledby="audio-mic-label">
          {devices.map((d) => {
            const selected = d.deviceId === activeMicId;
            return (
              <button
                key={d.deviceId}
                type="button"
                role="option"
                aria-selected={selected}
                tabIndex={d.deviceId === (focusedId ?? activeMicId) ? 0 : -1}
                className={`device-row${selected ? ' selected' : ''}`}
                onClick={() => select(d.deviceId)}
                disabled={micSwitching}
              >
                <span className="device-check" aria-hidden="true"><CheckIcon /></span>
                <span className="device-name">{d.label}</span>
                {d.isDefault && <span className="device-tag">padrão</span>}
              </button>
            );
          })}
        </div>
      )}

      <div className={`audio-meter${muted ? ' muted' : ''}${micSwitching ? ' busy' : ''}`}>
        <span className="join-label audio-meter-label">Nível</span>
        <span className="audio-meter-track" ref={meterRef} aria-hidden="true">
          <span className="audio-meter-fill" />
        </span>
      </div>
      <p className="audio-hint" role="status">{caption}</p>
    </div>
  );
}
