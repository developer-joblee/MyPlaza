# Menu de configurações (dentro do jogo)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Botão de **engrenagem** na barra inferior, na última posição (onde ficava o
telefone). Ele abre um menu com quatro coisas:

1. **em que mundo você está** (emoji do cenário + nome);
2. **o seu ID**, com botão de copiar — o mesmo que o lobby mostra;
3. **adicionar alguém a este mundo pelo ID dela**, *sem sair do mundo*;
4. **Finalizar chamada**, que era o botão de telefone da barra.

O item 3 é o motivo da feature. Antes dele, dar acesso a uma pessoa só era
possível no lobby, e chegar ao lobby exige sair do mundo — ou seja, derrubar
voz, tela compartilhada e posição para uma operação de dez segundos.

## Como funciona

**Nada mudou no servidor, em `shared/` ou no banco.** A entrega é só client, e
isso não é economia: é uma propriedade que já existia e ninguém tinha usado.

`server/src/index.ts` registra `registerLobbyHandlers(io, socket)` em **toda**
conexão, não só na do lobby — e o socket do jogo carrega o mesmo token no
handshake, porque os dois saem da mesma fábrica (`client/src/net/socket.ts`). O
`whoAmI()` de `server/src/lobby.ts` resolve a identidade a partir desse token.
Logo, **`lobby:addMember` sempre funcionou pelo socket do jogo**; faltava tela.

O menu monta a sua fronteira de requisição com
`createLobbyApi(() => runtime.socket)` — o socket do **jogo**, não um segundo
socket. O `once()` de `net/request.ts` já deduplica por
`addMember:${worldId}:${memberId}`, então não há guarda de clique duplo aqui.

Quem pode adicionar sai do store: o `WorldSummary` do mundo atual
(`worlds.find(w => w.id === selfWorldId)`) tem `myRole`, e a regra é a mesma
`canManage` do lobby (`myRole !== 'member'`). A lista `worlds` sobrevive à
entrada no mundo — nem `chooseWorld` nem `leave()` a limpam.

