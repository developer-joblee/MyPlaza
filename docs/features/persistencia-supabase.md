# Persistência (Supabase)

**Status:** experimental (MVP — schema aplicado à mão)
**Última atualização:** 2026-08-20 (identidade passou a vir da conta)

## O que faz

Guarda no banco o que hoje morre a cada restart do servidor: empresas, perfis,
quem tem acesso a quê, os locais, o histórico de sessões, o chat e — o que se
nota na prática — **a posição em que cada pessoa parou**. Cai a internet, dá F5,
fecha a aba: você volta no mesmo lugar do mapa, sentado na mesma cadeira.

Guarda também o que aconteceu **durante** cada conexão: em que salas fechadas a
pessoa entrou e por quanto tempo, quando compartilhou a tela, e a trilha de
auditoria da emissão de token de voz.

Sem as variáveis `SUPABASE_*` o app roda exatamente como antes, só sem
persistência — mesmo contrato de "sem `LIVEKIT_*`, sem voz".

## Como funciona

**Identidade.** O `socket.id` não serve para persistir: muda a cada reconexão (e
é a identidade da voz no LiveKit, intocável). A chave estável é o
`profiles.id`, e quem diz qual é ele é a **conta** — ver
[Autenticação e controle de acesso](autenticacao-e-acesso.md). Sem Supabase não
há conta, e a sessão roda anônima: entra normal, nada é gravado.

> O uuid anônimo de `localStorage` (`together:profileId`) que fazia esse papel
> na primeira versão **não existe mais** — quem manda o próprio id pode mandar o
> de outro, o que não sobrevive a controle de acesso.

**Local.** O jogo pensa em `scenarioId` (`studio`, `office`, …); o banco pensa
em `places.id` (uuid), que é o par empresa × cenário. `resolvePlace()` em
`server/src/db.ts` traduz um no outro e **cacheia em memória** (inclusive o
resultado negativo): não muda em runtime, e um `join` não deve pagar duas
consultas por isso. A empresa vem de `SUPABASE_ORG_SLUG`. O `places.id` é
também a **chave do mundo** e a base do nome da sala de voz — é o que isola uma
empresa da outra.

**Entrada.** O `join` é assíncrono: antes de colocar a pessoa no mundo, o
servidor autentica e autoriza (ver o doc de autenticação), resolve o perfil, lê
a posição salva e (uma vez por mundo, no primeiro join após o boot) hidrata o
histórico do chat. Tudo isso com teto de
**2,5s** (`DB_TIMEOUT_MS` em `db.ts`) — banco lento faz a pessoa entrar pelo
spawn, nunca a deixa esperando.

**Gravação.** O cliente manda posição a `TICK_RATE` (15/s). Gravar tudo seria
15 escritas por pessoa por segundo sem ganho nenhum, então `persistPosition()`
respeita `POSITION_SAVE_MS` = 3s (`shared/src/constants.ts`) — mas grava **na
hora** quando o estado muda de verdade: **entrar**, sentar, levantar, ficar
ausente, sair. (Entrar entrou nessa lista com o vínculo: quem entra e fecha a aba
sem andar precisa sair com o nome gravado — ver
[Vínculo com o mundo](vinculo-com-o-mundo.md).)
Na prática o pior caso de perda são ~3s de caminhada, e só se o processo morrer
de repente.

**Restauração.** A posição é gravada em pixels, e o mapa é editável. Antes de
usar uma posição salva, `World.validResume()` confere contra o mapa **atual**:
fora dos limites, `NaN` ou tile sólido caem no spawn normal. A exceção que
parece contradição: tile de cadeira **é** sólido (ninguém atravessa uma
cadeira), mas quem senta fica em cima dele — então sólido é aceito quando é
cadeira sentável *e* a pessoa saiu sentada.

**Atividade da sessão.** `sessions` é o hub: `zone_visits`, `screen_shares` e
`voice_token_grants` penduram nela e **não** repetem `place_id`/`profile_id` —
vêm por join. Isso mata de raiz a linha de atividade cujo local discorda da
sessão que a gerou.

- **Zonas** (sala de reunião, copa) o servidor deriva sozinho, sem evento novo:
  `audioZoneAt()` está em `shared/` e é pura, e o servidor já tem posição e
  cenário. `trackZone()` roda a cada movimento, sai na hora quando a sala não
  mudou, e só troca de sala custa escrita.
- **Tela** exigiu o único evento novo (`share`), porque a mídia vai direto do
  navegador para o LiveKit: o servidor nunca soube que alguém compartilhava.
  Ele não repassa esse evento a ninguém — quem descobre a tela de alguém
  continua sendo o LiveKit, pela faixa publicada.
- **Token de voz** já era logado no `console.log`; agora tem linha.

