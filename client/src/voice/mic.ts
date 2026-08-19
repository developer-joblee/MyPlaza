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

/**
 * Entradas de áudio disponíveis. Só devolve labels úteis após a permissão.
 *
 * A entrada sintética `default` é mantida na lista de propósito: quando o
 * microfone abre sem restrição de dispositivo, é ela que o navegador usa e é
 * ela que o `getSettings().deviceId` reporta — filtrá-la deixaria a linha em
 * uso sem marcação. Além disso, "seguir o padrão do sistema" é uma escolha
 * legítima (é o que Discord e Zoom oferecem). Já `communications` é um alias
 * do Windows que só confunde, e sai.
 */
export async function listMics(): Promise<MicDevice[]> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices
      .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');

    return inputs.map((d, i) => {
      const isDefault = d.deviceId === 'default';
      return {
        deviceId: d.deviceId,
        groupId: d.groupId,
        label: isDefault ? 'Padrão do sistema' : d.label || `Microfone ${i + 1}`,
        isDefault,
      };
    });
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
