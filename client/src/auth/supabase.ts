import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Login no navegador.
 *
 * Sobre as variáveis serem `VITE_*`, que normalmente é proibido: a `anon key` do
 * Supabase é **publicável por projeto** — ela é feita para ir no bundle, e a
 * própria documentação a distribui assim. O que protege o banco não é ela, é o
 * RLS (ver `db/migrations/0002_rls.sql`), que não tem nenhuma política de
 * escrita: com a anon key, no máximo se lê o que é da sua empresa depois de
 * logar. A `service_role`, essa sim segredo, continua só no servidor.
 *
 * Sem as duas variáveis, `authConfigured` é false e o app entra direto no fluxo
 * anônimo de antes — o mesmo contrato de "sem LiveKit, sem voz".
 */

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * `createClient` LANÇA quando a URL é inválida (falta o `https://`, por
 * exemplo), e isto roda no topo do módulo — sem o try/catch, um valor errado no
 * `.env` derruba o bundle inteiro e a página fica **em branco**, sem nada na
 * tela que explique o motivo.
 *
 * Com o try/catch, um `.env` torto degrada para o modo anônimo e grita no
 * console. Nunca imprime o valor — só o fato de ele não servir.
 */
function connect(): SupabaseClient | null {
  if (!URL || !ANON) return null;
  try {
    return createClient(URL, ANON, {
      auth: {
        // a sessão fica no localStorage e o SDK renova o access token sozinho;
        // é o que faz o F5 não pedir login de novo
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } catch (err) {
    console.error(
      '[auth] VITE_SUPABASE_URL/ANON_KEY inválidos — seguindo sem login:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

export const supabase: SupabaseClient | null = connect();

/** Configurado E conectado: URL torta conta como não configurado. */
export const authConfigured = supabase !== null;

/** Sessão atual, ou null. Resolve rápido: lê do localStorage. */
export async function currentSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session ?? null;
}

/**
 * Access token para o handshake do socket.
 *
 * Lido **na hora da conexão**, e não guardado: o SDK renova o token em
 * background, e um token capturado no login venceria numa sessão longa — a
 * reconexão levaria um token morto e o servidor recusaria com `invalid-token`.
 */
export async function currentAccessToken(): Promise<string | null> {
  return (await currentSession())?.access_token ?? null;
}

/**
 * Avisa quando o access token **muda**, para o socket já conectado receber o
 * token novo.
 *
 * O handshake do socket resolve a conexão, e só ela: `socket.handshake.auth` é
 * fotografado no momento da conexão e o servidor continuaria validando aquela
 * cópia para sempre. Como o token vence em ~1h e o SDK o renova em background,
 * uma aba aberta por mais de uma hora passava a levar `invalid-token` em toda
 * operação por ack — e a tela dizia "sua sessão expirou" com a sessão viva. Ver
 * `client/src/net/authToken.ts`, que é quem escuta isto.
 *
 * Filtra pelo **valor**, não pelo nome do evento: além do `TOKEN_REFRESHED`, o
 * Supabase dispara `SIGNED_IN`, `USER_UPDATED` e `INITIAL_SESSION` — alguns com
 * o mesmo token, e depender da lista exata de nomes é depender de detalhe de
 * versão do SDK. Comparar o token cobre os três casos com uma regra.
 *
 * Token ausente (logout) **não** é notificado: não existe "socket sem token"
 * para atualizar, e sair da conta desmonta a tela do jogo, o que derruba o
 * socket.
 */
export function onAccessTokenChange(cb: (token: string) => void): () => void {
  if (!supabase) return () => {};
  let last: string | null = null;
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    const token = session?.access_token ?? null;
    if (!token || token === last) return;
    last = token;
    cb(token);
  });
  return () => data.subscription.unsubscribe();
}

export interface AuthResult {
  /** entrou de verdade: existe sessão, a tela de login pode sair. */
  signedIn: boolean;
  /** mensagem já em português, pronta para a tela */
  error?: string;
}

/** Traduz o erro do Supabase; o texto cru é em inglês e vaza jargão. */
function translate(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.';
  if (m.includes('user already registered') || m.includes('already been registered'))
    return 'Esse e-mail já tem conta. Entre em vez de criar.';
  if (m.includes('password should be at least')) return 'A senha precisa de pelo menos 6 caracteres.';
  if (m.includes('weak password')) return 'Senha fraca demais. Use algo mais longo.';
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'Este servidor não está aceitando contas novas.';
  if (m.includes('invalid email') || m.includes('unable to validate email'))
    return 'E-mail inválido.';
  /**
   * Este é o erro que aparece se a confirmação de e-mail **não** foi desligada
   * no dashboard. Sem envio configurado, nenhum e-mail chega — então a pessoa
   * ficaria com uma conta que não dá para usar e sem nenhuma pista do motivo.
   * A mensagem nomeia a causa em vez de pedir para "conferir o e-mail".
   */
  if (m.includes('email not confirmed'))
    return 'Este projeto ainda exige confirmação por e-mail, e o envio não está configurado. Desligue "Confirm email" no Supabase.';
  if (m.includes('not authorized') || m.includes('error sending'))
    return 'O servidor tentou enviar um e-mail e não conseguiu. Desligue "Confirm email" no Supabase.';
  if (m.includes('rate limit') || m.includes('too many') || m.includes('for security purposes'))
    return 'Muitas tentativas. Espere alguns minutos.';
  if (m.includes('failed to fetch')) return 'Sem conexão com o servidor de login.';
  return 'Não foi possível concluir. Tente de novo.';
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { signedIn: false, error: 'Login não configurado neste servidor.' };
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? { signedIn: false, error: translate(error.message) } : { signedIn: true };
}

/**
 * Cria a conta e entra na hora.
 *
 * Isso **depende** de "Confirm email" estar desligado no projeto: é o que faz o
 * Supabase devolver a sessão junto. Com a confirmação ligada, a resposta vem sem
 * sessão e um e-mail é disparado — que ninguém recebe, porque não há envio
 * configurado. Por isso o caso "sem sessão" não é tratado como um passo
 * seguinte, e sim como erro de configuração, com a mensagem dizendo onde
 * mexer: uma tela pedindo um código que nunca chega é o pior jeito de falhar.
 *
 * Desligar a confirmação era um furo enquanto o acesso vinha de convite
 * indexado por e-mail (quem se cadastrasse com o e-mail de outra pessoa herdava
 * o convite dela). Deixou de ser: hoje o acesso é dado pelo **ID** da conta, por
 * quem administra o mundo. O e-mail virou só identificador de login, e não
 * precisa ser verificado para nada.
 */
export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return { signedIn: false, error: 'Login não configurado neste servidor.' };
  const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
  if (error) return { signedIn: false, error: translate(error.message) };
  if (!data.session) {
    return {
      signedIn: false,
      error:
        'Conta criada, mas este projeto exige confirmação por e-mail — e o envio não está configurado. Desligue "Confirm email" no Supabase e entre de novo.',
    };
  }
  return { signedIn: true };
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut();
}