As duas atividades com começo e fim usam uma **corrente de promessas**
(`socket.data.zoneVisit`, `socket.data.shareRecord`) em vez de um id solto:
abrir a linha é assíncrono e quem atravessa a copa correndo troca de sala antes
de a anterior ter gravado. Sem serializar, sobrariam visitas nunca fechadas.

## Arquivos

| Arquivo | Papel |
|---|---|
| `db/migrations/0001_init.sql` | 11 tabelas, índices e gatilhos de `updated_at` |
| `db/migrations/0002_rls.sql` | RLS em tudo + funções de política (`app_is_org_member`, …) |
| `db/migrations/0003_activity.sql` | zonas, tela, auditoria de token, `sessions.user_agent` e as 3 views |
| `db/seed.sql` | catálogo (personagens/cenários) + empresa e locais de demo |
| `db/README.md` | como aplicar à mão e como conferir |
| `server/src/db.ts` | leitura/escrita das tabelas; fail-soft e com timeout |
| `server/src/supabase.ts` | conexão, teto de tempo e dedupe (compartilhado com `auth.ts`) |
| `server/src/handlers.ts` | `join` assíncrono, `persistPosition()`, sessão e chat |
| `server/src/world.ts` | `addPlayer(..., resume)`, `validResume()`, `hydrateChat()`, `zoneKeyAt()` |
| `shared/src/events.ts` | `join` ganhou o 5º parâmetro opcional `profileId`; evento `share` |
| `client/src/voice/VoiceRoom.ts` | `reportSharing()` — ponto único que mexe no `sharing` |
| `shared/src/constants.ts` | `POSITION_SAVE_MS` |
| `client/src/game/Game.ts` | no `world:snapshot`, restaura a pose de sentado do próprio player |
| `client/src/game/LocalPlayer.ts` | `resumeSitting()` |

## O modelo

```
organizations ──< memberships >── profiles ──< sessions ──< zone_visits >── audio_zones
     │                              │  │          │  ├──< screen_shares        │
     │                              │  │          │  └──< voice_token_grants   │
     ├──< invites                   │  └──< presence_state >── places          │
     └──< places ──< place_members >─┘        chat_messages >──┘                │
                └── scenarios (catálogo) ─────────────────────────────────────  ┘
                     profiles ──> characters
```

- `organizations` — a empresa. Raiz de tudo, multi-tenant desde o dia 1.
- `profiles` — a pessoa. `id` é interno do app; `auth_user_id` é o vínculo com
  a conta do Supabase Auth, hoje nulo.
- `memberships` — o N:N que responde "quais empresas essa pessoa acessa" e
  "quem tem acesso a essa empresa", com `role` e `status`.
- `invites` — cadastro por convite (token, expiração, aceite).
- `places` — o local: um cenário instanciado numa empresa. `visibility`
  distingue local aberto à empresa de local restrito.
- `place_members` — só existe para local restrito.
- `sessions` — histórico: uma linha por entrada, com `disconnect_reason`.
- `presence_state` — 1 linha por (local, perfil), sobrescrita: **onde parou** e,
  desde a `0009`, **como se chama naquele mundo** (`display_name`,
  `avatar_color`) — é o vínculo que dispensa a tela de entrada. Ver
  [Vínculo com o mundo](vinculo-com-o-mundo.md).
- `chat_messages` — o chat, com `sender_name` em snapshot.
- `characters` / `scenarios` / `audio_zones` — catálogo espelhando `shared/src/`.
- `zone_visits` — quem esteve em qual sala fechada, quando, por quanto tempo.
- `screen_shares` — começo e fim de cada compartilhamento de tela.
- `voice_token_grants` — auditoria da emissão de token (metadados, nunca o JWT).

E três views, porque toda pergunta útil sobre essas tabelas exige 4 joins:
`v_zone_occupancy` (tempo por sala e por pessoa), `v_place_activity` (sessões,
pessoas e tempo por local) e `v_screen_share_summary`.

## Decisões e por quê

**`profiles.id` não é o id do Supabase Auth.** Tentador fazer
`profiles.id references auth.users(id)`, como a maioria dos tutoriais. Não
fizemos: o id interno é nosso e estável, e `auth_user_id` é o vínculo com a
conta. Foi o que permitiu **acrescentar** login depois sem re-keyar nenhuma FK
que aponta para `profiles` — sessões, posições, mensagens, acessos.

**`socket.id` continua sendo a identidade da conexão e da voz.** O `profileId`
foi adicionado *ao lado*, não em cima. Trocar a identidade do LiveKit quebraria
o casamento 1:1 entre participantes e distâncias no mapa, que é a base da voz
por proximidade — e não há nada a ganhar com isso.

