# Vínculo com o mundo (o nome fica guardado)

**Status:** em uso — **funcionando contra um Supabase real desde 2026-08-20**,
com a migração `0009` aplicada. **A migração
[`0009_world_binding.sql`](../../db/migrations/0009_world_binding.sql) é
obrigatória** (ver a primeira armadilha: sem ela, a posição também para de ser
salva).
**Última atualização:** 2026-08-20

## O que faz

Na **primeira** vez que você entra num mundo, a tela de entrada pergunta nome,
personagem e cor. Da segunda em diante, **Entrar** no lobby vai direto para o
jogo — mesmo depois de sair da conta, dar F5 ou abrir em outro navegador. O nome
é **por mundo**: você pode ser "Iago" no mundo do time e "Iago (Joblee)" no
mundo de um cliente.

Para trocar nome, cor ou personagem num mundo, o botão **Editar** ao lado de
"Entrar". O nome que vai ser usado aparece na linha do mundo no lobby
(`· como Iago`), porque com o vínculo o "Entrar" deixa de perguntar — e entrar
com um nome que não está à vista seria uma surpresa.

## Como funciona

O vínculo é a linha de **`presence_state`** — uma por `(place_id, profile_id)`,
que já existia para guardar *onde a pessoa parou* e já guardava `character_id`.
A migração `0009` acrescenta `display_name` e `avatar_color` **na mesma linha**:
não há tabela nova, nem escrita nova, nem evento novo no protocolo.

```
lobby:list ──> listWorldsFor()  ──1 consulta──> presence_state do meu perfil
                    │
                    └─> WorldSummary.binding: { name, color, character } | null
                                     │
                    null ────────────┴──────────── existe
                      │                              │
            tela de entrada                  entra DIRETO no jogo
       (prefill: LobbyState.me,               (chooseWorld -> phase 'playing')
        a última aparência usada)                     │
                      └──────────── join ────────────┘
                                     │
                    persistPosition(true) grava o vínculo em presence_state
```

- **Escrita** — `savePosition()` (`server/src/db.ts`) passou a gravar nome e cor
  junto com posição/personagem. Quem chama é `persistPosition()` em
  `handlers.ts`, que agora roda **na entrada** (logo após o `addPlayer`), e não
  só no primeiro passo: quem entra e fecha a aba sem andar precisa sair com o
  vínculo gravado. Depois disso, o ritmo é o de sempre — `POSITION_SAVE_MS` = 3s,
  e forçado ao sentar, ausentar-se e sair.
- **Leitura** — `listWorldsFor()` ganhou **uma** consulta
  (`presence_state where profile_id = eu and display_name is not null`), servida
  pelo índice `presence_state_profile_idx` que já existe desde a `0001`. O
  resultado vira `WorldSummary.binding`.
- **Prefill** — `LobbyState.me` traz a última aparência do `profiles`, para a
  tela de entrada de um mundo **sem** vínculo não nascer com o campo vazio.
  `ensureProfile()` devolve isso junto com o id, sem consulta a mais (o `select`
  já existia, só ganhou colunas).
- **A decisão da fase** é uma linha só, em `client/src/state/store.ts`:
  `chooseWorld()` vai para `phase: 'playing'` quando há `binding`, e para
  `phase: 'join'` quando não há (ou quando o clique foi em "Editar").

## Arquivos

| Arquivo | Papel |
|---|---|
| `db/migrations/0009_world_binding.sql` | `presence_state` ganha `display_name` e `avatar_color` (nullable) |
| `shared/src/types.ts` | `WorldBinding`; `WorldSummary.binding`; `LobbyState.me` |
| `server/src/db.ts` | `savePosition()` grava o vínculo; `listWorldsFor()` lê; `ensureProfile()` devolve `ProfileRef` |
| `server/src/lobby.ts` | `LobbyIdentity.appearance` e o `me` do estado do lobby |
| `server/src/handlers.ts` | `persistPosition(true)` na entrada; nome e cor saem do `player` |
| `client/src/state/store.ts` | `chooseWorld(world, opts?)` — entra direto ou pergunta; `setLobby` guarda o prefill |
| `client/src/ui/LobbyScreen.tsx` | botão **Editar**, e o `· como <nome>` na linha do mundo |
| `client/src/ui/JoinScreen.tsx` | **não mudou** — já lia o prefill do store |

