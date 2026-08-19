import type { LocalAudioTrack } from 'livekit-client';

const STORAGE_KEY = 'together:noiseFilter';

/** Ligado por padrão: é o maior ganho de qualidade da migração. */
export function loadNoiseFilterPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function saveNoiseFilterPreference(enabled: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? 'on' : 'off');
  } catch {
    // localStorage bloqueado: a escolha só não persiste
  }
}

export interface NoiseFilterHandle {
  setEnabled: (on: boolean) => Promise<unknown>;
  destroy: () => Promise<void>;
}

/**
 * Cancelamento de ruído do Krisp, bem melhor que o `noiseSuppression` nativo
 * do browser (que segue ligado como piso).
 *
 * O import dinâmico vive só aqui: é o único lugar que nomeia o pacote, então
 * ele vira um chunk separado — e é um chunk **grande** (~2MB gzip, com o wasm
 * embutido em base64). Por isso quem desliga a preferência nunca chama esta
 * função e nunca baixa nada. Tudo é fail-soft: sem suporte ou com erro, o áudio
 * segue com a supressão nativa.
 *
 * `useBVC: false` é deliberado: o BVC (voice isolation, modelos VIVA) é cobrado
 * à parte no LiveKit Cloud, enquanto este NC de supressão de ruído vem incluso.
 */
export async function applyNoiseFilter(track: LocalAudioTrack): Promise<NoiseFilterHandle | null> {
  try {
    const { KrispNoiseFilter, isKrispNoiseFilterSupported } = await import(
      '@livekit/krisp-noise-filter'
    );
    if (!isKrispNoiseFilterSupported()) {
      console.info('[voice] Krisp não suportado neste navegador — usando a supressão nativa');
      return null;
    }
    const processor = KrispNoiseFilter({ useBVC: false });
    await track.setProcessor(processor);
    await processor.setEnabled(true);
    console.info('[voice] cancelamento de ruído do Krisp ativo');
    return processor;
  } catch (err) {
    console.warn('[voice] Krisp indisponível, seguindo com a supressão nativa:', err);
    return null;
  }
}
