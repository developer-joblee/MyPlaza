import { client, dbConfigured, guard } from './supabase';

/**
 * Verificação de login. O servidor NUNCA emite nem valida JWT por conta
 * própria: ele pergunta ao Supabase quem é o dono daquele token.
 *
 * Por que `auth.getUser(token)` e não verificar a assinatura localmente:
 *
 * - Zero dependência nova e zero chave de JWT para guardar (uma chave a menos
 *   é uma chave a menos para vazar).
 * - Funciona igual com projeto de chave simétrica (legado) e assimétrica
 *   (JWKS), que é o que projetos novos do Supabase usam — verificar na mão
 *   exigiria tratar os dois.
 * - Respeita revogação: conta desativada ou sessão derrubada no dashboard para
 *   de entrar na hora. Verificação local só descobriria no vencimento.
 *
 * O preço é uma chamada de rede por conexão. É paga uma vez no `join`, com o
 * mesmo teto de tempo de qualquer consulta (`guard`), e o resultado fica no
 * `socket.data` — não há uma chamada por movimento.
 */

/** Login é exigido exatamente quando dá para verificar (ver `supabase.ts`). */
export const authRequired = dbConfigured;

export interface AuthUser {
  /** id da conta no Supabase Auth (`auth.users.id`) */
  id: string;
  /** e-mail confirmado da conta; é por ele que o convite é encontrado */
  email: string | null;
}

/**
 * Quem é o dono deste token, ou null se o token é inválido, vencido, revogado
 * ou se o Supabase não respondeu.
 *
 * Null é sempre "não entra". Nunca "entra sem verificar" — é a razão de esta
 * função não ter fallback permissivo como as de `db.ts`.
 */
export async function verifyAccessToken(token: string): Promise<AuthUser | null> {
  if (!client || !token) return null;
  return guard<AuthUser | null>(
    'verifyAccessToken',
    async () => {
      const { data, error } = await client!.auth.getUser(token);
      if (error || !data?.user) {
        /**
         * Token ruim é rotina — toda reconexão com token vencido passa por aqui,
         * e logar isso viraria ruído. Mas erro que **não** é rejeição de
         * credencial (401/403) é problema nosso: URL do projeto errada, projeto
         * diferente do que o navegador usa, Supabase fora do ar. Esse caso
         * calava do jeito errado: desaparecia como "token inválido" e mandava
         * investigar a sessão da pessoa, que estava perfeita.
         *
         * Loga a mensagem do erro, nunca o token.
         */
        if (error && error.status !== 401 && error.status !== 403) {
          console.error(
            `[auth] getUser falhou, e NÃO por token ruim: ${error.message} — ` +
              'confira SUPABASE_URL (e se é o mesmo projeto do VITE_SUPABASE_URL do client).',
          );
        }
        return null;
      }
      return { id: data.user.id, email: data.user.email ?? null };
    },
    null,
  );
}