O popover é o mesmo molde de `AudioSettings` e `SoundboardPanel`: `role="dialog"`,
fecha em Escape e em `pointerdown` de **fase de captura**, cabeçalho `.audio-head`,
e o foco volta para o botão que o abriu.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/ui/SettingsMenu.tsx` | o popover inteiro |
| `client/src/ui/MediaControls.tsx` | engrenagem no lugar do telefone; abre o menu |
| `client/src/ui/icons.tsx` | `GearIcon` (novo); `HangupIcon` migrou para dentro do menu |
| `client/src/ui/lobbyReason.ts` | `LobbyErrorReason` → PT-BR, extraído do `LobbyScreen` |
| `client/src/ui/util.ts` | `copyText()`, extraído do `LobbyScreen` |
| `client/src/ui/LobbyScreen.tsx` | passou a importar os dois acima |
| `client/src/styles.css` | `.settings-popover` e as classes da seção |

## Decisões e por quê

**A resposta do `addMember` é descartada — nada de `setLobby()`.** É a decisão
mais importante daqui, e a que mais parece bug para quem lê depois. O
`store.setLobby` sobrescreve `selfName`/`selfColor`/`selfCharacter` com o prefill
do perfil (`LobbyState.me`), e **dentro de um mundo o nome que vale é o vínculo
daquele mundo** — quem é "Iago (cliente)" ali viraria "Iago" no meio da sessão,
sem ninguém entender por quê. Ver [Vínculo com o mundo](vinculo-com-o-mundo.md).
Adicionar alguém muda o acesso de **outra** pessoa; a minha aparência não tem
nada com isso. A lista de mundos é remontada na próxima ida ao lobby.

**O botão de áudio continua separado na barra.** Havia a opção de recolher o
`SlidersIcon` para dentro do menu e deixar a barra mais limpa. Áudio é usado com
frequência (trocar de microfone, ver o nível) e merece um clique só; a
engrenagem fica com o que é raro — adicionar gente, sair. Um menu que engole o
que se usa toda hora é organização que custa tempo.

**Membro comum não vê o campo de adicionar, em vez de vê-lo desabilitado.** É a
escolha oposta à do soundboard em modo anônimo, e de propósito: lá o item
desabilitado ensina que a feature existe e se conquista; aqui ele só anunciaria
uma permissão que a pessoa não tem e não pode obter sozinha. O servidor recusa
com `not-allowed` de qualquer forma — a tela não é a única guarda.

**A engrenagem podia significar "configurações" porque o áudio não a usa.** O
comentário em `icons.tsx` registra que `SlidersIcon` foi escolhido *no lugar de*
uma engrenagem para o áudio ("faders lê como 'níveis de áudio' a 22px, o que uma
engrenagem não faz"). Isso continua valendo, e é o que deixa os dois botões
vizinhos distinguíveis de relance. Não unifique os dois.

**`REASON_TEXT` e `copyText` saíram do `LobbyScreen`.** Duas telas agora fazem
operações de lobby e copiam o mesmo ID. Duas cópias do mapa de motivos
divergiriam no primeiro motivo novo — e o `LobbyErrorReason` já cresceu uma vez
(ganhou `socket-down` e `timeout`).

**O telefone virou botão com rótulo.** Na barra ele era um ícone solto ao lado do
botão de mutar, e a `.media-divider` existia justamente para reduzir o clique por
engano. Dentro do menu ele ganha o rótulo "Finalizar chamada", que é uma guarda
melhor que uma divisória — e a divisória fica onde estava, agora isolando o menu
que **contém** a ação destrutiva.

**Sem confirmação em dois cliques.** O telefone nunca teve, e sair é reversível:
com conta, cai no lobby e dá para entrar de novo.

## Armadilhas

- **`data-capture-keys` é obrigatório no painel.** `client/src/game/input.ts` usa
  `closest('[data-capture-keys]')` para não tratar a digitação como movimento.
  Sem o atributo, colar um uuid faz o avatar sair andando pelo mapa.
- **O `pointerdown` de fechar tem de ser em fase de captura** (`, true`), senão o
  canvas do Pixi engole o evento e o painel não fecha ao clicar fora. Mesma
  armadilha do `AudioSettings`.
- **Não chame `setLobby()` daqui** (ver a primeira decisão acima).
- **O menu depende de o lobby já ter rodado.** `myId` e `worlds` são preenchidos
  por `lobby:list`, na tela do lobby. Em modo anônimo os dois ficam vazios e o
  menu mostra só o cenário e o "Finalizar chamada" — que é o comportamento certo,
  mas significa que **este menu nunca é a primeira coisa a popular o store**.
- **`worlds` envelhece durante a sessão.** É a foto do momento em que o lobby
  respondeu. Se alguém rebaixar você a `member` enquanto você está dentro, o campo
  continua aparecendo — e o servidor recusa com `not-allowed`, que é o texto que
  a tela mostra. Não é furo de segurança, é uma mensagem em vez de um botão
  ausente.
- **O `LobbyScreen` afirma que os dois sockets nunca são simultâneos** (o
  `lobby.ts` cacheia `appearance` nessa premissa). Continua verdade: este menu usa
  o socket **do jogo** e não abre um segundo.

## Como testar

`npm run dev`, com Supabase configurado, duas contas em janelas separadas.

1. **A** entra num mundo que ela criou → engrenagem na última posição da barra,
   e o telefone **não** está mais lá.
2. O menu abre com o nome do mundo, o ID de A e o campo de adicionar.
3. **B** (janela anônima, conta própria) copia o ID dela no lobby.
4. **A** cola o ID de B no menu e clica Adicionar, **sem sair do mundo** →
   "Pronto — a pessoa já tem acesso.", e o mundo passa a aparecer no lobby de B.
   É o pedido inteiro.
5. **Confira que o nome de A no mundo não mudou** depois disso — é o sintoma de
   um `setLobby()` indevido.
6. Digitar dentro do campo **não anda com o avatar**.
7. ID torto → botão desabilitado. Uuid inexistente → "Isso não existe mais.",
   não "erro".
8. **Finalizar chamada** volta para o lobby, como o telefone fazia.
9. Escape, clique fora e o `×` fecham; o foco volta para a engrenagem.
10. Com **B dentro do mundo** (papel `member`): o menu abre **sem** o campo de
    adicionar, e **com** "Seu ID".
11. Sem Supabase: o menu abre com o rótulo do cenário e o "Finalizar chamada",
    sem ID nem adicionar.

## Não verificado

Espelhado em `PENDENTES.md`. Em resumo:

**Verificado:** `npm run typecheck` (server + client) e `npm run build` do client
limpos; `grep` de `.emit(` fora de `client/src/net/` vazio; `smoke-test.mts`
14/14; e — o que importa aqui — um script de socket provou que
`lobby:addMember` e `lobby:list` **respondem no socket do jogo, depois do
`join`**, com o mesmo motivo de antes de entrar, sem derrubar o socket nem a
sessão de mundo. A premissa da entrega não é mais só leitura de código.

**Não verificado:** o caminho **autenticado** (sem Supabase tudo para em
`not-configured`, antes de token, papel e escrita), e **nenhuma tela foi aberta
num navegador** — o popover, o fechamento, o foco, o `data-capture-keys` e todo
o CSS novo.

## Relacionado

- [Lobby](lobby.md) — de onde `lobby:addMember` veio, e o painel de gerenciar
- [Autenticação e controle de acesso](autenticacao-e-acesso.md) — o acesso por ID
- [Vínculo com o mundo](vinculo-com-o-mundo.md) — por que o nome do mundo não pode
  ser sobrescrito pelo prefill do perfil
- [Camada de requisição](camada-de-requisicao.md) — `createLobbyApi`, `once()`
- README, seção [Controles](../../README.md#controles)
