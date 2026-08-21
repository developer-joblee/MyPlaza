# Lobby (criar mundos e convidar)

**Status:** experimental (MVP — schema aplicado à mão)
**Última atualização:** 2026-08-20 (papéis e troca de dono)

## O que faz

Depois do login, a primeira tela é o **lobby**: a lista dos mundos em que você
pode entrar, **o seu ID**, e o botão de **criar um mundo**. Quem cria um mundo é o
dono dele e dá acesso a outras pessoas **pelo ID delas** — a pessoa copia o ID no
próprio lobby e passa para quem administra, que cola no campo do mundo. Não há
passo de aceite: ter um ID significa já ter conta.

> **Mudou em 2026-08-20.** Antes era convite por **e-mail**, com aceite no
> lobby. O mecanismo continua no código, **dormente**, e volta quando houver
> domínio para enviar e-mail — ele é a única forma de alcançar quem ainda não tem
> conta. O porquê da troca (e por que ela é o que permite desligar a confirmação
> de e-mail) está em
> [Autenticação e controle de acesso](autenticacao-e-acesso.md).

O dono também **gerencia** o mundo pelo painel "Gerenciar": renomear, mudar
lotação, alternar entre "só quem eu adicionar" e "toda a empresa", ver quem tem
acesso e **tirar** alguém, **definir papéis**, **passar a propriedade** para outro
membro, e **arquivar** o mundo.

### Papéis num mundo

| Papel | Pode |
|---|---|
| **owner** (`places.created_by`) | tudo, incluindo arquivar e passar a propriedade |
| **host** (`place_members.role`) | convidar, editar o mundo, tirar membro, promover/rebaixar membro |
| **member** | entrar |

`owner` **não** é um valor de `place_members.role`: ele vem de `created_by`.
Isso é de propósito — se a propriedade morasse no papel, daria para perdê-la
numa edição de papel. Para trocar de dono existe uma operação própria.

Em uma frase: entrar num mundo passa a ser "basta ser convidado ou convidar".

Fluxo completo: `login` → **`lobby`** (escolher/criar mundo) → `join` (nome,
personagem, cor) → jogo. Sem Supabase configurado o lobby não existe e o app
segue anônimo, direto na tela de entrada.

## Como funciona

**Mundo = `places`**, com `created_by` (o dono). A empresa continua sendo a raiz
de todo acesso; quem cria um mundo sem pertencer a nenhuma empresa ganha uma
**empresa pessoal** (`is_personal`), invisível no lobby.

**Mundo novo nasce `restricted`** e com o dono já em `place_members`. Quem cria
decide quem entra — abrir para a empresa inteira sem pedir seria uma surpresa
desagradável em empresa com muita gente.

**Dar acesso são duas escritas, nesta ordem:** membership na empresa →
`place_members`. Sem transação, e a ordem é de propósito: caindo no meio, a
pessoa fica com acesso à empresa e sem acesso ao mundo, o que se resolve
repetindo a operação; o contrário deixaria linha órfã em `place_members`
apontando para quem não é membro. `addMemberToWorld` também **lê antes de
escrever** em `memberships`, para não rebaixar `owner`/`admin` a `guest` — o caso
fácil de provocar é o dono colar o próprio ID.

**Convite carrega `place_id`** (dormente). `invites` já existia por empresa e
ganhou a coluna do mundo. O aceite fazia **três** escritas: membership →
`place_members` → marca aceito, nessa ordem para que cair no meio deixasse o
convite pendente. Continua no código, sem ninguém criando linha nova.

**Transporte: Socket.IO, com socket próprio do lobby.** A tela não fala com o
socket: chama `net/lobbyApi.ts`, que devolve `Promise<LobbyResult>` e nunca
lança. Doze eventos, todos por ack e todos devolvendo o **estado inteiro** em
caso de sucesso — os de
gerenciamento devolvem também o `detail` do mundo, porque mudam as duas coisas
ao mesmo tempo:

