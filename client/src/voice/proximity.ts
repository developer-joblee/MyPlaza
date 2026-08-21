import { BOOBLE_OUTSIDE_VOLUME, PROXIMITY_RADIUS } from '@together/shared';

/** Volume total até 40% do raio, depois rampa linear até 0 no limite. */
export function volumeForDistance(distance: number): number {
  const fullUntil = PROXIMITY_RADIUS * 0.4;
  if (distance <= fullUntil) return 1;
  const v = 1 - (distance - fullUntil) / (PROXIMITY_RADIUS - fullUntil);
  return Math.max(0, Math.min(1, v));
}

/** O que a voz precisa saber sobre MIM para decidir o volume dos outros. */
export interface SelfAudio {
  /** sala fechada em que estou; `null` = área aberta */
  zone: string | null;
  /** booble em que estou; `null` = nenhuma */
  booble: string | null;
}

/** ...e sobre cada peer. Distância em px do mundo. */
export interface PeerAudio {
  distance: number;
  zone: string | null;
  booble: string | null;
}

/**
 * Tudo que o jogo entrega à voz a cada tick. Vive aqui, e não no `Game`, porque
 * é o contrato do áudio — quem consome é o `VoiceRoom`.
 */
export interface AudioInfo {
  self: SelfAudio;
  peers: Map<string, PeerAudio>;
}

/**
 * **A regra de audibilidade, inteira e num lugar só.**
 *
 * Ela morava copiada em dois pontos do `VoiceRoom` (o tick e o
 * `onTrackSubscribed`, que precisa do volume certo para a subscrição nova não
 * entrar a todo volume por um tick). Duas cópias de uma regra que cresceu com a
 * booble divergiriam na primeira alteração — e a divergência aqui é audível,
 * não é um detalhe de estilo.
 *
 * As três camadas, na ordem em que se aplicam:
 *
 * 1. **Mesma booble → 1.** Ignora distância e ignora parede: quem entrou numa
 *    booble se ouve cheio, mesmo que um dos dois atravesse a porta da sala de
 *    reunião. O que impede a booble de esticar pelo mapa é o servidor, que
 *    remove quem se afasta (`BOOBLE_EXIT_RADIUS`), não esta função.
 * 2. **A regra de sempre.** Zona diferente é silêncio absoluto (é o que faz a
 *    sala ser fechada); dentro de uma sala o volume é plano; na área aberta vale
 *    a rampa por distância.
 * 3. **Atravessar a borda de uma booble custa `BOOBLE_OUTSIDE_VOLUME`**, e custa
 *    nos DOIS sentidos — tanto quem está na booble ouvindo a sala quanto a sala
 *    ouvindo a booble. É essa simetria que faz a conversa paralela funcionar:
 *    atenuar só um lado deixaria quem está na booble com dois áudios cheios
 *    competindo, que é exatamente o problema que a feature existe para resolver.
 *
 * Note que quem não está em booble nenhuma, e não tem ninguém em booble por
 * perto, cai em `base` sem multiplicador: o comportamento de antes, intacto.
 */
export function audioVolumeFor(self: SelfAudio, peer: PeerAudio): number {
  if (self.booble !== null && peer.booble === self.booble) return 1;

  const mesmaZona = peer.zone === self.zone;
  const base = !mesmaZona ? 0 : self.zone !== null ? 1 : volumeForDistance(peer.distance);

  if (self.booble !== null || peer.booble !== null) return base * BOOBLE_OUTSIDE_VOLUME;
  return base;
}
