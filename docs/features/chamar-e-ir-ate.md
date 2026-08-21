# Chamar pelo menu de contexto ("pin" e "ir até")

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

**Botão direito** no boneco de alguém → **chamar**. Na tela dessa pessoa toca um
"pin" curto e aparece um alerta no **canto superior direito** — *"Ana te chamou ·
14:32"* — com **Ir até** e **×**. Clicando em "Ir até", o avatar dela **caminha
sozinho** até você, contornando parede, e para a dois tiles de distância; quem
chamou vê *"Bruno está vindo"* por alguns segundos.

O item do menu é um **interruptor**: pressionado significa que existe um alerta
seu na tela dela agora. Clicar de novo apaga esse alerta; clicar mais uma vez
toca um pin novo. Quando a outra pessoa responde (aceita **ou** fecha), o item
despressiona sozinho.

Não dá para chamar quem está **ausente**: para essa pessoa o canal é o botão
**chamar** da lista do HUD, com o "toc-toc" e o botão "Voltar" — ver
[Chamado de quem está ausente](chamado-ausente.md).

## Como funciona

Quatro eventos em `shared/src/events.ts`, todos **sem ack** e com recusa **em
silêncio**, como o resto dos eventos de mundo:

| Evento | Sentido | Para quê |
|---|---|---|
| `presence:call(targetId, on)` | c→s | acende (`true`) ou apaga o alerta |
| `presence:called(fromId, fromName, on)` | s→c, **unicast** | o alerta na tela do alvo |
| `presence:callAnswer(fromId, accepted)` | c→s | respondi: vou / fechei |
| `presence:callAnswered(byId, byName, accepted)` | s→c, **unicast** | despressiona o item de quem chamou |

O servidor (`server/src/handlers.ts`) é **relay com limite**: acha as duas pessoas
no mesmo `World`, recusa se o alvo está ausente (só ao **acender**), impõe
`CALL_COOLDOWN_MS` = 3000 por par em `socket.data.calledAt` e entrega por
`io.to(targetId)`. Ele **não guarda** quem chamou quem.

No cliente, `client/src/call.ts` é o dono dos efeitos (store + som + rede +
jogo), no molde de `presence.ts`. O estado fica em duas fatias do store:
`calls` (os cartões na tela) e `myCalls` (quem eu chamei → quando).

O **"ir até"** é 100% de cliente, e é a única parte sem precedente no projeto:

1. `client/src/game/pathfind.ts` — **BFS** de 4 direções na grade de tiles,
   usando o mesmo predicado da colisão (`TilemapBase.isSolidAt`), com corte de
   canto por linha de visão (`collidesCircle`).
2. `client/src/game/AutoWalk.ts` — recalcula a rota a cada **500ms** (o alvo é
   uma pessoa e ela anda), desiste em **20s**, e para a **1,5 tile** (meio tile
   dentro de `BOOBLE_JOIN_RADIUS` — a folga é da booble, ver abaixo). Devolve um
   vetor **contínuo** por frame.