**`characters` e `scenarios` são tabelas, não CHECK constraints.** Com CHECK,
adicionar um cenário exige migration; com tabela, é um `INSERT`. A fonte de
verdade continua sendo o TypeScript (`shared/src/scenarios.ts`): o banco guarda
só o id, para poder referenciá-lo. Geometria, colisão e spawns **não** vão para
o banco — duplicar o mapa em dois lugares é garantia de divergência.

**Nenhuma política de escrita no RLS.** Só o `service_role` (servidor) escreve;
navegador, no máximo, lê o que é da empresa dele. A `anon key` vai para o
bundle por design, então o que protege o banco é o RLS, não a chave. Tabela com
RLS ligada e sem política nega tudo — é o default seguro, e `invites` fica
assim de propósito: quem lê a linha lê o `token` e entra na empresa.

**`app_is_org_member` é `security definer`.** Obrigatório: a função lê
`memberships`, e `memberships` tem política que chama a função. Sem `definer`
isso é recursão de RLS e o Postgres aborta a query.

**Posição em pixels, e não em tile.** Tile perderia a posição dentro da célula
e o avatar "pularia" ao voltar. O preço é o acoplamento com o mapa, pago por
`validResume()`.

**`away` não é restaurado.** É gravado (serve para relatório), mas voltar de
uma queda de internet aparecendo ausente para todo mundo é pior que o
contrário. Quem estava ausente de propósito tem o próprio cliente reafirmando
isso no `connect` (`GameView.tsx`).

**Migrations neste repo, não em repo separado.** A pergunta foi levantada e a
resposta é não: uma coluna nova e o tipo em `shared/` que depende dela precisam
viajar no mesmo commit. Repo separado torna a revisão não-atômica e deixa
schema e código divergirem sem ninguém ver. O caso que justificaria separar é
vários serviços independentes dividindo o mesmo banco — aqui só o `server/`
fala com ele. Se isso mudar, extrai-se depois; o inverso (juntar) é mais caro.

**Numeração desde já no formato do Supabase CLI.** Aplicar à mão hoje e migrar
para `supabase db push` depois deve ser um `mv`, não um rewrite.

**Zonas derivadas no servidor, não enviadas pelo cliente.** Seria mais simples
mandar um evento `zone` quando o cliente muda de sala. Não fizemos: `audioZoneAt`
já está em `shared/` e o servidor já tem posição e cenário, então derivar custa
zero no protocolo **e** impede que cliente e servidor discordem sobre onde a
sala começa. Um cliente adulterado também não escolhe em que sala consta.

**Nada de `place_id` nas tabelas de atividade.** `zone_visits`, `screen_shares` e
`voice_token_grants` só têm `session_id`; local e pessoa vêm por join. Duplicar
seria mais rápido de consultar e abriria a porta para a linha de atividade cujo
`place_id` discorda da sessão que a gerou. As views pagam o join uma vez.

**O retângulo da zona não vai para o banco.** `audio_zones` guarda id e rótulo;
a geometria fica no ASCII de `shared/src/scenarios.ts`. Ter o `rect` nos dois
lugares seria ter duas verdades sobre onde a sala fica.

**`security_invoker = true` nas views.** É a pegadinha do Postgres: por padrão a
view roda com os direitos do dono e **fura o RLS** das tabelas de baixo — a view
viraria o buraco por onde a anon key leria a empresa toda. Com invoker, o RLS de
quem consulta continua valendo.

**Recusa por limite de taxa não é auditada.** `voice_token_grants` registra
`granted`/`cached`/`error`, não `rate-limited`: recusa é barata para quem tenta e
gravá-la viraria amplificação de escrita (spam no `voice:token` gerando INSERT).
O limitador já barra e o log de linha continua lá.

**O evento `share` não é repassado a ninguém.** Só o servidor consome, para
registrar. Quem descobre a tela de alguém continua sendo o LiveKit, pela faixa
publicada — transmitir também pelo Socket.IO criaria uma segunda fonte de
verdade sobre quem está compartilhando.

**Fail-soft em tudo.** Toda função de `db.ts` engole erro, respeita timeout e
devolve um fallback. Persistência é um plus; não pode impedir alguém de entrar
no escritório virtual porque o Supabase piscou.

## Armadilhas

- **`db/seed.sql` não é opcional.** Sem as linhas de `characters` e
  `scenarios`, os FKs de `profiles`, `places`, `sessions` e `presence_state`
  não fecham e **toda** escrita falha (silenciosamente, por causa do
  fail-soft — olhe o log `[db]`).
- **`SUPABASE_ORG_SLUG` tem que casar com o slug do seed.** Se não casar, o
  log avisa `empresa "x" não existe` e a sessão roda sem persistência.
