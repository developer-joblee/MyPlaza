# Camada de requisição (client → servidor)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Concentra em `client/src/net/` **toda** conversa do navegador com o servidor.
Componente, objeto de jogo e store não chamam `socket.emit` — chamam funções
tipadas que devolvem `Promise` (quando há resposta) ou `boolean` (quando não há).

Não é uma feature que o usuário vê. Está documentada porque impõe uma **regra
que se quebra sem perceber**: basta alguém escrever `socket.emit` num componente
e a camada deixa de valer.

```
client/src/net/
  socket.ts      cria o socket, com o token no handshake
  authToken.ts   empurra o token renovado para o socket JÁ conectado
  bindStore.ts   escutas -> store (do servidor para cá; não é requisição)
  request.ts     a primitiva: connected + disconnect + prazo + once()
  lobbyApi.ts    as 12 operações do lobby (com ack)
  worldApi.ts    join, move, sit, away, chat:send, share (sem ack)
  voiceApi.ts    token do LiveKit (com ack)
```

Como conferir que a regra continua valendo:

```bash
grep -rn "\.emit(" client/src | grep -v "client/src/net/"   # tem de vir vazio
```

## Como funciona

`request()` faz três coisas que parecem paranoia e cada uma corresponde a um
defeito que existiu:

1. **Confere `socket.connected` antes de emitir.** Emitir com o socket caído
   manda o pacote para o `sendBuffer`, e o socket.io **não** limpa o ack de
   pacotes enfileirados: o prazo estoura sem o servidor nunca ter visto o
   pedido. Era o "operation has timed out" do log de produção.
2. **Escuta `disconnect` enquanto espera.** Cair no meio é resposta imediata, em
   vez de 10s de espera inútil — é o que devolve o botão para a pessoa.
3. **Usa `socket.timeout()`**, para o ack ter fim mesmo quando o servidor aceita
   o pedido e morre antes de responder.

`fire()` é a versão sem ack, e devolve `false` quando não há conexão. `once()`
serializa por chave: enquanto uma chamada está em vôo, a mesma chave devolve
`null` em vez de disparar outra.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/net/request.ts` | `request()`, `fire()`, `once()` |
| `client/src/net/lobbyApi.ts` | `createLobbyApi(getSocket)` — 12 métodos `async` |
| `client/src/net/worldApi.ts` | `createWorldApi(getSocket)` — 6 métodos `boolean` |
| `client/src/net/voiceApi.ts` | `requestVoiceToken()` (era `voice/token.ts`) |
| `client/src/net/authToken.ts` | `bindAccessToken(getSocket)` — o `auth:token` |
| `shared/src/types.ts` | `LobbyErrorReason` com `socket-down` e `timeout` |
| `client/src/runtime.ts` | `runtime.api`, para `Chat` e `presence` alcançarem |

## Decisões e por quê

**Motivos de transporte entraram no union do servidor.** `LobbyErrorReason` tem
`socket-down` e `timeout`, que **o servidor nunca emite** — mesma convenção que
o `VoiceTokenResponse` já usava. A alternativa (`Requested<LobbyResult>`, um
resultado de transporte por fora) obrigaria cada chamador a checar dois `ok`
aninhados. Assim a tela trata um caminho de erro só.

**As factories recebem um *getter* do socket, não o socket.** `createLobbyApi(()
=> socketRef.current)`. Três motivos: o socket nasce depois do primeiro render;
numa reconexão ele é substituído, e uma api que guardasse a referência apontaria
para um socket morto; e em `Game`/`VoiceRoom` o inicializador de campo roda
antes do parâmetro de construtor existir — a closure é lida só no envio, quando
já existe.

**A guarda de clique duplo não é estado do React.** Era `busy`, que só atualiza
no render seguinte — dois cliques rápidos passavam os dois e criavam dois
mundos. Agora é `once()`, um `Map` de promessas, que não depende de ciclo de
render. A chave inclui o alvo: convidar duas vezes no mesmo mundo é um pedido,
convidar em dois mundos ao mesmo tempo continua permitido.

**`move`/`sit` também passam pela camada**, apesar de rodarem a `TICK_RATE`
(15/s). Uma chamada de função por tick é irrelevante, e uma regra sem exceção se
mantém sozinha — uma regra com exceção alguém "conserta" depois. Foi por isso
também que `voice/token.ts` virou `net/voiceApi.ts`: ele usava a primitiva
corretamente, mas era o único `emit` fora de `net/`.

**`authToken.ts` está aqui só porque emite.** Ele não é uma requisição: é uma
assinatura do SDK do Supabase que, quando o token muda, dispara um evento sem
ack. Ficaria mais natural em `auth/`, e está em `net/` porque a regra "`emit` não
sai desta pasta" não tem exceção — a alternativa era um `socket.emit` num módulo
de autenticação, que é exatamente o buraco que esta camada existe para fechar. É
`fire()`, não `request()`: sem ack, e perder o envio não perde nada (a reconexão
leva o token novo no handshake).

**As escutas ficaram fora.** `bindStore.ts` e `Game.bindSocket()` continuam
assinando eventos direto. Escuta é assinatura, não requisição: não tem prazo,
não tem resposta e não tem quem esperar.

**A api do lobby vive na tela, a do mundo no `runtime`.** O `LobbyScreen` tem
socket próprio e guarda a api num `useRef`; a do mundo vai para `runtime.api`
porque `Chat.tsx` e `presence.ts` precisam alcançá-la sem props — que é
exatamente o que `runtime.ts` existe para resolver.

## Armadilhas

- **`socket.emit` fora de `net/` desfaz a camada em silêncio.** Nada quebra, nada
  avisa: só volta a existir um caminho sem prazo e sem tratamento de erro. Use o
  `grep` do topo deste doc.
- **`apply(null)` não pode mexer no indicador de carregando.** `null` significa
  "há uma chamada igual em vôo, e é ela que vai destravar" — limpar o `busy` ali
  reabilita a tela no meio da requisição. Foi um bug real durante a implementação.
- **Falha de transporte é `{ ok: false }`, não exceção.** Nenhum método lança;
  quem trata `catch` está tratando o que não acontece.
- **`fire()` devolvendo `false` tem de ser respeitado.** É o que faz o `Chat` não
  limpar o campo de uma mensagem que não foi enviada. Ignorar o retorno recria o
  defeito original.
- **`once()` guarda a promessa até ela resolver.** Se um método novo nunca
  resolver (o que `request()` impede), a chave trava para sempre.

## Como testar

Sem Supabase, com o servidor no ar (`npm start -w server`), dá para provar tudo
por script Node importando as apis direto — foi assim que os quatro defeitos
foram verificados:

- socket nunca conectado → `socket-down` imediato (não espera o prazo);
- derrubar o socket **durante** a chamada → `socket-down` imediato;
- dois `create` simultâneos → 1 requisição, o segundo devolve `null`, e a chave
  libera depois;
- `chatSend` sem conexão → `false`; com conexão → `true`.

Mais a regressão de sempre: `npx tsx smoke-test.mts` (14 checagens) e os 12
métodos da api levando `invalid-token` com o portão ativo.

## Não verificado

- Nada disso foi visto num navegador: a camada foi exercitada por script contra
  o servidor, não pela UI. O `busy` destravando na tela foi provado na api.
- O custo de `move`/`sit` atravessarem uma função a 15/s não foi medido.
- A api nunca foi testada com o socket sendo **substituído** no meio de uma
  chamada (é o caso que o getter existe para cobrir).

## Relacionado

- [Lobby](lobby.md) — quem mais usa a camada
- README, seção [Arquitetura](../../README.md#arquitetura)
