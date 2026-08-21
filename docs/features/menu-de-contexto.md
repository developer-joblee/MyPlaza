# Menu de contexto no avatar (botão direito)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Clicar com o **botão direito** num personagem — o seu ou o de outra pessoa —
abre um menu de contexto ao lado do cursor, com o nome de quem foi clicado
(bolinha da cor, nome, e o selo **você** no próprio).

Este doc é sobre o **caminho** — do clique no canvas do Pixi até um painel do DOM
no lugar certo, sobre a pessoa certa. Ele nasceu vazio de propósito, e hoje tem
um item: **chamar**, documentado em
[Chamar pelo menu de contexto](chamar-e-ir-ate.md). No próprio avatar não há ação
ainda, e aí o painel mostra "Nenhuma ação sobre você por enquanto." — um painel
completamente vazio pareceria quebrado.

## Como funciona

**Esta é a primeira e única interatividade do PixiJS no projeto.** Todo o resto
da entrada é teclado, escutado na `window` por `client/src/game/input.ts`, e a
roda do zoom é um listener de DOM no canvas. Quem for mexer em eventos daqui
para a frente tem **dois** sistemas para considerar.

O percurso tem três pedaços:

1. **`Avatar.setContextMenuHandler()`** liga o avatar ao sistema de eventos:
   `eventMode = 'static'`, `interactiveChildren = false` e uma `hitArea`
   explícita. Escuta `rightdown`.
2. **`Game.onAvatarRightDown()`** recebe o evento e chama
   `store.openContextMenu(id, e.client.x, e.client.y)`. Em paralelo,
   `Game.onContextMenu` suprime o menu do navegador no canvas.
3. **`AvatarContextMenu`** lê o store, resolve a pessoa no `roster` e desenha um
   `position: fixed` no ponto do clique, virando para dentro da janela quando
   perto da borda.

A ponte é o store (`client/src/state/store.ts`), como manda a arquitetura: o
Pixi não fala com React por outro canal.

### A `hitArea` é obrigatória, não otimização

Sem ela o Pixi testa o acerto pelos *bounds* do container — e o container do
player local inclui o **círculo de proximidade** (`PROXIMITY_RADIUS`, 5 tiles).
Clicar no vazio a cinco tiles de distância abriria o menu da pessoa. Com a área
explícita, o alvo é o corpo do boneco.

Ela é **derivada do sprite**, não escrita à mão:

```ts
const tex = this.frames.idle.down[0];
const w = tex.width * this.frames.scale;
const h = tex.height * this.frames.scale;
new Rectangle(-w / 2, FEET_Y - h * this.frames.anchorY, w, h);
```

Cada personagem tem sua escala e sua âncora (`sprites.ts` normaliza isso), então
um retângulo fixo descolaria no primeiro boneco com outra geometria.

### Eventos de movimento estão desligados

`app.init({ eventFeatures: { move: false, globalMove: false } })`. Clique é o
grupo `click`, que fica ligado; os de movimento saem porque cada `mousemove`
sobre o canvas dispararia um teste de acerto na camada de players, dezenas de
vezes por segundo, para responder uma pergunta que ninguém faz — nada aqui reage
a passar o mouse por cima.

### Quem ganha quando dois bonecos se sobrepõem

