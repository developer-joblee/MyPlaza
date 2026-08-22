import { PEER_VOLUME_DEFAULT, type PeerAudioMap, type PeerAudioPrefs } from '@together/shared';
import { runtime } from './runtime';
import { useStore } from './state/store';

/**
 * Volume por pessoa: os efeitos num lugar só.
 *
 * Existe pelo mesmo motivo que `booble.ts`, `call.ts` e `soundboard/index.ts`:
 * mexer no volume de alguém toca **duas** coisas numa ordem só (o store, que é
 * o que a tela e o próximo som leem, e a sala de voz, que precisa reaplicar o
 * ganho agora em vez de no próximo tick), e espalhar isso pelo componente
 * deixaria a UI e o áudio livres para discordar.
 *
 * A divisão é a mesma que o soundboard já usa para o volume global:
 * `applyPeerAudio` vale **na hora**, `persistPeerAudio` grava **depois** (com
 * debounce na tela). Falhar ao gravar não desfaz o que a pessoa ouviu.
 *
 * Ver `docs/features/volume-por-pessoa.md`.
 */

/** O ajuste de uma pessoa, ou o default (cheio) quando ela nunca foi ajustada. */
export function peerAudioOf(id: string): PeerAudioPrefs {
  return (
    useStore.getState().peerAudio[id] ?? {
      voice: PEER_VOLUME_DEFAULT,
      sound: PEER_VOLUME_DEFAULT,
    }
  );
}

/**
 * Aplica agora: store + o ganho da voz dessa pessoa na sala.
 *
 * O soundboard **não** é reaplicado aqui de propósito: o ganho de um som é
 * resolvido no disparo (`receiveSound`), então o valor novo vale do próximo som
 * em diante. Ver a nota lá.
 */
export function applyPeerAudio(id: string, prefs: PeerAudioPrefs): void {
  useStore.getState().setPeerAudio(id, prefs);
  runtime.voice?.refreshPeerVolume(id);
}

/**
 * Hidratação vinda do servidor (`audio:prefs`), no join meu ou de quem chega.
 *
 * Passa por aqui, e não direto pelo store, porque tem efeito de áudio: sem
 * reaplicar, quem eu já tinha baixado entraria alto e só cairia no próximo tick
 * — audível, justamente no momento em que a pessoa aparece.
 */
export function receivePeerAudio(prefs: PeerAudioMap): void {
  useStore.getState().mergePeerAudio(prefs);
  for (const id of Object.keys(prefs)) runtime.voice?.refreshPeerVolume(id);
}

/**
 * Grava no perfil. Devolve o motivo da falha, ou `null` quando gravou.
 *
 * Não desfaz nada em caso de erro: a pessoa continua ouvindo o que escolheu
 * nesta sessão, com um aviso na tela. Fazer o áudio pular de volta sozinho seria
 * pior que o aviso — é a mesma escolha do volume global do soundboard.
 *
 * Sem Supabase isto responde `not-configured` toda vez, e é o esperado: o ajuste
 * vale na sessão e não persiste.
 */
export async function persistPeerAudio(id: string, prefs: PeerAudioPrefs): Promise<string | null> {
  const api = runtime.audioApi;
  if (!api) return 'error';
  const res = await api.setPeer(id, prefs.voice, prefs.sound);
  return res.ok ? null : res.reason;
}
