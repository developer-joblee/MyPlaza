import type { Server, Socket } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@together/shared';
import { authRequired, verifyAccessToken } from './auth';
import type { SocketData } from './handlers';

/**
 * O token de acesso de um socket **vivo**, e o `whoAmI` que os handlers de
 * dentro do jogo compartilham.
 *
 * ## O defeito que este arquivo existe para corrigir
 *
 * `socket.handshake.auth` é fotografado no momento da conexão e **nunca muda**
 * depois: o Socket.IO reavalia a função `auth` do cliente a cada tentativa de
 * conexão, e um socket que não cai não tem tentativa nenhuma. O access token do
 * Supabase vence em ~1h, e o SDK do navegador o renova em background — então,
 * passada a primeira hora de aba aberta, o servidor continuava validando a
 * cópia velha. Toda operação de soundboard e de volume por pessoa passava a
 * responder `invalid-token`, e a tela dizia *"Sua sessão expirou. Entre de
 * novo."* para uma sessão perfeitamente viva. Sem cair a conexão, não saía
 * disso: reabrir o painel repetia a mensagem.
 *
 * A correção é o cliente **empurrar** o token renovado (`auth:token`), e o
 * servidor guardá-lo em `socket.data.accessToken`. O handshake continua sendo a
 * origem — é ele que autentica a conexão — e vira o fallback.
 *
 * Ver `docs/features/autenticacao-e-acesso.md`.
 */

type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/**
 * O token mais novo que temos deste socket.
 *
 * `socket.data.accessToken` primeiro, handshake depois: o empurrado é sempre
 * mais novo que o do handshake (o cliente só manda quando o SDK renovou), e o
 * handshake cobre o caso normal de quem acabou de conectar e ainda não teve
 * renovação nenhuma.
 *
 * **Todo** consumidor de token dentro do servidor tem de passar por aqui. Ler
 * `socket.handshake.auth.token` direto é o bug de novo.
 *
 * `||` e não `??`: string vazia não é token, e com `??` um `accessToken` vazio
 * venceria o handshake e apagaria o único token válido que havia. Hoje o handler
 * abaixo nunca guarda vazio — isto é para o dia em que alguém o guardar.
 */
export function socketToken(socket: IoSocket): string {
  return socket.data.accessToken || String(socket.handshake.auth?.token ?? '');
}

/**
 * Motivos que `whoIsSocket` pode devolver. É um subconjunto de
 * `SoundboardErrorReason` e de `PeerAudioErrorReason` de propósito: os dois
 * unions contêm estes quatro membros, então cada chamador alarga sem conversão.
 */
export type SocketAuthReason = 'not-configured' | 'auth-required' | 'invalid-token' | 'error';

export type SocketWho =
  | { ok: true; profileId: string }
  | { ok: false; reason: SocketAuthReason };

/**
 * Quem está pedindo, para os handlers de **dentro do mundo** (soundboard e
 * volume por pessoa).
 *
 * Estava duplicado nos dois arquivos — o comentário do `audioPrefs.ts` dizia
 * "cópia do `whoAmI` do soundboard", o que é exatamente o aviso de que um dia
 * as duas divergiriam. O lobby tem um `whoAmI` próprio e continua tendo: lá o
 * perfil é **criado** se não existir (a pessoa ainda não entrou em mundo
 * nenhum), e aqui isso seria errado.
 *
 * Diferente do lobby, aqui não se cria perfil: o soundboard é uma tela de dentro
 * do jogo, então o `join` já passou. `socket.data.profileId` só é escrito no
 * `join`, depois do portão inteiro — é por isso que a ausência dele é
 * `auth-required` e não uma verificação a mais.
 *
 * O token é reverificado a cada chamada (e não só no `join`) para respeitar
 * revogação: conta desativada ou sessão derrubada no dashboard para de escrever
 * na hora. O custo é um round-trip por gravação — conhecido, e anotado no
 * `PENDENTES.md`.
 */
export async function whoIsSocket(socket: IoSocket): Promise<SocketWho> {
  if (!authRequired) return { ok: false, reason: 'not-configured' };
  const profileId = socket.data.profileId;
  if (!profileId) return { ok: false, reason: 'auth-required' };
  const token = socketToken(socket);
  if (!token) return { ok: false, reason: 'auth-required' };
  const verified = await verifyAccessToken(token);
  if (!verified.ok) {
    /**
     * `unavailable` não é sessão vencida — é o Supabase que não respondeu. Dizer
     * `invalid-token` aqui era o que punha "Sua sessão expirou. Entre de novo."
     * na tela por causa de um timeout de 2,5s.
     */
    return { ok: false, reason: verified.reason === 'invalid' ? 'invalid-token' : 'error' };
  }
  // token válido, mas de OUTRA conta: um socket não troca de identidade no meio
  // da vida. Não é falha de infraestrutura, é pedido que não se aceita.
  if (verified.user.id !== socket.data.authUserId) return { ok: false, reason: 'invalid-token' };
  return { ok: true, profileId };
}

/**
 * Recebe o token renovado pelo SDK do Supabase no navegador.
 *
 * Sem ack, como os eventos de mundo, e por uma razão específica: perder este
 * evento não perde nada. Se o socket estiver caído o cliente nem envia
 * (`fire()` devolve `false`), e a reconexão leva o token novo no handshake — que
 * é o caminho que sempre funcionou.
 *
 * Guarda **só o que verifica**, para lixo (ou o token de outra conta) não virar
 * o token deste socket. Antes do `join` não há `authUserId` para comparar, e aí
 * basta o token ser válido: quem consome reverifica de todo jeito, e trocar o
 * handshake por outro token válido não concede nada que conectar com ele já não
 * concedesse.
 */
export function registerSocketAuthHandlers(_io: IoServer, socket: IoSocket): void {
  socket.on('auth:token', async (rawToken) => {
    if (!authRequired) return;
    const token = String(rawToken ?? '');
    if (!token || token === socketToken(socket)) return;

    const verified = await verifyAccessToken(token);
    if (!verified.ok) {
      // nunca o token, nunca o motivo do Supabase: só que não serviu
      console.warn(`[auth] token renovado recusado (${verified.reason}) — socket ${socket.id}`);
      return;
    }
    const authUserId = socket.data.authUserId;
    if (authUserId && verified.user.id !== authUserId) {
      console.warn(`[auth] token renovado é de outra conta — ignorado (socket ${socket.id})`);
      return;
    }
    socket.data.accessToken = token;
  });
}