## Decisões e por quê

**`presence_state`, e não uma tabela nova.** A tabela já era exatamente "uma
linha por (local, perfil)" — o vínculo que se queria —, já era escrita a cada
entrada e saída pela mesma função, e já guardava `character_id`, que é aparência
e não posição. Uma tabela `world_bindings` ao lado seria uma segunda escrita por
join, um segundo lugar para o dado divergir, e uma migração maior. O custo da
escolha é o nome da tabela ficar estreito para o que ela guarda; o comentário na
`0009` existe para quem estranhar.

**Não é `place_members`.** Era a candidata óbvia ("o vínculo com o mundo") e está
errada: aquela tabela é a **lista de acesso** de mundo restrito. Criar linha lá a
cada entrada faria com que todo mundo que já passou por um mundo aberto à empresa
continuasse dentro no dia em que o dono o tornasse restrito — um vazamento de
acesso disfarçado de conveniência. *Vínculo* (já estive aqui, e me chamo assim) e
*acesso* (posso entrar) são coisas diferentes de propósito, e esta feature não
toca em `place_members` nem em `memberships`.

**As colunas são nullable, sem default.** Linha que já existe (de quem entrou
antes da `0009`) não tem nome, e `null` é a resposta certa: "não sei como essa
pessoa se chama neste mundo". Um default artificial (`'Anônimo'`) faria o app
deixar de perguntar e entrar com o nome errado — perguntar uma vez é melhor.
`listWorldsFor` filtra por `display_name is not null` justamente por isso.

**O nome é por mundo; `profiles.display_name` virou "o último usado".** O `join`
continua sobrescrevendo o perfil, e esse valor deixou de ser identidade para ser
**prefill** de um mundo onde ainda não há vínculo. É o que faz a primeira entrada
num mundo novo já vir com o nome digitado, em vez de campo vazio. A alternativa
(nome único por conta, sem migração) foi descartada por duas razões: não deixaria
usar nomes diferentes em mundos diferentes, e — pior — não haveria como
distinguir "já escolheu um nome" de "nunca escolheu", porque `ensureProfile` cria
o perfil com o nome tirado do e-mail. Com o vínculo, a ausência da linha responde
essa pergunta de graça.

**Quem diz que existe vínculo é o servidor.** O `binding` vem do banco, no
`lobby:list`. Se fosse o cliente afirmando "já tenho nome aqui" (localStorage,
por exemplo), daria para pular a pergunta com nome vazio ou com o nome de outra
pessoa — e a identidade deste app deixou de vir do cliente de propósito (ver
[Autenticação e controle de acesso](autenticacao-e-acesso.md)).

**"Editar" entra no mundo.** O vínculo só é gravado no `join`, então uma tela de
edição que não entrasse não gravaria nada — ou exigiria um evento novo só para
isso. Botão "Entrar" na tela de entrada, e o que foi digitado vale a partir dessa
entrada. É também por isso que "Editar" só aparece havendo vínculo: sem ele a
tela já aparece sozinha, e o botão prometeria editar algo que não existe.

**O nome aparece na linha do mundo.** Sem o `· como Iago`, o "Entrar" passaria a
usar um nome que a pessoa não vê em lugar nenhum — a economia de um clique não
vale uma identidade invisível.

**Grava na entrada, não no primeiro passo.** `persistPosition(true)` logo depois
do `addPlayer` custa um upsert por join (que ia acontecer 3s depois de qualquer
jeito) e fecha o caso "entrei, olhei, fechei a aba": sem ele essa pessoa sairia
sem vínculo e o mundo perguntaria o nome de novo — exatamente o que a feature
existe para não fazer.

