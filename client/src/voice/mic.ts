const STORAGE_KEY = 'together:micDeviceId';

export interface MicDevice {
  deviceId: string;
  groupId: string;
  label: string;
  isDefault: boolean;
}

/**
 * Pede permissão de microfone e solta as faixas na hora.
 *
 * O prompt precisa acontecer no gesto do usuário (o clique em "Entrar"), muito
 * antes do LiveKit conectar — e sem permissão o `enumerateDevices` devolve
 * labels vazios, o que deixaria o seletor de microfone inútil. Depois disso o
 * LiveKit reabre o microfone por conta própria; segurar esta faixa manteria
 * duas capturas abertas (e dois indicadores de mic no sistema).
 */
export async function probeMic(deviceId?: string): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: deviceId ? { deviceId: { ideal: deviceId } } : true,
      video: false,
    });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch (err) {
    console.warn('[voice] microfone indisponível:', err);
    return false;
  }
}

/** Entradas de áudio disponíveis. Só devolve labels úteis após a permissão. */
export async function listMics(): Promise<MicDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');

    // o Chrome entrega uma entrada sintética 'default' que aponta para um
    // dispositivo real; colapsa nela em vez de mostrar a linha duplicada
    const synthetic = inputs.find((d) => d.deviceId === 'default');
    const defaultGroup = synthetic?.groupId;

    return inputs
      .filter((d) => d.deviceId !== 'default' && d.deviceId !== 'communications')
      .map((d, i) => ({
        deviceId: d.deviceId,
        groupId: d.groupId,
        label: d.label || `Microfone ${i + 1}`,
        isDefault: d.groupId === defaultGroup,
      }));
  } catch (err) {
    console.warn('[voice] falha ao listar microfones:', err);
    return [];
  }
}

export function loadMicPreference(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveMicPreference(deviceId: string | null): void {
  try {
    if (deviceId) localStorage.setItem(STORAGE_KEY, deviceId);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage bloqueado (modo privado): a escolha só não persiste
  }
}