| Evento | O que faz | Quem pode |
|---|---|---|
| `lobby:list` | meus mundos + meus convites + **o meu ID** | logado |
| `lobby:create` | cria mundo (restrito, dono = eu) | logado |
| `lobby:addMember` | dá acesso ao mundo pelo **ID** da pessoa | dono ou host |
| `lobby:accept` / `lobby:decline` | aceita / recusa convite meu — **dormente** | convidado |
| `lobby:world` | painel: membros + convites enviados | dono ou host |
| `lobby:update` | nome, lotação, visibilidade | dono ou host |
| `lobby:removeMember` | tira o acesso de alguém | dono ou host |
| `lobby:revokeInvite` | cancela convite pendente — **dormente** | dono ou host |
| `lobby:setMemberRole` | promove/rebaixa entre host e member | dono ou host |
| `lobby:archive` | arquiva o mundo | **só dono** |
| `lobby:transferOwner` | passa a propriedade a outro membro | **só dono** |

**"Remover" é arquivar.** `places.archived_at` — nunca `delete`. Cinco tabelas
referenciam `places` com `on delete cascade` (`place_members`, `sessions`,
`presence_state`, `chat_messages`, `invites`): apagar o mundo levaria embora todo
o chat e toda a presença dele, sem volta. Arquivar faz o que a tela promete (sai
do lobby, ninguém entra) e desfaz com um `update`.

**Perder acesso desconecta na hora.** Arquivar um mundo, ou tirar um membro,
chama `ejectFrom()`: os sockets daquele mundo (ou o daquele perfil) são
desconectados. **Não** existe evento de "você foi expulso" — o cliente reconecta
sozinho, refaz o `join`, e o **portão** recusa com o motivo certo
(`place-restricted` ou `no-place`). Reusar o portão é melhor que um caminho
paralelo que poderia discordar dele.

**O `join` mudou de novo**: agora leva `worldId`. O servidor **não deriva mais o
local a partir do cenário** — com mundos criados por gente, o mesmo cenário
existe muitas vezes. E o **mapa vem do mundo**, não do pedido: sem isso daria
para entrar num mundo do Estúdio carregando a colisão da Praça.

**A contagem de "quem está dentro"** (`worldOnlineCount`) sai da memória do
processo, não de `sessions` no banco: sessão que não fechou por queda de conexão
contaria gente que já saiu, e o mundo apareceria cheio e vazio ao mesmo tempo.

## Arquivos

| Arquivo | Papel |
|---|---|
| `db/migrations/0005_lobby.sql` | `places.created_by`, empresa pessoal, `invites.place_id` |
| `db/migrations/0006_world_admin.sql` | `places.archived_at` e as views ignorando arquivado |
| `client/src/ui/WorldAdmin.tsx` | painel de gerenciamento do mundo |
| `server/src/lobby.ts` | os quatro handlers, com a casca comum de autenticação |
| `server/src/db.ts` | `listWorldsFor`, `listPendingInvites`, `ensureOrgForNewWorld`, `createWorld`, `inviteToWorld`, `acceptInviteById`, `getPlaceById`, `ensureProfile`, `loadWorldDetail`, `updateWorld`, `archiveWorld`, `removeWorldMember`, `getPendingInvite`, `deletePendingInvite`, `getMyWorldRole`, `getMemberRole`, `setMemberRole`, `transferWorldOwnership` |
| `server/src/world.ts` | `worldOnlineCount()` |
| `server/src/handlers.ts` | `join` por `worldId`; cenário vindo do mundo |
| `server/src/index.ts` | registra os handlers do lobby na conexão |
| `shared/src/types.ts` | `WorldSummary`, `PendingInvite`, `LobbyState`, `LobbyResult` |
| `shared/src/events.ts` | os quatro eventos; `join` com `worldId` |
| `client/src/net/lobbyApi.ts` | as 12 operações como funções `async` tipadas |
| `client/src/net/request.ts` | primitiva de ack (socket caído, queda no meio, prazo) e `once()` |
| `client/src/ui/LobbyScreen.tsx` | a tela |
| `client/src/ui/scenarioEmoji.ts` | emoji por cenário, agora usado em duas telas |
| `client/src/state/store.ts` | fase `lobby`, `worlds`, `pendingInvites`, `selfWorldId` |
| `client/src/ui/JoinScreen.tsx` | mostra o mundo escolhido; sem seletor de cenário |

## Decisões e por quê