**Nenhum evento novo no Socket.IO.** O `binding` viaja no `lobby:list`, que já
devolvia o estado inteiro do lobby, e o `join` continua com a mesma assinatura.
Um `world:binding` dedicado seria uma ida à rede a mais entre o lobby e o jogo,
justo no caminho que a feature quer encurtar.

**Modo anônimo (sem Supabase) ficou de fora.** Ali não há conta, não há logout e
não há banco — guardar o nome em `localStorage` seria uma segunda fonte de
identidade, e a primeira coisa que a chegada do Auth removeu deste repo foi
justamente um id de `localStorage` (ver o doc de autenticação). O modo anônimo
continua perguntando a cada carga da página, por escolha.

**`ensureProfile` devolve um objeto, não um `string`.** Mudança pequena com um
efeito colateral bom: `lobby:create` parou de picar o e-mail para nomear a
empresa pessoal e passou a usar o nome real da pessoa — o mesmo valor quando ela
nunca escolheu nada, e o nome de verdade quando escolheu.

## Armadilhas

- **Sem a migração `0009`, a posição também para de ser salva.** `savePosition`
  passou a mandar `display_name`/`avatar_color` no upsert; contra um banco sem
  essas colunas o Postgres recusa a escrita **inteira** (`42703 column ... does
  not exist`). Como todo `db.ts` é fail-soft, isso não derruba nada: só aparece
  como `[db] savePosition` no log, ninguém volta onde parou, e nenhum vínculo
  nunca é criado — a tela de entrada pergunta o nome para sempre. Se o sintoma
  for "a feature não funciona **e** perdi a posição salva", é esta migração.
- **Linha antiga conta como sem vínculo.** Quem já entrava antes da `0009` tem
  `display_name` nulo e vai ser perguntado **uma** vez; a partir daí o vínculo
  existe. Não é bug, é o `null` fazendo o trabalho dele.
- **Editar sem entrar não grava.** Abrir "Editar", trocar o nome e voltar ao
  lobby deixa tudo como estava — o vínculo é escrito no `join`.
- **O vínculo sobrevive à perda de acesso.** Tirar alguém do mundo (ou arquivá-lo)
  não apaga a linha de `presence_state`; se o acesso voltar, o nome ainda está
  lá. É de propósito: `removeMember` tira acesso, não memória. Quem quiser
  esquecer de verdade apaga a linha à mão.
- **Entrar num mundo aberto à empresa continua não dando acesso permanente.** O
  vínculo não é `place_members`. Se alguém "unificar" as duas coisas para
  simplificar, o mundo que virar restrito amanhã já vem com todos os visitantes
  de ontem dentro.
- **`NAME_MAX_LENGTH` (20) agora está duplicado como CHECK em dois lugares** —
  `profiles` (desde a `0001`) e `presence_state` (`0009`). Mudar a constante em
  `shared/src/constants.ts` exige migração nas duas, senão o upsert passa a
  falhar (fail-soft, silencioso) para nomes longos.
- **`LobbyState.me` é cacheado por socket do lobby.** É seguro hoje porque mudar
  de aparência exige entrar num mundo, e entrar num mundo fecha o socket do
  lobby. Se algum dia o lobby ganhar um socket persistente, esse valor
  envelhece.
- **Se `chooseWorld` voltar a ir sempre para `phase: 'join'`, a feature morre em
  silêncio.** Nada quebra, nada avisa — só volta a perguntar o nome. É a única
  linha que decide entre entrar direto e perguntar.
- **O histórico do chat continua com o nome do momento do envio**
  (`chat_messages.sender_name`, snapshot). Trocar de nome num mundo não reescreve
  o que você já disse — e isso é intencional, não uma inconsistência.

## Como testar

Precisa de Supabase configurado (é o único modo com conta e logout) e da
migração `0009` aplicada — `db/README.md`, passo 9.

1. **Aplique a `0009`** no SQL Editor. Confira:
   `select column_name from information_schema.columns where table_name = 'presence_state';`
   — tem que listar `display_name` e `avatar_color`.