O que está desenhado **na frente**. Isso é de graça: a `playersLayer` tem
`sortableChildren` e o `zIndex` de cada avatar é o `y` dele, então a ordem de
desenho e a ordem de acerto são a mesma. Não há código para isso, e é por isso
que o clique nasce no Pixi e não num teste de distância feito à mão.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/game/Avatar.ts` | `setContextMenuHandler()` — `eventMode`, `hitArea`, `rightdown` |
| `client/src/game/Game.ts` | suprime o menu nativo, liga local e remotos, abre o menu, limpa no `destroy` |
| `client/src/ui/AvatarContextMenu.tsx` | o painel e seus itens |
| `client/src/ui/GameView.tsx` | renderiza o painel |
| `client/src/state/store.ts` | `contextMenu`, `openContextMenu`, `closeContextMenu` |
| `client/src/styles.css` | `.avatar-menu*` |

## Decisões e por quê

**O menu guarda só o `id`.** Nome e cor saem do `roster` na hora de desenhar. É
o que faz o menu **morrer sozinho** quando a pessoa sai do mundo — o id some do
roster e o componente se fecha — em vez de ficar apontando para quem não está
mais lá. Uma cópia do nome no store envelheceria, e o item **chamar** agiria
sobre um id morto.

**Estado de item vive no store, não no componente.** O painel desmonta ao fechar,
então qualquer coisa que precise sobreviver a reabrir o menu na mesma pessoa (o
"pressionado" do chamar, por exemplo) não pode ser `useState` — é a diferença em
relação ao cooldown do botão da lista do HUD, que vive no painel porque o painel
não desmonta.

**O `contextmenu` do navegador é suprimido no canvas inteiro**, não só sobre um
avatar. Metade das tentativas de clicar num boneco erra por alguns pixels, e ver
o menu do Chrome nessas é pior que não ver menu nenhum.

**O menu nativo e o nosso são independentes.** O `contextmenu` do DOM só faz
`preventDefault()`; quem abre o painel é o `rightdown` do Pixi, que sabe qual
boneco está na frente. Não há ordem entre os dois para dar errado.

**A posição é de viewport, e o painel é `fixed`.** `e.client.x/y` são px de
viewport; `.panel` é `absolute`. Sem o override o menu descolaria do cursor no
dia em que o `.game-view` deixasse de coincidir com a janela.

**Andar não arrasta o menu.** Ele pertence ao clique, não ao avatar. Reancorar
ao boneco exigiria converter mundo→tela a cada frame, e um menu que foge do
cursor é pior de usar que um que fica parado e fecha fácil.

**A roda fecha o menu.** O zoom move o mundo debaixo de um painel preso à tela:
em dois giros ele estaria sobre outra pessoa. Fechar é mais honesto que
reancorar.

**Sem animação**, ao contrário dos três popovers da barra. Um menu preso ao
cursor tem de aparecer instantâneo — e o `popover-in` nem serviria, porque
carrega o `translateX(-50%)` da centralização deles. Por isso este painel também
**não** entra na lista de `prefers-reduced-motion`: não há o que reduzir.

**O clique direito vale também no próprio avatar.** Custa nada (é o mesmo
handler, com o id lido do store) e é onde ações sobre si mesmo caberiam
naturalmente depois.

## Armadilhas

- **`eventMode` nasce `'passive'`.** Nenhum listener dispara sem
  `eventMode = 'static'`. Se um dia alguém "limpar" essa linha, o menu para de
  abrir **sem erro nenhum**.
- **Querer *hover* depois exige religar `eventFeatures.move`.** Sem ele não
  existe `pointerover`/`pointerout`, e o sintoma é "o hover não funciona e não
  dá erro".
- **O id do player local é o `socket.id`, que muda a cada reconexão.** Por isso o
  handler lê `selfId` do store **no momento do clique**, em vez de capturar o id
  quando é criado.
- **WASD continua andando com o menu aberto.** O painel não tem
  `data-capture-keys` porque nenhum item tem campo de texto (o `chamar` é um
  botão). É aceitável hoje (o menu é transitório e não se move com o avatar) e
  vira problema **no primeiro item com input** — nesse dia, o atributo entra,
  como no menu de configurações.
- **`hitArea` não acompanha a pose.** Ela é o retângulo do sprite de pé. Sentado
  ou ausente o boneco ocupa área parecida, então na prática não incomoda — mas
  se alguém adicionar uma pose bem maior, a área não cresce junto.
- **O balão de cochicho da booble fica meio fora da área clicável.** Ele é filho
  do mesmo container (`BoobleWhisper`, `x ∈ [6, 24]`) e a `hitArea` vai só até
  `x = 16`: clicar na metade direita do balão não abre o menu. As duas features
  chegaram juntas e nenhuma sabia da outra — registrado em `PENDENTES.md`, à
  espera de alguém ver na tela para decidir se o balão deve ou não ser alvo.

## Como testar

`npm run dev`, duas abas no mesmo mundo (o roteiro do item **chamar** está no
[doc dele](chamar-e-ir-ate.md)):

1. Botão direito **no seu boneco** → menu com o seu nome e o selo **você**.
2. Botão direito **no boneco do outro** → menu com o nome dele.
3. Botão direito **no chão** → nada abre, **e o menu do navegador não aparece**.
4. Botão direito a ~5 tiles do seu boneco, dentro do círculo de proximidade →
   **não** abre (é a `hitArea` fazendo o trabalho).
5. Clicar fora, `Esc`, girar a roda e redimensionar a janela fecham.
6. Clicar bem na borda direita/inferior → o menu vira para dentro da tela.
7. A outra aba **sai do mundo** com o menu aberto sobre ela → o menu fecha
   sozinho.
8. Dois bonecos sobrepostos → abre o da frente.

## Não verificado

**Nada disto foi aberto num navegador** — está tudo em `PENDENTES.md`. O que
está confirmado é `npm run typecheck` (server + client) e `npm run build` do
client limpos, que é o que valida a API do Pixi v8 usada aqui pela primeira vez
(`FederatedPointerEvent`, `Rectangle`, `eventFeatures`).

Com a chegada do item **chamar**, a pendência "o menu não tem itens" deixou de
existir; a do balão de cochicho fora da `hitArea` continua aberta.

## Relacionado

- [Menu de configurações](configuracoes-no-jogo.md) — o outro painel novo da
  sessão, e de onde veio a receita de fechar em Escape/clique fora
- [Chamar pelo menu de contexto](chamar-e-ir-ate.md) — o primeiro (e por
  enquanto único) item
- [Booble](booble.md) e [Chamado de quem está ausente](chamado-ausente.md) — as
  ações que ainda vivem na lista do HUD, e as candidatas naturais a virar item
  aqui
- README, seção [Controles](../../README.md#controles)