**Mundo é `place`, não `organization`.** Colapsar os dois deixaria o lobby mais
simples e mataria a ideia de uma equipe com vários ambientes (Estúdio + Praça da
mesma empresa), que foi o pedido original. A empresa pessoal automática é o
preço para manter `organizations` como raiz única de autorização: sem ela, um
local órfão exigiria um segundo caminho em **cada** política de RLS.

**Socket.IO em vez de o navegador escrever direto no Supabase.** Listar mundos
com a anon key seria trivial (é para isso que o RLS existe), mas criar mundo e
convidar são **escritas** — e hoje não há nenhuma política de escrita, de
propósito. Abrir INSERT/UPDATE para o navegador desfaria a decisão de segurança
mais forte do schema. Endpoints HTTP também resolveriam, ao custo de uma segunda
superfície de API com autenticação própria.

**Socket separado para o lobby.** O socket do jogo nasce e morre com o
`GameView`, que também é quem emite `join` no `connect`. Um socket único vivo
entre as telas exigiria tirar esse ciclo de vida de lá. Duas conexões curtas e
nunca simultâneas custam menos que a reestruturação — e o servidor já trata
conexão sem `join` (loga "sem join" no disconnect).

**Toda resposta de sucesso devolve o estado inteiro.** São operações de um
clique. A alternativa ("escreve, depois lista de novo") tem uma janela no meio
em que a tela mostra dado velho, e o dobro de idas ao servidor.

**Só o dono convida.** Membro comum não pode ampliar o acesso ao mundo — senão o
controle de quem administra seria decorativo. Verificado no servidor
(`manageableWorld()` + `getMyWorldRole()`), não só escondendo o botão.

**Aceite explícito.** Auto-aceitar ao abrir o lobby seria menos código, mas
colocaria a pessoa em mundos sem ela ter dito sim, e sem como recusar.

**O slug do mundo sempre leva sufixo aleatório.** O slug não aparece na tela (o
lobby mostra `name`), então garantir unicidade numa consulta só vale mais que um
slug bonito com retry em caso de colisão.

**Papel passou a ter poder de verdade.** `place_members.role` existia desde
`0001` e era decorativo: só `created_by` podia qualquer coisa. Agora `host`
administra o mundo — o que também é o que faz "definir papel" ser uma operação
com consequência, e não um enfeite na lista.

**Host não mexe em host.** Promover, rebaixar e remover outro `host` é só do
dono. Sem essa regra, dois hosts poderiam se rebaixar um ao outro numa corrida e
quem clicasse primeiro ficaria com o mundo.

**Passar a propriedade mantém o dono antigo como `host`.** Entregar a chave não
devia significar perder o lugar. E a sequência de escritas
(`place_members` do novo dono → `created_by` → `place_members` do antigo) é
ordenada para que nenhuma falha parcial deixe o mundo sem ninguém que possa
administrá-lo.

**Só se passa a propriedade para quem já é membro.** Promover um estranho a dono
num clique seria dar o mundo a quem nunca foi convidado — a UI escolhe da lista,
e o servidor confere.

**O dono entra no próprio mundo restrito sem estar em `place_members`.** O
portão passa a aceitar `created_by === profile`. Antes dependia de o dono
continuar na lista — e a lista agora é editável, então bastava um clique errado
para ele se trancar fora do próprio mundo.

**Reduzir a lotação não expulsa ninguém.** O limite vale para quem entra. Cortar
uma conversa em andamento porque o número mudou seria mudar a regra debaixo de
quem já estava lá; a tela avisa quando o valor é menor que a ocupação atual.

**O `slug` não acompanha o rename.** Ele é identificador interno, já usado em
`unique (organization_id, slug)`; trocá-lo a cada rename só criaria chance de
colisão sem ninguém ganhar nada, porque a tela mostra `name`.

**Confirmação em dois cliques no próprio botão**, e não `window.confirm`: o repo
não tem sistema de modal, e o `confirm()` nativo não é estilizável nem combina
com o resto.

**Convite aceito não é apagado.** `deletePendingInvite` só mexe em convite
pendente: apagar um aceito destruiria a trilha de como a pessoa entrou **e** não
tiraria o acesso dela (quem tira é `removeMember`).

**Revogar convite de empresa não é possível pelo lobby.** Convite sem `place_id`
não tem dono de mundo para autorizá-lo — isso é administração de empresa, que
ainda não existe. Responde `not-found`.