3. `client/src/game/Game.ts` — passa esse vetor para `LocalPlayer.update`, que só
   o usa **quando o teclado está parado**. É assim que WASD cancela.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/events.ts` | os quatro eventos |
| `shared/src/constants.ts` | `CALL_COOLDOWN_MS` |
| `server/src/handlers.ts` | `presence:call`, `presence:callAnswer`, `SocketData.calledAt` |
| `client/src/call.ts` | `toggleCall`, `receiveCall`, `answerCall`, `receiveCallAnswer` |
| `client/src/net/worldApi.ts` | `call`, `callAnswer` na fronteira de requisição |
| `client/src/net/bindStore.ts` | ouve os dois eventos, delegando a `call.ts` |
| `client/src/state/store.ts` | `CallAlert`, `calls`, `myCalls` e as quatro ações |
| `client/src/ui/AvatarContextMenu.tsx` | o item **chamar** (o primeiro item real do menu) |
| `client/src/ui/CallAlerts.tsx` | a pilha do canto superior direito |
| `client/src/ui/GameView.tsx` | a coluna `.top-right-stack` |
| `client/src/ui/sfx.ts` | primitiva de WebAudio (contexto único + envelope) |
| `client/src/ui/ping.ts` | o "pin" |
| `client/src/ui/knock.ts` | passou a usar o `sfx` (o "toc-toc" não mudou de som) |
| `client/src/game/pathfind.ts` | BFS + corte de canto |
| `client/src/game/AutoWalk.ts` | alvo, repath, prazo, parada, `arrivedAt` |
| `client/src/game/Game.ts` | `walkTo`, `cancelWalk`, o vetor no tick |
| `client/src/game/LocalPlayer.ts` | o `autoAxis` no `update` |
| `client/src/styles.css` | `.top-right-stack`, `.call-stack`, `.avatar-menu-item` |

## Decisões e por quê

**Eventos novos, e não uma flag no `presence:nudge`.** O doc do chamado-ausente
argumenta que um nudge sem a exigência de ausência "viraria um cutucar genérico —
outra feature, com outro problema de abuso". Esta **é** aquela feature, e a
guarda é literalmente invertida (`target.away` vs `!target.away`). Compartilhar o
evento significaria um `if` no servidor decidindo entre dois avisos, dois sons e
duas respostas ("Voltar" vs "Ir até") — e um cooldown de 15s (o do toc-toc) que
mataria o repinar, que aqui é a feature.

**O `on` é booleano no mesmo evento**, em vez de `presence:call` +
`presence:uncall`. Segue o `away`/`player:away`, que já é um interruptor.

**Apagar não passa pelo cooldown nem pela guarda de ausência.** Foi um defeito
real, achado em teste: o alvo que ficasse ausente com um chamado no ar prendia o
alerta na tela — o cancelamento de quem chamou era recusado, e o botão dele
despressionava por conta da resposta que nunca vinha. Acender é uma ação;
**apagar é limpeza**, e recusar limpeza só pode deixar lixo.

**O servidor não guarda quem chamou quem.** O alerta vive no cliente do alvo e o
"pressionado" no cliente de quem chamou, e os dois se resolvem pelo `roster`:
quem sai do mundo faz os dois morrerem sozinhos (`removeRosterEntry` poda as duas
fatias). Um registro no servidor precisaria de limpeza no `disconnect`, de
reconciliação na reconexão, e compraria só a possibilidade de validar um
`callAnswer` — cujo pior abuso é despressionar o botão de outra pessoa.

**Quem chamou fica sabendo da resposta.** Contraria a regra de "recusa em
silêncio" dos outros eventos, e de propósito: ali o silêncio existe para o clique
não virar **sonda** de presença ("consegui cutucar? então ele está ausente").
Aqui quem responde **escolheu** responder — não há informação vazando que a
pessoa não tenha entregado de propósito.

**O "pressionado" vive no store, não em `useState`.** O menu de contexto desmonta
ao fechar. Um estado local (que é como o cooldown do botão do HUD funciona)
nasceria despressionado ao reabrir o menu na mesma pessoa, mentindo sobre um
chamado que continua no ar.

**BFS, e não linha reta com deslize.** A sala de reunião do Estúdio tem **uma
porta de dois tiles** numa parede inteira, e sala fechada é justamente de onde
alguém chama. A reta bate na parede e o deslize por eixo encosta e para — o caso
não é exótico, é o caso comum. BFS numa grade de no máximo 4060 tiles é
sub-milissegundo e roda no clique e no repath, não por frame; A* com heurística
seria mais código para justificar sem ganho mensurável.

**O pathfinding decide *por onde*, não *como*.** Os waypoints entram como um
vetor de direção no mesmo bloco de integração e colisão que já existia. A colisão
nunca é duplicada, e se a rota errar (mapa mudou, waypoint virou parede) o pior
caso é o avatar travar num tile — nunca atravessar parede.

**Nunca existe "não achei caminho".** Quando o alvo está num tile **sólido** (o
caso garantido: cadeira é sólida, e quem chama pode estar sentado) ou é
inalcançável, o BFS termina no tile alcançável mais próximo dele — ele já conhece
a distância de tudo que alcançou. Um erro que a interface não teria o que fazer
com é pior que chegar perto.

**Vetor contínuo, não as oito direções do teclado.** Com as oito, o avatar
chegaria em zigue-zague de 45° e ficaria oscilando meio pixel em volta do
destino. `MOVE_SPEED * dt` aceita qualquer vetor normalizado sem mudança.

**Persegue em vez de congelar o destino** (escolha explícita do usuário). O alvo
é uma pessoa e ela anda; congelar faria o "ir até" terminar onde ela **estava**.
O preço é o repath de 500ms e o prazo de 20s, que existe para quem foge mais
rápido do que se chega.

**Para em `BOOBLE_JOIN_RADIUS` (2 tiles), não em cima da pessoa.** Não é gosto: é
exatamente o raio em que a [booble](booble.md) fica disponível, então o "ir até"
desemboca na distância de conversa. Avatares não colidem, então terminar
sobreposto é possível — e feio, e não serve para nada.

> Isto **deixou de ser só elegância**, e o raio ganhou uma folga (`STOP_MARGIN`,
> meio tile): a booble pelo menu de contexto passou a valer de qualquer distância,
> e ela abre **onde esta caminhada para**. O servidor confere o raio com a posição
> que ele tem, atrasada em até um tick de rede (~11px a `MOVE_SPEED`) — parar na
> borda do raio fazia o pedido cair fora dele e ser recusado **em silêncio**. Não
> reduza o `STOP_MARGIN` a zero; ver [Booble](booble.md).

**`arrivedAt` distingue chegar de desistir.** A caminhada termina de cinco
maneiras (chegou, prazo, alvo saiu do mundo, rota impossível, cancelada de fora) e
as cinco deixam `active` em `false`. Para o "ir até" isso bastava: chegar ou
desistir dá no mesmo, o avatar simplesmente para. Quem precisou da diferença foi a
booble, que abre **só** na chegada. Guarda o id do alvo, e não um booleano, porque
quem lê isso lê um frame depois — com um booleano uma chegada antiga responderia
"sim" para um alvo novo.

**A auto-caminhada conta como andar** nas duas regras que liam `keyboard.moving`:
levantar da cadeira (`LocalPlayer`) e cancelar o ausente (`Game`). Sem isso o
avatar deslizaria pelo chão na pose de sentado, ou caminharia com o celular na
mão.

**O alerta no canto superior direito, e não na `.notice-stack`.** Um chamado pede
**decisão** de quem recebe, e decisão fica onde a pessoa pode deixar aberta
enquanto continua jogando — a pilha do topo-centro fica em cima do avatar, no
caminho do olho e do movimento. Os cartões reusam `.notice`/`.notice-action`/
`.notice-dismiss` inteiros, então são a mesma família visual; só a âncora muda.

**A coluna `.top-right-stack` conserta uma sobreposição que já existia.** O zoom
e as prévias de tela estavam ancorados os **dois** em `top:16 right:16` e se
sobrepunham quando alguém compartilhava. Agora são itens de uma coluna, com o
zoom **primeiro**: controle que se desloca quando chega um aviso é pior que aviso
44px mais abaixo.

**O pin é curto (~200ms, um ciclo), o toc-toc é longo (2,5s, repetido).** Quem
recebe um pin está **na frente da tela**, com o alerta aparecendo no mesmo
instante; o som só precisa virar a atenção. Insistir com quem já está olhando soa
como alarme, e é o tipo de som que faz desligar o volume do app. Ascendente
porque pergunta ("vem?") em vez de encerrar.

**A primitiva de WebAudio virou `ui/sfx.ts`.** Dois sons sintetizados querem a
mesma coisa (nenhum asset novo, um contexto compartilhado, envelope explícito), e
o comentário do `knock.ts` já pedia o contexto único. O que **não** foi
compartilhado é a trava de "já está tocando": cada padrão guarda a sua, senão um
pin de 200ms engoliria um toc-toc de 2,5s.

**O cartão "está vindo" expira em 6s; o alerta de chamado não expira.** São
coisas diferentes: o alerta é um pedido que pode chegar com a pessoa longe da
tela (mesmo raciocínio do toc-toc); o "está vindo" confirma algo que já está
acontecendo — em poucos segundos a pessoa aparece do lado.

## Armadilhas

- **`myCalls` e `calls` guardam `socket.id`.** Como os `nudges`, é identificador
  de exibição: quem cai e volta é uma pessoa "nova", sem chamado. É o
  comportamento desejado (chamado é de sessão), mas não use para nada persistente.
- **`store.setAway` NÃO zera `calls`** (ao contrário dos `nudges`). É de
  propósito: chamado de quem está presente não tem nada a ver com o celular. Se
  alguém "consertar" isso, o alerta passa a sumir ao ficar ausente e o
  cancelamento de quem chamou vira ruído.
- **O `AutoWalk` é compartilhado com a [booble](booble.md), e há UM por cliente.**
  Clicar em `booble` em alguém enquanto se vai até quem chamou **troca o destino**.
  É de propósito (são a mesma intenção, e duas caminhadas simultâneas não
  existem), mas quem mexer aqui está mexendo nas duas features.
- **A auto-caminhada não passa pelo `Keyboard`.** Quem for adicionar outra regra
  que dependa de "o avatar está andando" precisa somar `autoWalk.active` (ou o
  `autoAxis`), como fizeram o levantar-da-cadeira e o cancelar-ausente. Esquecer
  não dá erro: dá avatar deslizando sentado.
- **`walkTo` só funciona para remotos** (`this.remotes`): não há "ir até" você
  mesmo, e o alerta nunca é de si mesmo.
- **O menu continua sem `data-capture-keys`**, e continua certo: este item não
  tem campo de texto. Vira defeito no primeiro item que tiver — ver
  [Menu de contexto no avatar](menu-de-contexto.md).
- **Mudança em `shared/`**: os dois lados compilam contra os mesmos eventos —
  `npm run typecheck` (server + client).
- **O corte de canto usa amostragem** (1/4 de tile) contra `collidesCircle`, não
  geometria exata. É seguro porque o menor obstáculo possível é um tile inteiro,
  mas se algum dia houver colisão sub-tile, é o primeiro lugar a revisar.

## Como testar

Servidor headless (feito):

```bash
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= PORT=3099 npx tsx server/src/index.ts
```

e um script de quatro sockets no molde do `smoke-test.mts`. Os casos que importam
são as recusas: alvo **ausente** (com par limpo, senão o cooldown explica a
recusa pelo motivo errado), alvo em outro mundo, alvo inexistente/vazio/eu mesmo,
segundo pin dentro do cooldown, e o **apagar passando** com o alvo ausente.

Interface, `npm run dev` com duas abas no mesmo mundo:

1. Botão direito no boneco do outro → o menu mostra **chamar**.
2. Clique: a outra aba toca o pin e mostra o alerta no canto superior direito; o
   item vira **cancelar chamado** (mint).
3. Reabra o menu na mesma pessoa: ele continua **pressionado**.
4. "Ir até" na outra aba: o avatar caminha, **contorna a parede** (teste com quem
   chamou dentro da sala de reunião do Estúdio) e para a ~2 tiles. No primeiro
   cliente o item despressiona e aparece "está vindo".
5. WASD no meio do trajeto **cancela** a caminhada na hora.
6. Chame, e **cancele** antes de o outro responder: o alerta sai da tela dele.
7. Clique de novo dentro de 3s: o item aparece **desabilitado** com o motivo, e
   reabilita sozinho quando o cooldown vence.
8. A outra pessoa fica **ausente**: o item vira desabilitado ("use o chamar da
   lista"), e o botão da lista do HUD continua funcionando com o toc-toc.
9. Com alguém compartilhando tela: o alerta **não** fica por baixo da prévia, e a
   prévia **não** fica por baixo do zoom.
10. Chamar alguém **sentado** → a caminhada termina ao lado da cadeira.
11. A outra aba **sai do mundo** com o chamado no ar → o alerta e o
    "pressionado" desaparecem sozinhos.

## Não verificado

**Nada da interface foi aberto num navegador.** O que está verificado é o
servidor (15 casos de socket + 3 do defeito de apagar), o `findPath` contra o mapa
real do Estúdio (10 casos), `npm run typecheck` e o build do client — mais o
`smoke-test.mts` 14/14 como regressão, porque `shared/` mudou. Lista completa em
`PENDENTES.md`.

## Relacionado

- [Menu de contexto no avatar](menu-de-contexto.md) — o caminho do clique, e por
  que a `hitArea` existe
- [Chamado de quem está ausente](chamado-ausente.md) — o outro "chamar", para
  quem está no celular
- [Booble](booble.md) — o raio de 2 tiles em que a caminhada termina, e a outra
  feature que usa esta mesma caminhada (de onde veio o `arrivedAt`)
- [Modo ausente (celular)](modo-ausente.md)
- README, seção [Controles](../../README.md#controles)