2. `npm run dev`, entre com sua conta, crie (ou abra) um mundo. A tela de entrada
   **aparece**, com o nome já preenchido pelo perfil. Escolha um nome diferente
   ("Teste 1"), entre.
3. Volte ao lobby. A linha do mundo tem que mostrar **`· como Teste 1`**, e um
   botão **Editar** ao lado de "Entrar".
4. **O teste da feature:** *Sair da conta* → entre de novo → clique **Entrar**
   nesse mundo. Tem que cair **direto no jogo**, com o nome "Teste 1", sem tela
   de entrada. F5 no meio, ou outro navegador, tem que dar o mesmo.
5. No banco:
   `select display_name, avatar_color, character_id from presence_state;` — uma
   linha por (mundo, pessoa), com o nome escolhido.
6. **Editar**: botão Editar → troque para "Teste 2" e uma cor → Entrar. Voltando
   ao lobby, a linha mostra `· como Teste 2`.
7. **Nome por mundo**: crie um segundo mundo. Ele **não** tem vínculo, então a
   tela de entrada aparece — preenchida com "Teste 2" (o prefill do perfil).
   Entre com "Outro nome" e confirme que o primeiro mundo continua "Teste 2".
8. **Recusa não vira loop**: `update places set capacity = 0 where id = '<o
   mundo>';` e clique Entrar. Tem que cair na tela de entrada com "este local
   está cheio", não numa tentativa infinita. (Desfaça a lotação depois.)
9. **Sem a migração** (se quiser ver a armadilha): o log do servidor mostra
   `[db] savePosition` com `42703` e nenhum vínculo é criado.

Sem Supabase (`npm run dev` sem as variáveis), o app segue anônimo e a tela de
entrada aparece sempre — verificado com o `smoke-test.mts` (14 checagens).

## Verificado

- **Contra um Supabase real, no navegador (2026-08-20):** a `0009` aplicada, o
  vínculo sendo gravado na entrada e lido no lobby, e o **caminho que a feature
  existe para resolver** — sair da conta, entrar de novo, clicar Entrar e cair
  direto no jogo com o nome guardado, sem tela de entrada. É o que confirma de
  uma vez as três escritas/leituras novas: `savePosition` com as colunas da
  `0009`, a consulta de vínculo em `listWorldsFor` e o `ensureProfile` devolvendo
  aparência.
- Sem banco: `npm run typecheck` limpo, `npm run build` do client, o
  `smoke-test.mts` inteiro (14/14, modo anônimo em :3099) e um teste headless do
  `store` cobrindo as seis transições de fase (com vínculo, sem vínculo, editar,
  recusa, prefill, sair) — os scripts rodaram da raiz e não ficaram no repo.

## Não verificado

Espelhado em `PENDENTES.md`. O caminho principal está confirmado; o que sobrou
são os cantos, e nenhum deles bloqueia o uso:

- **Nome diferente em mundos diferentes.** É o que justifica o vínculo ser por
  mundo, e não por conta, e não foi provocado com dois mundos de verdade (passo 7
  do roteiro).
- **O botão Editar** e a gravação do nome trocado (passo 6).
- **Linha antiga de `presence_state`** (de antes da `0009`, com `display_name`
  nulo) sendo perguntada **uma** vez: o filtro `not display_name is null` nunca
  rodou contra uma linha dessas.
- **Recusa na entrada direta** (`place-full` / `place-restricted` caindo na tela
  de entrada com o motivo): provado no teste headless do store, nunca no
  navegador.
- A consulta a mais em `listWorldsFor` nunca foi medida com muitos mundos (a
  função já fazia 4 e filtrava em JS; agora são 5).

## Relacionado

- [Persistência (Supabase)](persistencia-supabase.md) — `presence_state`, a
  posição salva e o resto do que é gravado
- [Autenticação e controle de acesso](autenticacao-e-acesso.md) — de onde vem a
  identidade, e por que ela não vem do cliente
- [Lobby](lobby.md) — a tela que passou a decidir entre entrar e perguntar
- [`db/README.md`](../../db/README.md) — aplicar a `0009`