**Motivos de transporte entraram no union do servidor.** `LobbyErrorReason`
ganhou `socket-down` e `timeout`, que **o servidor nunca emite** — é a mesma
convenção que o `VoiceTokenResponse` já usava. A alternativa (um resultado de
transporte por fora, `Requested<LobbyResult>`) obrigaria cada chamador a checar
dois `ok` aninhados; assim a tela trata um caminho de erro só.

**A guarda de clique duplo não é mais estado do React.** Era `busy`, que só
atualiza no render seguinte — dois cliques rápidos passavam os dois. Agora é
`once()` em `net/request.ts`, com chave por operação **e por alvo**: adicionar a
mesma pessoa duas vezes no mesmo mundo é um pedido, adicionar em dois mundos ao
mesmo tempo continua permitido.

**Adicionar duas vezes não estoura.** As duas escritas de `addMemberToWorld` são
idempotentes (o `place_members` é `upsert`, e a membership existente só tem o
`status` reativado), então clicar duas vezes não é erro do usuário.

## Armadilhas

- **`join` sem `worldId` é recusado** (`no-world`) quando há login. O lobby é
  quem escolhe; não existe mais "entrar pelo cenário".
- **O cenário do `join` é só uma aposta do cliente.** Quem decide é o mundo. Se
  alguém trocar o `scenario_id` do mundo entre a listagem e a entrada, o cliente
  monta o mapa errado e o `world:snapshot` volta com outro cenário. Não tratado.
- **Mundo restrito não aparece para quem não é da lista.** Aparecer e recusar na
  entrada seria pior; o efeito colateral é que "não vejo o mundo" e "não tenho
  acesso" são a mesma coisa na tela.
- **Empresa pessoal pode ficar órfã.** Criar empresa + membership são duas
  escritas sem transação (o PostgREST não expõe uma). Se a segunda falhar, sobra
  empresa sem membro; a tentativa seguinte a reaproveita por
  `is_personal` + `created_by`.
- **Dois sockets em sequência.** Entrar num mundo fecha o socket do lobby e abre
  o do jogo. Se algum dia o lobby precisar de atualização ao vivo (alguém
  entrando no mundo), isso vira polling ou um socket persistente.
- **`lobby:list` cria o perfil** se ainda não existir, com nome tirado do e-mail.
  A tela de entrada sobrescreve depois — então o nome no banco muda no primeiro
  `join`.
- **Nada expira convite automaticamente.** `expires_at` é de 7 dias e é
  respeitado na leitura, mas ninguém limpa as linhas velhas.
- **Arquivar é reversível só por SQL**: `update places set archived_at = null`.
  Não há tela de mundos arquivados.
- **Mundo arquivado sai das views de operação** (`v_place_occupancy`,
  `v_place_activity`) — o histórico segue nas tabelas.
- **`ejectFrom` usa `worldKey === places.id`.** Se a chave do mundo mudar de
  fórmula, a expulsão para de achar os sockets, silenciosamente.
- **Tirar o último membro de um mundo restrito** deixa só o dono — que continua
  entrando por `created_by`. Não é bug: é o que evita mundo sem ninguém que
  possa administrá-lo.
- **O papel do dono na lista não é editável**, e o servidor recusa
  (`not-allowed`) mesmo se a tela mandar. A propriedade só muda por
  `lobby:transferOwner`.
- **Nada audita troca de papel nem de propriedade.** Não há registro de quem
  promoveu quem, nem de quando o mundo mudou de dono. `voice_token_grants` tem
  trilha; isto não.
- **Papel é por mundo, não por empresa.** `memberships.role`
  (owner/admin/member/guest) continua sem UI e sem efeito no jogo — quem manda
  no acesso ao mundo é `place_members.role` + `created_by`.
- **Esta entrega não precisou de migration**: `place_members.role` já tinha o
  CHECK com `host`/`member` desde `0001`. Se um papel novo entrar, aí sim.

## Como testar

**Sem Supabase** (verificado): o lobby não aparece e o jogo entra anônimo. Os
quatro eventos respondem `not-configured`.

**Com Supabase:**

