import { onAccessTokenChange } from '../auth/supabase';
import { fire } from './request';
import type { AppSocket } from './socket';

/**
 * Mantém o token do servidor em dia num socket que **já está conectado**.
 *
 * O `auth` de `socket.ts` resolve a conexão: ele é função, então a reconexão
 * pega o token que o SDK renovou. O que ele não resolve é a conexão que **não
 * cai** — e é a maioria: o Socket.IO só reavalia aquela função em tentativa de
 * conexão, e o servidor guarda o token do handshake sem nunca poder atualizá-lo.
 * O access token do Supabase vence em ~1h, então uma aba aberta mais que isso
 * passava a levar `invalid-token` em toda operação por ack (soundboard, volume
 * por pessoa, lobby), e a tela dizia *"Sua sessão expirou. Entre de novo."* com
 * a sessão perfeitamente viva. Reabrir o painel repetia a mensagem.
 *
 * Está em `net/` porque emite — a regra de que `socket.emit` não sai desta pasta
 * não tem exceção (ver `docs/features/camada-de-requisicao.md`).
 *
 * Por que `fire()` e não `request()`: o evento não tem ack, e não precisa. Com o
 * socket caído `fire()` devolve `false` e nada é perdido — a reconexão leva o
 * token novo no handshake, que é o caminho que sempre funcionou.
 *
 * O primeiro aviso do SDK costuma trazer o token que o handshake já levou; o
 * servidor descarta token igual ao que tem, então isso custa uma mensagem e
 * nenhuma verificação.
 */
export function bindAccessToken(getSocket: () => AppSocket | null): () => void {
  return onAccessTokenChange((token) => {
    fire(getSocket(), (s) => s.emit('auth:token', token));
  });
}