- **`service_role` passa por cima do RLS.** Ela vive só no servidor. Nunca em
  variável `VITE_*` — isso vai para o bundle do navegador.
- **Adicionou personagem ou cenário no `shared/`?** Adicione a linha
  correspondente em `db/seed.sql` e rode. Senão o FK quebra na primeira pessoa
  que escolher a novidade.
- **`NAME_MAX_LENGTH` (20) está duplicado como CHECK em `profiles`.** Mudar o
  constante no `shared/` exige migration; se não fizer, o upsert do perfil
  passa a falhar para nomes longos.
- **`join` é assíncrono.** A trava contra join duplo é `socket.data.joining`,
  não só `worldKey` — que só é setado depois dos awaits. E se o socket cair
  durante a espera, o handler sai sem adicionar ninguém ao mundo (senão sobra
  player fantasma, porque o `disconnect` já rodou e não achou nada).
- **Histórico do chat sai sem cor.** `senderId` do banco é o `profile_id`, e o
  roster do cliente é indexado por `socket.id` — então mensagem antiga cai na
  cor padrão. Consertar exigiria expor `profileId` no roster; ficou fora do MVP.
- **Editar migration já aplicada faz o banco divergir do repo.** Crie o próximo
  número.
- **Adicionou `audioZones` num cenário?** Precisa da linha em `audio_zones`
  (`db/seed.sql`), senão a visita de sala é descartada com um aviso no log.
- **View sem `security_invoker` fura o RLS.** Se criar view nova, repita a
  cláusula — e confira com a query do `db/README.md`.
- **`share` só é registrado depois de a sessão existir.** `openSession` é
  assíncrono; um compartilhamento iniciado nos primeiros ~100ms depois do join
  não gera linha. Aceito: é histórico, não estado.
- **`reportSharing()` é o único lugar que mexe em `sharing`.** Chamar
  `store.setSharing()` direto volta a deixar o servidor sem saber — e há quatro
  caminhos que desligam o compartilhamento.

## Como testar

**Sem banco** (é o caminho que já está verificado):

```bash
npm run typecheck            # server + client
npm start -w server &        # deve logar "[db] ... ausentes — persistência desativada"
npx tsx smoke-test.mts       # 14 checagens do protocolo, nenhuma deve quebrar
```

**Com banco:**

1. Aplique `db/migrations/0001_init.sql`, `0002_rls.sql` e `seed.sql` (ver
   `db/README.md`).
2. Preencha `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` e `SUPABASE_ORG_SLUG`
   no `.env` da raiz. O boot deve logar `[db] Supabase configurado`.
3. `npm run dev`, entre, ande até um canto, **sente numa cadeira**, dê F5.
   Você deve voltar sentado no mesmo lugar (log `[join] ... (posição
   restaurada)`).
4. Confira as linhas: `select * from presence_state;` e
   `select socket_id, joined_at, left_at, disconnect_reason from sessions;`.
5. Mande uma mensagem no chat, reinicie o servidor, entre de novo: o histórico
   tem que voltar.
6. Abra em outro navegador (`localStorage` diferente = outro perfil) e confirme
   que são duas linhas em `presence_state`, não uma.
7. Entre na sala de reunião do Estúdio, fique um pouco, saia e vá para a copa.
   `select * from v_zone_occupancy;` tem que mostrar duas visitas com duração.
8. Compartilhe a tela e pare. `select * from v_screen_share_summary;` conta 1.
9. `select outcome, count(*) from voice_token_grants group by 1;` — e confirme
   que **não existe** coluna com o token.

## Não verificado

Espelhado em `PENDENTES.md`:

- **Nada foi rodado contra um Supabase real** — não há credenciais neste
  ambiente. O SQL nunca foi executado, então erro de sintaxe/ordem só aparece
  na primeira aplicação. O caminho sem banco está testado.
- RLS nunca foi exercitado (depende de login, que não existe ainda).
- `invites` e `place_members` têm schema, mas **nenhum código** os usa.
- Locais restritos (`visibility = 'restricted'`) não são respeitados pelo
  servidor: hoje o mundo é por cenário, não por local.
- As 3 views desta migration nunca foram executadas. `security_invoker` só é exercitado com
  login, que não existe ainda.
- `zone_visits` e `screen_shares` foram testados só no caminho sem banco
  (travessia das duas zonas do Estúdio e `share` repetido não derrubam o
  servidor). A corrente de promessas nunca foi observada gravando de verdade.

## Relacionado

- [Autenticação e controle de acesso](autenticacao-e-acesso.md) — quem é a
  pessoa, quem pode entrar e quantos cabem
- [`db/README.md`](../../db/README.md) — como aplicar o schema
- README: seção [Deploy](../../README.md#deploy-railway) (variáveis de ambiente)
