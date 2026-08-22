import { PEER_VOLUME_DEFAULT, PEER_VOLUME_MAX } from '@together/shared';
import { audioVolumeFor } from '../voice/proximity';
import { runtime } from '../runtime';
import { useStore } from '../state/store';
import { SoundPlayer } from './SoundPlayer';

/**
 * Os efeitos do soundboard num lugar só: tocar, receber e recarregar a
 * biblioteca.
 *
 * Existe pelo mesmo motivo que `presence.ts`: quem recebe um som precisa mexer
 * em três coisas (store, player de áudio e a regra de audibilidade do jogo) numa
 * ordem só, e espalhar isso pela UI deixaria o som órfão do estado. O
 * `bindStore` roteia `soundboard:played` para cá, e não direto para o store,
 * exatamente como faz com o `presence:nudged`.
 */

export { SoundPlayer } from './SoundPlayer';

/**
 * Toca um som meu.
 *
 * Toca **local** também, e não só manda para a rede, porque o servidor entrega
 * apenas aos outros (`audienceFor` exclui quem disparou): sem o eco local a
 * pessoa clica e não ouve nada, o que lê como botão quebrado. Ganho cheio, sem
 * atenuação — a distância de você até você mesmo é zero.
 *
 * Devolve `false` quando não havia conexão, e é isso que a grade usa para não
 * marcar o botão como disparado.
 */
export function playSound(soundId: string): boolean {
  const sound = useStore.getState().soundboard?.sounds.find((s) => s.id === soundId);
  if (!sound) return false;
  const sent = runtime.soundApi?.play(soundId) ?? false;
  if (sent) runtime.soundboard?.play(sound.id, sound.url, 1);
  return sent;
}

/**
 * Alguém perto tocou um som.
 *
 * O servidor já filtrou quem PODE ouvir; aqui se decide QUANTO, e a decisão é
 * delegada a `audioVolumeFor` — a mesma função que dá o volume da voz. É o ponto
 * mais importante deste arquivo: uma segunda regra de audibilidade divergiria da
 * primeira na primeira alteração (foi o que aconteceu quando ela estava copiada
 * em dois pontos do `VoiceRoom`), e a divergência aqui é audível.
 *
 * As guardas antes disso são de estado local, e existem porque o servidor não
 * conhece nenhuma delas: ele não sabe que eu cortei os sons dos outros, que eu
 * fiquei surdo, nem que fiquei ausente.
 */
export function receiveSound(fromId: string, soundId: string, url: string): void {
  const store = useStore.getState();
  if (store.soundboardMuted) return;
  /**
   * Surdo e ausente não ouvem som de soundboard — ao contrário do "toc-toc",
   * que atravessa de propósito. A diferença é o que cada um significa: o
   * chamado é a campainha da porta, dirigida a você e a mais ninguém; o
   * soundboard é a conversa da sala, e quem cortou o áudio da sala cortou isso
   * também.
   */
  if (store.deafened || store.away) return;

  const info = runtime.game?.getAudioInfo();
  if (!info) return;
  const peer = info.peers.get(fromId);
  // não conheço essa pessoa (evento chegou antes do `player:joined`): sem
  // posição não há volume honesto, e adivinhar 1 seria alto demais
  if (!peer) return;

  /**
   * Dois fatores, e os dois por pessoa: a geometria (a MESMA função da voz) e o
   * meu ajuste de soundboard **para esta pessoa**. O terceiro fator, o volume
   * global, é o gain mestre lá dentro do `SoundPlayer`.
   *
   * O ajuste por pessoa entra aqui, e não num `GainNode` por emissor, porque
   * `play()` recebe o ganho já resolvido: a consequência é que mudar o slider
   * **não** altera um som que já está tocando (só o mestre faz isso, por ser um
   * nó só). Com sons de no máximo 5s, é o mesmo comportamento que o mute por
   * pessoa já tem — ver `docs/features/volume-por-pessoa.md`.
   */
  const gain =
    audioVolumeFor(info.self, peer) *
    ((store.peerAudio[fromId]?.sound ?? PEER_VOLUME_DEFAULT) / PEER_VOLUME_MAX);
  runtime.soundboard?.play(soundId, url, gain);
}

/**
 * Recarrega minha biblioteca a partir do servidor e guarda no store.
 *
 * Devolve o motivo da recusa (ou `null` se deu certo) para a tela poder dizer o
 * que aconteceu. Sem Supabase a resposta é `not-configured`, e é isso que deixa
 * o botão da barra desabilitado em vez de abrir um painel vazio.
 */
export async function refreshSoundboard(): Promise<string | null> {
  const api = runtime.soundApi;
  if (!api) return 'socket-down';
  const res = await api.list();
  if (!res.ok) {
    useStore.getState().setSoundboard(null);
    return res.reason;
  }
  useStore.getState().setSoundboard(res.state);
  /**
   * O volume vem do perfil, então o `list` é o momento de hidratá-lo — nos dois
   * destinos: o store (que a tela lê) e o player (que aplica no áudio). Sem o
   * segundo, a preferência salva só valeria depois de a pessoa mexer no slider.
   */
  applyVolume(res.state.volume);
  // o primeiro clique no próprio som não deve esperar download
  for (const sound of res.state.sounds) runtime.soundboard?.preload(sound.id, sound.url);
  return null;
}

/**
 * Aplica o volume no store e no player, sem tocar na rede.
 *
 * É o caminho do arrasto do slider: a pessoa tem de ouvir a mudança **agora**, e
 * a escrita no banco vem depois (`persistVolume`, com debounce). Separar os dois
 * é o que evita uma escrita por pixel de slider.
 */
export function applyVolume(volume: number): void {
  useStore.getState().setSoundboardVolume(volume);
  runtime.soundboard?.setVolume(volume);
}

/**
 * Persiste o volume no perfil. Devolve o motivo da recusa, ou `null`.
 *
 * Chamado com debounce pela tela. Não desfaz a mudança local se falhar: o volume
 * que a pessoa escolheu continua valendo nesta sessão — perder a persistência é
 * um aviso, não motivo para o áudio pular de volta sozinho.
 */
export async function persistVolume(volume: number): Promise<string | null> {
  const api = runtime.soundApi;
  if (!api) return 'socket-down';
  const res = await api.setVolume(volume);
  if (!res.ok) return res.reason;
  useStore.getState().setSoundboard(res.state);
  return null;
}

/** Cria o player e o guarda no `runtime`. Chamado uma vez, pelo `GameView`. */
export function createSoundPlayer(): SoundPlayer {
  const player = new SoundPlayer();
  runtime.soundboard = player;
  return player;
}