1. Aplique `0001`→`0008` e o `seed.sql` (ver `db/README.md`).
2. Crie a conta na tela de login (não precisa de acesso para **criar** mundo).
   Confira que **o seu ID aparece** no lobby e que "Copiar" funciona.
3. **Criar**: "Criar um mundo", nome + cenário + lotação 2. Ele aparece na lista
   com "você criou · restrito". No banco: `places.created_by` preenchido,
   `place_members` com você como `host`, e uma `organizations.is_personal` se
   você não pertencia a nenhuma empresa.
4. **Entrar**: o mundo abre com o mapa do cenário escolhido, e a lista mostra
   "1 dentro de 2" quando você volta ao lobby.
5. **Adicionar**: em outro navegador, crie a segunda conta e copie o ID dela. No
   primeiro, "Adicionar" no mundo que você criou + esse ID. O mundo tem que
   passar a aparecer no lobby da segunda conta, **sem nenhum passo de aceite**.
   Testar também ID malformado (botão desabilitado) e uuid inexistente
   (**"não encontrado"**, não "erro").
6. **Lotação**: com os dois dentro de um mundo de lotação 2, uma terceira conta
   adicionada tem que ver "Cheio" no botão (e `join` recusaria com `place-full`).
7. **Só o dono convida**: com a conta convidada, o botão "Convidar" não aparece —
   e um `lobby:invite` forçado pelo console tem que responder `not-allowed`.
8. **Isolamento**: dois mundos diferentes no mesmo cenário não se veem nem se
   ouvem (é o refactor da entrega anterior).
9. **Gerenciar**: no mundo que você criou, "Gerenciar". Renomeie e confira a
   lista; mude a lotação para menor que a ocupação e veja o aviso (ninguém é
   expulso).
10. **Tirar membro com a pessoa dentro**: com a conta convidada dentro do mundo,
    clique "Tirar" duas vezes. Ela tem que ser desconectada e cair na tela de
    entrada com "este mundo é restrito e você não está na lista".
11. **Arquivar com gente dentro**: idem, todos caem — e o mundo desaparece do
    lobby das duas contas. Conferir:
    `select name, archived_at from places where archived_at is not null;`
12. **Recusar convite**: convide uma terceira conta e recuse pelo lobby dela; a
    linha tem que sair de `invites`.
13. **Papéis**: no painel, "Tornar admin" numa conta convidada. Ela passa a ver
    "você administra" no lobby e ganha os botões Convidar/Gerenciar — mas **não**
    o de arquivar nem o de passar a dono.
14. **Host tem limite**: logado como host, tentar rebaixar/remover outro host
    tem que responder `not-allowed` (o botão não aparece; force pelo console).
15. **Passar a propriedade**: "Passar a dono" duas vezes numa conta membro. Ela
    passa a aparecer como "dono · criou este mundo" e você fica como host —
    confira `select created_by from places where id = '<uuid>';`.
16. **Só o dono arquiva**: pelo console de um host,
    `socket.emit('lobby:archive', '<id>', console.log)` tem que responder
    `not-allowed`.

## Não verificado

Espelhado em `PENDENTES.md`:

- **Nunca rodou contra um Supabase real.** Nenhuma escrita do lobby (criar
  mundo, empresa pessoal, convidar, aceitar, editar, arquivar, remover, revogar)
  foi executada de verdade.
- **`ejectFrom` nunca desconectou ninguém**: o caminho só é alcançável pelo dono
  autenticado, então nem a expulsão nem a recusa subsequente no portão foram
  observadas.
- A UI do lobby nunca foi aberta num navegador — só compila e o bundle constrói.
- `listWorldsFor` faz 4 consultas e filtra em JS; nunca foi medido com muitos
  mundos.
- Continua sem UI: desarquivar um mundo e administrar a **empresa** (convite de
  empresa, `memberships.role`, suspender membro).
- Ninguém testou dois cliques rápidos em "Criar" (o botão desabilita por `busy`,
  mas a proteção real seria no servidor).

## Relacionado

- [Autenticação e controle de acesso](autenticacao-e-acesso.md) — o portão do
  `join`, e por que o mundo é por local
- [Persistência (Supabase)](persistencia-supabase.md) — perfis, posição salva
- [`db/README.md`](../../db/README.md) — aplicar o schema
