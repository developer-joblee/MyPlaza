import type { Server, Socket } from 'socket.io';
import {
  PEER_VOLUME_MAX,
  clampPeerVolume,
  type ClientToServerEvents,
  type PeerAudioErrorReason,
  type PeerAudioMap,
  type PeerAudioPrefs,
  type PeerAudioResult,
  type ServerToClientEvents,
} from '@together/shared';
import { authRequired, verifyAccessToken } from './auth';
import { loadPeerAudioPrefs, savePeerAudioPref } from './db';
import type { SocketData } from './handlers';
import type { World } from './world';

/**
 * Volume por pessoa: quanto EU ouço a voz e os sons de soundboard de CADA um.
 *
 * O papel deste módulo é **traduzir**. A preferência é durável e por isso vive
 * chaveada por `profiles.id`; o cliente, porém, chaveia tudo por `socket.id`
 * (roster, distâncias, participantes do LiveKit). Traduzir num lugar só evita
 * duas coisas ruins: o `profileId` de terceiros entrar no protocolo por uma
 * razão que não pede isso, e o cliente ter de manter uma segunda tabela de
 * identidades que ele não tem como preencher.
 *
 * O quanto cada um ouve continua sendo decisão do **cliente** — aqui não há
 * nenhuma conta de áudio, só quem-é-quem e a persistência. É a mesma divisão do
 * soundboard: o servidor escolhe quem recebe, o cliente decide o volume.
 *
 * Ver `docs/features/volume-por-pessoa.md`.
 */

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * O `profileId` e o mapa em cache de um socket que está num mundo.
 *
 * Lê de `io.sockets.sockets` em vez de `io.fetchSockets()` de propósito: aquele
 * é assíncrono e devolve `RemoteSocket`, cujo `data` é uma cópia — e o que se
 * precisa aqui é do `Map` vivo que o join guardou. Um processo só, um `Map`.
 */
function peerOf(io: IoServer, socketId: string): SocketData | null {
  return io.sockets.sockets.get(socketId)?.data ?? null;
}

/**
 * Carrega o meu mapa (uma vez, no join) e me manda o que vale para quem já está
 * aqui; depois avisa quem já me ajustou que eu cheguei com um `socket.id` novo.
 *
 * As DUAS direções no mesmo laço, porque são a mesma pergunta feita nos dois
 * sentidos — e porque percorrer o mundo duas vezes daria a chance de alguém sair
 * no meio e as duas metades discordarem.
 *
 * Sem Supabase (`authRequired` falso, ou socket sem perfil) isto é no-op: os
 * sliders do cliente continuam valendo na sessão, e nada é enviado nem gravado.
 * Mesma degradação do resto do app.
 */
export async function hydratePeerAudio(io: IoServer, socket: IoSocket, world: World): Promise<void> {
  const profileId = socket.data.profileId;
  if (!authRequired || !profileId) return;

  const mine = await loadPeerAudioPrefs(profileId);
  // caiu enquanto o banco respondia: não deixa cache pendurado em socket morto
  if (socket.disconnected) return;
  socket.data.peerAudio = mine;

  const forMe: PeerAudioMap = {};
  for (const other of world.getPlayers()) {
    if (other.id === socket.id) continue;
    const data = peerOf(io, other.id);
    const otherProfile = data?.profileId;
    if (!otherProfile) continue;

    // 1. o que EU já ajustei desta pessoa
    const mineForThem = mine.get(otherProfile);
    if (mineForThem) forMe[other.id] = mineForThem;

    /**
     * 2. o que ELA já ajustou de mim — o `socket.id` dela é antigo, o meu é
     *    novo, então é agora que a chave dela para mim passa a existir de novo.
     *
     * **Não "limpe" esta metade por parecer redundante com a 1.** É ela que
     * fecha uma corrida: se B entra enquanto o `await loadPeerAudioPrefs` de A
     * ainda está no ar, o hydrate de B lê `A.data.peerAudio` como `undefined` e
     * não emite nada para A — mas o laço de A, que roda depois do await, já vê B
     * em `getPlayers()` e cobre. Com uma metade só, um dos dois lados fica sem a
     * preferência até alguém dar F5.
     */
    const theirsForMe = data?.peerAudio?.get(profileId);
    if (theirsForMe) io.to(other.id).emit('audio:prefs', { [socket.id]: theirsForMe });
  }

  if (Object.keys(forMe).length > 0) socket.emit('audio:prefs', forMe);
}

