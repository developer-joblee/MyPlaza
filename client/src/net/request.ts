import type { AppSocket } from './socket';

/**
 * A fronteira entre a UI e o backend.
 *
 * Toda requisição ao servidor passa por aqui — nenhum componente, objeto de jogo
 * ou store chama `socket.emit` direto. A regra não tem exceção de propósito:
 * regra com exceção é a que alguém "conserta" depois.
 *
 * As três funções abaixo nasceram de `voiceApi.ts` (o pedido de token de voz), que já resolvia isto para
 * um caso só (o token de voz) e virou o caso geral. O comentário mais
 * importante está em `request()`: é um bug de produção que já aconteceu.
 */

/**
 * Motivos que o CLIENTE inventa. O servidor nunca os emite — ele nem soube do
 * pedido. Mesma convenção do `VoiceTokenResponse` no `shared`.
 */
export type TransportFailure = 'socket-down' | 'timeout';

/**
 * O socket com prazo, como o socket.io o tipa. Extraído por `ReturnType` em vez
 * de reescrito à mão: assim o ack continua tipado evento por evento e um
 * `emit` com argumento errado ainda quebra a compilação.
 */
export type TimeoutSocket = ReturnType<AppSocket['timeout']>;

/**
 * Teto de espera por uma operação de um clique. O servidor responde em
 * milissegundos, então chegar perto disto significa socket ruim, não servidor
 * lento — e o que a pessoa precisa é o botão de volta, não mais espera.
 */
const DEFAULT_TIMEOUT_MS = 10000;

/**
 * Emite e espera o ack, sem nunca lançar e sem nunca ficar pendurado.
 *
 * Três coisas que parecem paranoia e não são:
 *
 * 1. **Confere `socket.connected` antes de emitir.** Emitir com o socket caído
 *    manda o pacote para o `sendBuffer`, e o socket.io **não** limpa o ack de
 *    pacotes enfileirados — o timeout dispara sem o servidor nunca ter visto o
 *    pedido. Era exatamente o "operation has timed out" do log de produção.
 * 2. **Escuta `disconnect` enquanto espera.** Cair no meio da espera é resposta
 *    imediata, não `DEFAULT_TIMEOUT_MS` de espera inútil.
 * 3. **`socket.timeout()` do próprio socket.io**, para o ack ter um fim mesmo
 *    quando o servidor aceita o pedido e morre antes de responder.
 *
 * `fallback` traduz a falha de transporte no tipo de resposta de cada domínio,
 * para o chamador ter **um** formato de resultado em vez de dois `ok`
 * aninhados.
 */
export function request<T>(
  socket: AppSocket | null,
  emit: (socket: TimeoutSocket, ack: (err: Error | null, res: T) => void) => void,
  fallback: (reason: TransportFailure) => T,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) {
      resolve(fallback('socket-down'));
      return;
    }

    let done = false;
    const finish = (res: T) => {
      if (done) return;
      done = true;
      socket.off('disconnect', onDown);
      resolve(res);
    };
    const onDown = () => finish(fallback('socket-down'));
    socket.once('disconnect', onDown);

    emit(socket.timeout(timeoutMs), (err, res) => {
      if (err) {
        console.warn('[net] requisição sem resposta:', err.message);
        finish(fallback('timeout'));
      } else {
        finish(res);
      }
    });
  });
}

/**
 * Emite sem ack (os eventos que o protocolo define como sem resposta: mover,
 * sentar, ausentar-se, chat, tela).
 *
 * Devolve `false` quando não há socket conectado, em vez do
 * `runtime.socket?.emit(...)` que sumia com o pedido em silêncio. É o que
 * permite ao chamador não limpar o campo de texto de uma mensagem que não foi.
 */
export function fire(socket: AppSocket | null, send: (socket: AppSocket) => void): boolean {
  if (!socket || !socket.connected) return false;
  send(socket);
  return true;
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Serializa por chave: enquanto uma chamada está em vôo, a mesma chave devolve
 * `null` em vez de disparar uma segunda.
 *
 * Existe porque a guarda anterior era estado do React (`busy`), que só atualiza
 * no próximo render — dois cliques rápidos em "Criar" passavam os dois e
 * criavam dois mundos. É a mesma técnica do `dedupe()` em
 * `server/src/supabase.ts`, e por ser um `Map` de promessas ela não depende de
 * ciclo de render nenhum.
 */
export function once<T>(key: string, run: () => Promise<T>): Promise<T | null> {
  if (inFlight.has(key)) return Promise.resolve(null);
  const p = run().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}
