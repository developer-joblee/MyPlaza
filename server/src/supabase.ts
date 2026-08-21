import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Conexão e infraestrutura do Supabase, num só lugar.
 *
 * Existe separado de `db.ts` porque há DOIS consumidores — as tabelas (`db.ts`)
 * e a verificação de login (`auth.ts`) — e dois `createClient` significariam
 * dois pools e duas cópias da regra de timeout.
 *
 * Regras que valem para todo mundo que importa daqui:
 *
 * 1. **Fail-soft.** Sem `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, ou com o
 *    banco fora do ar, toda operação vira no-op — mesmo contrato do `voice.ts`
 *    (sem LiveKit, sem voz; o resto funciona).
 * 2. **Nada de segredo em log.** Loga presença de configuração e id de linha,
 *    nunca a service key, nunca um JWT, nunca o `token` de um convite.
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
/** slug da empresa deste deploy — precisa existir (ver `db/seed.sql`) */
export const ORG_SLUG = process.env.SUPABASE_ORG_SLUG ?? 'demo';

export const dbConfigured = Boolean(SUPABASE_URL && SERVICE_ROLE_KEY);

/**
 * Teto de espera por consulta. O `join` espera pelo banco para autenticar e
 * saber onde a pessoa parou; sem teto, um Supabase lento seguraria a entrada no
 * mundo por tempo indefinido.
 */
const DB_TIMEOUT_MS = 2500;

export const client: SupabaseClient | null =
  SUPABASE_URL && SERVICE_ROLE_KEY
    ? createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
        // o service_role não tem sessão de usuário para guardar nem renovar
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

/**
 * Confere a FORMA de `SUPABASE_URL` no boot, e devolve o que está errado.
 *
 * Isto existe por uma sessão de depuração inteira: uma URL definida mas apontando
 * para um site (o painel do Supabase, por exemplo) devolve **HTML**, e o
 * supabase-js falha com "Unexpected token '<', \"<!DOCTYPE\"... is not valid
 * JSON" — mensagem que não diz em lugar nenhum que o problema é a variável. Um
 * aviso de uma linha no boot economiza isso.
 *
 * Nunca imprime a key nem o ref do projeto: só a forma, com o ref redigido.
 */
function urlShapeProblem(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'não é uma URL válida — falta o "https://"?';
  }
  if (u.pathname !== '/' && u.pathname !== '') {
    return `tem caminho ("${u.pathname}") — o valor deve ser só o host do projeto, sem caminho`;
  }
  const host = u.hostname;
  const isCloud = /\.supabase\.(co|in)$/.test(host);
  const isLocal = host === '127.0.0.1' || host === 'localhost';
  if (!isCloud && !isLocal) {
    // o ref é redigido; o que interessa é o domínio, que é justamente o erro
    return `host "${host.replace(/^[a-z0-9]{16,}\./i, '<ref>.')}" não parece o endpoint de um projeto (esperado "<ref>.supabase.co"). O endereço do PAINEL não serve`;
  }
  return null;
}

// log único no boot — nunca a URL completa com chave, nunca a key
console.log(
  dbConfigured
    ? `[db] Supabase configurado (empresa "${ORG_SLUG}") — login obrigatório`
    : '[db] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes — persistência e login desativados (o resto do app funciona)',
);

if (SUPABASE_URL) {
  const problem = urlShapeProblem(SUPABASE_URL);
  if (problem) {
    console.error(`[db] ATENÇÃO: SUPABASE_URL ${problem}.`);
    console.error(
      '[db] Nada de login vai funcionar assim. Lembre que o `--env-file` do Node NÃO ' +
        'sobrepõe variável já exportada no shell — se o .env parece certo, confira o shell ' +
        'com: printenv SUPABASE_URL',
    );
  }
}

const TIMED_OUT = Symbol('db-timeout');

/**
 * Executa uma operação com teto de tempo e sem nunca lançar: erro de banco não
 * pode derrubar um handler de socket. Devolve `fallback` em qualquer falha.
 */
export async function guard<T>(label: string, op: () => PromiseLike<T>, fallback: T): Promise<T> {
  if (!client) return fallback;
  try {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), DB_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([op(), timeout]);
      if (result === TIMED_OUT) {
        console.warn(`[db] ${label}: timeout (${DB_TIMEOUT_MS}ms) — seguindo sem banco`);
        return fallback;
      }
      return result;
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    console.error(`[db] ${label}:`, err instanceof Error ? err.message : err);
    return fallback;
  }
}

const inFlight = new Map<string, Promise<unknown>>();

/**
 * Deduplica trabalho concorrente pela chave: dez pessoas entrando juntas não
 * disparam dez vezes a mesma busca de catálogo.
 */
export function dedupe<T>(key: string, work: () => Promise<T>): Promise<T> {
  const running = inFlight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = work().finally(() => inFlight.delete(key));
  inFlight.set(key, p);
  return p;
}

/**
 * Sonda de sanidade no boot: uma consulta trivial que só existe para o servidor
 * gritar cedo o que hoje ele só descobre quando alguém tenta entrar.
 *
 * Os dois erros que valem tratamento próprio já custaram tempo de depuração:
 *
 * - **42501** (`permission denied`): o `service_role` não tem privilégio nas
 *   tabelas. Ignorar RLS (`BYPASSRLS`) **não** dispensa privilégio de tabela — são
 *   controles distintos. Corrige-se com `0008_grants.sql`.
 * - **42P01** (`undefined_table`): o schema não foi aplicado.
 *
 * `head: true` faz um HEAD: nada de dados, nenhuma linha lida. Fire-and-forget,
 * sem bloquear o boot — se o Supabase estiver lento, o servidor sobe igual e o
 * resto do app (que não depende de banco) continua funcionando.
 */
if (client) {
  // IIFE, e não `.then().catch()`: o builder do supabase-js é um `PromiseLike`,
  // não uma Promise — ele não tem `.catch`, e sem o try/catch uma falha de rede
  // aqui viraria unhandled rejection.
  void (async () => {
    try {
      const { error } = await client.from('profiles').select('id', { head: true, count: 'exact' });
      if (!error) {
        /**
         * Privilégio ok. Falta a outra causa de "ninguém entra": o catálogo
         * vazio. `profiles.character_id` tem FK para `characters` (e default
         * `'adam'`), então sem o catálogo TODO insert de perfil morre com
         * `23503 foreign key violation` — mensagem que fala de constraint, não
         * de seed.
         *
         * Vale um aviso próprio porque a pegadinha é traiçoeira: o SQL Editor do
         * Supabase roda o script numa transação só, então um único statement com
         * erro faz rollback do seed INTEIRO — o catálogo fica vazio mesmo para
         * quem "rodou o seed".
         */
        const { count, error: catErr } = await client
          .from('characters')
          .select('id', { head: true, count: 'exact' });
        if (catErr) {
          console.warn(`[db] não deu para conferir o catálogo: ${catErr.message}`);
        } else if (!count) {
          console.error('[db] ATENÇÃO: a tabela `characters` está VAZIA.');
          console.error(
            '[db] Rode db/seed.sql. Sem o catálogo, criar perfil falha com 23503 ' +
              '(foreign key) e ninguém entra. Lembre: no SQL Editor o script é uma ' +
              'transação — um erro em qualquer linha desfaz o seed todo.',
          );
        }
        return;
      }
      if (error.code === '42501') {
        console.error(`[db] ATENÇÃO: ${error.message} (42501).`);
        console.error(
          '[db] O service_role não tem privilégio nas tabelas. Aplique ' +
            'db/migrations/0008_grants.sql — sem isso NINGUÉM consegue entrar.',
        );
      } else if (error.code === '42P01') {
        console.error(`[db] ATENÇÃO: ${error.message} (42P01).`);
        console.error('[db] O schema não foi aplicado. Ver db/README.md.');
      } else {
        console.warn(`[db] sonda inicial falhou (${error.code ?? 'sem código'}): ${error.message}`);
      }
    } catch (err) {
      console.warn('[db] sonda inicial não completou:', err instanceof Error ? err.message : err);
    }
  })();
}