export function registerAudioPrefHandlers(io: IoServer, socket: IoSocket): void {
  const fail = (reason: PeerAudioErrorReason): PeerAudioResult => ({ ok: false, reason });

  /**
   * Quem está pedindo. Cópia do `whoAmI` do soundboard, e pelo mesmo motivo: o
   * token é verificado de novo em vez de confiar só no `socket.data`, porque
   * `profileId` só é escrito no `join` e um pedido antes dele não teria passado
   * por autenticação nenhuma.
   */
  async function whoAmI(): Promise<
    { ok: true; profileId: string } | { ok: false; reason: PeerAudioErrorReason }
  > {
    if (!authRequired) return { ok: false, reason: 'not-configured' };
    const profileId = socket.data.profileId;
    if (!profileId) return { ok: false, reason: 'auth-required' };
    const token = String(socket.handshake.auth?.token ?? '');
    if (!token) return { ok: false, reason: 'auth-required' };
    const authUser = await verifyAccessToken(token);
    if (!authUser || authUser.id !== socket.data.authUserId) {
      return { ok: false, reason: 'invalid-token' };
    }
    return { ok: true, profileId };
  }

  const validVolume = (v: unknown): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= PEER_VOLUME_MAX;

  socket.on('audio:setPeer', async (rawTarget, rawVoice, rawSound, ack) => {
    if (typeof ack !== 'function') return;
    const reply = ack as (res: PeerAudioResult) => void;

    const who = await whoAmI();
    if (!who.ok) return reply(fail(who.reason));

    try {
      const targetId = String(rawTarget ?? '');
      if (!targetId || targetId === socket.id) return reply(fail('invalid-input'));
      /**
       * Números de verdade, e não `clampPeerVolume` direto: o clamp existe para
       * não gravar lixo, mas um cliente mandando `"alto"` ou `-3` é bug dele, e
       * silenciar isso viraria "arrastei e voltou para 100 sozinho".
       */
      if (!validVolume(rawVoice) || !validVolume(rawSound)) return reply(fail('invalid-input'));

      /**
       * O alvo tem de estar **neste** socket e ter perfil. Não se ajusta o
       * volume de quem não está aqui: o cliente só conhece `socket.id` de quem
       * está no mundo, e aceitar um id qualquer transformaria este handler numa
       * sonda de "esta pessoa está online?".
       */
      const target = peerOf(io, targetId);
      const targetProfile = target?.profileId;
      if (!targetProfile || target?.worldKey !== socket.data.worldKey) {
        return reply(fail('not-found'));
      }
      // uma conta em duas abas: ajustar a si mesmo não existe, e o banco recusaria
      if (targetProfile === who.profileId) return reply(fail('invalid-input'));

      const prefs: PeerAudioPrefs = {
        voice: clampPeerVolume(rawVoice),
        sound: clampPeerVolume(rawSound),
      };
      /**
       * O cache entra ANTES da escrita, e continua valendo se ela falhar.
       *
       * Parece errado e não é: o cache é a verdade **da sessão**, o banco é a
       * verdade **entre sessões**. Quando a escrita falha, o cliente mantém o
       * valor local de propósito (é o contrato do volume do soundboard: falhar
       * ao gravar não desfaz o que a pessoa já está ouvindo) — se o cache aqui
       * ficasse sem a entrada, o F5 do OUTRO lado projetaria o valor antigo e a
       * pessoa voltaria a 100% no meio da sessão, sem nada na tela.
       *
       * É deste mapa, e não do banco, que o `hydratePeerAudio` projeta.
       */
      (socket.data.peerAudio ??= new Map()).set(targetProfile, prefs);

      const saved = await savePeerAudioPref(
        who.profileId,
        targetProfile,
        prefs.voice,
        prefs.sound,
      );
      if (!saved) return reply(fail('error'));
      reply({ ok: true });
    } catch (err) {
      console.error('[audio] setPeer:', err instanceof Error ? err.message : err);
      reply(fail('error'));
    }
  });
}
