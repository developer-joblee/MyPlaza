# Pendências de verificação

O que **não foi verificado** (ou foi verificado só parcialmente). Atualizado em
2026-08-21.

---

# Booble no menu de contexto, valendo de qualquer distância — 2026-08-21

Mudança em duas features que já existem: [`booble.md`](docs/features/booble.md) e
[`menu-de-contexto.md`](docs/features/menu-de-contexto.md). O botão
`booble`/`entrar` **saiu da linha do roster** (canto superior esquerdo) e virou o
primeiro item do menu de contexto do boneco (**botão direito** no avatar). Na
lista ficou só o selo violeta `booble`, que é status.

E o clique passou a valer **de qualquer distância**: de longe ele não pede a
booble, cria uma **intenção** (`store.pendingBooble`) e manda o avatar caminhar
até lá pelo mesmo `AutoWalk` do "ir até"; a booble abre na chegada. Andar, clicar
no chão (esquerdo) ou o **Cancelar** do aviso desistem.

**Nada em `shared/`, nada no protocolo do Socket.IO, nada no servidor** — a regra
de filiação continua inteira em `World.joinBooble`. Sete arquivos de client:
`ui/AvatarContextMenu.tsx`, `ui/Hud.tsx` (ficou menor), `ui/Notices.tsx`,
`booble.ts`, `state/store.ts`, `game/Game.ts`, `game/AutoWalk.ts`, mais
`styles.css`.

> **Atenção para quem mexer no "ir até":** o `AutoWalk` agora é compartilhado
> pelas duas features, e a booble depende de `STOP_RADIUS === BOOBLE_JOIN_RADIUS`.
> Ver [`chamar-e-ir-ate.md`](docs/features/chamar-e-ir-ate.md).

## Já verificado

- `npm run typecheck` (server + client) limpo.
- `npm run build -w client` limpo.
- **A chegada e a intenção, em script `tsx`: 25/25.** `AutoWalk` instanciado
  direto contra um grid falso, com a máquina de estados de
  `Game.resolvePendingBooble` replicada. Casos: alvo parado (chega e abre), **alvo
  andando** (a corrida), `cancel()` no meio (não abre), alvo saindo do mundo (não
  abre), chegada antiga contra alvo novo (não abre), e `start()`/`cancel()`
  zerando `arrivedAt`. Um dos casos mede também **o que a regra anterior faria** e
  reproduz **a aritmética do servidor** (distância na chegada + atraso de um tick
  contra `BOOBLE_JOIN_RADIUS`) e confirma que a conta estouraria sem o
  `STOP_MARGIN` — mexer nele ou no `TICK_RATE` quebra o teste em vez de quebrar a
  feature em silêncio. Receita e as duas armadilhas de escrever esse script em
  [`booble.md`](docs/features/booble.md#a-chegada-e-a-intenção-sem-navegador-foi-o-que-se-fez--2323).
- **Três defeitos corrigidos, os dois últimos com a feature já na tela do
  usuário:**
  1. cumprir a intenção a partir de `boobleReachIds` (recalculado no fim do tick)
     perdia quem estava sendo perseguido *andando*;
  2. **o pedido saía com a posição atrasada** — a posição vai ao servidor a
     `TICK_RATE` (15/s), e `World.joinBooble` confere o raio com a posição que ELE
     tem, recusando em silêncio. Foi o "cheguei perto e a booble não abriu"
     relatado. Agora a chegada **fura o throttle**: `move` primeiro,
     `booble:join` depois;
  3. **a caminhada parava na borda do raio** — a posição do *alvo* também está
     atrasada, e se ele vem na sua direção o servidor o vê mais longe. Entrou
     `STOP_MARGIN` (meio tile) no `AutoWalk`.

  Os três eram invisíveis: nada falha, nada loga, o servidor só recusa em
  silêncio.
- Por leitura de código: `boobleReachIds` continua vindo do `Game` (distância +
  zona), então `requestBooble` decide perto/longe também **sem LiveKit**.
- Por leitura de código: os impedimentos do item espelham as recusas de
  `World.joinBooble` (mesma booble, eu ausente, alvo ausente, booble cheia). A
  distância deixou de ser impedimento de propósito, e a **zona** passou a ser
  conferida só no servidor.

## Falta verificar (em ordem de importância)

1. **Nada disto foi aberto num navegador.** Tudo abaixo é observação por fazer.
2. **O caminho principal:** encostar em alguém, botão direito no boneco dela,
   `booble` → a booble se forma (círculo violeta, balão de cochicho, selo na
   lista, aviso do topo).
3. **`entrar na booble`:** o rótulo muda para quem já tem booble, e o clique
   entra na dela (saindo da sua, se você tinha uma).
4. **O estado `na sua booble`:** botão direito em quem já está com você → item
   violeta e desabilitado, com o motivo no `title`. É o CSS novo
   (`.avatar-menu-item.on-booble:disabled`), e é o único visual inédito da
   entrega — a opacidade de 0.85 pode não ser suficiente para não ler como
   bloqueio.
5. **A CAMINHADA — o defeito relatado foi aqui, e a correção não voltou para a
   tela.** Clicar em `booble` em quem está longe → o menu fecha, o avatar anda, o
   aviso *"Indo até X para abrir uma booble"* aparece, e a booble **abre na
   chegada**. Repita umas cinco vezes: a falha original era intermitente (dependia
   de onde caía o tick de envio de posição), então uma tentativa boa não prova nada.
6. **Os três cancelamentos, um por vez:** `WASD`, **clique esquerdo no chão** e o
   **Cancelar** do aviso. E o que **não** cancela: botão direito em outro boneco.
7. **Perseguir alguém andando**, nas **duas** direções: o alvo fugindo e o alvo
   vindo ao seu encontro. A segunda é a que o `STOP_MARGIN` existe para cobrir. O
   script cobre a aritmética; falta ver na tela.
8. **Trocar de destino** no meio do caminho (clicar em `booble` em outra pessoa) e
   **reabrir o menu** no destino (o item vira `cancelar`, violeta).
9. **Atravessar a porta:** alvo dentro da sala de reunião do Estúdio, você fora →
   o BFS entra pela porta e a booble abre na chegada (mesma zona).
10. **O prazo de 20s** com o alvo fugindo, e o alvo **saindo do mundo** no meio do
    caminho: os dois têm de tirar o aviso da tela sem abrir booble.
11. **Sentado** clicando em `booble` em alguém longe: levanta e vai.
12. **O caso exótico que hoje é um clique sem efeito:** estar a 2 tiles de alguém
    **através da parede** de uma sala fechada. O `AutoWalk` desiste na hora (mede
    distância crua) e o servidor recusaria pela zona — o sintoma é "cliquei e nada
    aconteceu". Decisão consciente; se incomodar na prática, é aqui que se mexe.
13. **Os impedimentos restantes, cada um na tela:** alvo ausente, você ausente,
    booble cheia (essa exige 8 pessoas — provavelmente não dá para ver).
14. **A lista não tem mais botão nenhum de booble** — e o selo continua aparecendo
    nas linhas de quem está com você, com a precedência `ausente > booble > voz`
    intacta.
15. **Altura estável do menu:** os dois itens aparecem sempre, perto ou longe.
16. **A `hitArea` e o balão de cochicho.** Já era pendência do menu de contexto
   (`BoobleWhisper` vai até `x = 24`, a `hitArea` até `x = 16`), e ficou mais
   relevante: agora se clica com botão direito justamente em quem está numa
   booble. Falta ver se acertar o boneco é confortável nesse caso.
17. **Sem LiveKit** (`LIVEKIT_*` vazias): a booble tem de se formar, perto e depois
    de caminhar. Verificado só por leitura.
18. **Zoom mínimo:** com o boneco pequeno, acertar o clique direito nele.

# Chamar pelo menu de contexto ("pin" e "ir até") — 2026-08-21

Feature nova: [`docs/features/chamar-e-ir-ate.md`](docs/features/chamar-e-ir-ate.md).
Primeiro item real do menu de contexto: um interruptor que acende um alerta na
tela de quem está **presente**, com "Ir até" que faz o avatar **caminhar sozinho**
até quem chamou. Toca `shared/` (quatro eventos + `CALL_COOLDOWN_MS`),
`server/src/handlers.ts` e bastante client — inclusive a **primeira navegação
automática** do projeto.

## Já verificado

### O servidor, de verdade (headless em :3099, Supabase e LiveKit desligados)

Script de quatro sockets no molde do `smoke-test.mts`, cenário Estúdio. **15/15**:

- o chamado chega **só** no alvo, com id, nome e `on: true`, e **não** em
  terceiros do mesmo mundo;
- **cooldown por par**: o segundo pin dentro de `CALL_COOLDOWN_MS` é recusado em
  silêncio; e ele é **por par** — outro alvo passa na hora, outro remetente
  alcança o mesmo alvo na hora;
- **apagar (`on: false`) não passa pelo cooldown**;
- **alvo ausente recusado**, e o "toc-toc" para o mesmo alvo continuando a passar
  (os dois canais convivem);
- **isolamento entre mundos**, nos dois eventos (chamado e resposta);
- lixo não derruba socket nenhum: alvo vazio, eu mesmo, inexistente, `null`, e
  `on` não-booleano;
- a **resposta** chega em quem chamou com nome e `accepted`, não chega em
  terceiros, e a **recusa** (`accepted: false`) também chega — é ela que
  despressiona o botão;
- chamar quem já **saiu** não entrega nada e não derruba nada.

Depois, um teste dirigido de 3 casos com **par limpo** (nenhum chamado anterior
entre os dois, então nenhum cooldown pode explicar a recusa pelo motivo errado) —
e ele **pegou um defeito**, já corrigido: `on: false` era barrado quando o alvo
estava ausente, então o alvo que ficasse ausente com um chamado no ar prendia o
alerta na tela e o cancelamento nunca chegava. Agora a guarda de ausência vale só
para acender.

### O `findPath`, contra o mapa real do Estúdio (10/10)

É a parte nova de verdade, e é função pura — foi chamada direto, com uma grade
montada do ASCII pelo `parseMap`/`isSolid` do `shared` (sem Pixi, sem navegador):

- acha rota do open space até dentro da **sala de reunião** (a que tem uma porta
  de 2 tiles), e no sentido inverso;
- **cada trecho** da rota está livre, amostrado a 1/8 de tile — o que valida o
  corte de canto, que é onde um bug atravessaria parede;
- nenhum ponto amostrado cai em tile sólido (ou seja: passou pela porta);
- alvo em tile **sólido** (cadeira) termina num tile **livre** e adjacente;
- alvo **inalcançável** devolve rota sem lançar;
- alvo no próprio tile devolve rota vazia;
- o corte de canto de fato reduz a contagem de waypoints (não é escadinha).

### Regressão e compilação

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ **`smoke-test.mts` 14/14** contra o servidor headless — importa porque
  `shared/` mudou.
- ✅ `grep -rn "\.emit(" client/src | grep -v "client/src/net/"` continua vazio.

Os scripts de teste rodaram da raiz e **não** ficaram no repo.

## Falta verificar (em ordem de importância)

### 1. Nada foi visto num navegador — e metade da feature é interação

`tsc` não prova nenhuma das perguntas que importam:

- **a caminhada em si.** O `AutoWalk` nunca rodou dentro do `requestAnimationFrame`
  do Pixi. O `findPath` está exercitado, mas a integração (vetor por frame,
  consumo de waypoint, `WAYPOINT_EPS` de 4px) não: os sintomas possíveis são o
  avatar oscilando em torno de um waypoint, travando num canto, ou chegando e não
  parando;
- **o repath de 500ms com o alvo andando.** É a decisão do usuário (perseguir), e
  é a que pode ler mal na tela: a rota trocando no meio do trajeto pode fazer o
  avatar mudar de direção de um frame para o outro, sem transição;
- **o prazo de 20s** nunca venceu;
- **o pin nunca foi ouvido.** Mesmos riscos do `knock.ts` (item 2 da seção do
  chamado-ausente): o `AudioContext` pode nascer suspenso e o `resume()` ser
  recusado, porque o som **não** vem de um gesto do usuário. Aqui o alerta visual
  é o canal principal, então o pior caso é silêncio — mas os valores (`PEAK` 0,11,
  880→1320 Hz, 95ms) foram escolhidos por cálculo, não por ouvido;
- **o alerta e o item do menu**, inteiros: o cartão, o "×", o "Ir até", o
  pressionado mint, o desabilitado por ausência e por cooldown, e o `setTimeout`
  que reabilita o item quando o cooldown vence.

### 2. A coluna nova do canto superior direito mexeu em layout que já existia

`.top-right-stack` tirou o `position/top/right` do `.zoom-controls` e do
`.screens`, que antes eram ancorados **os dois** no mesmo ponto e se sobrepunham
quando alguém compartilhava tela. Isso é correção, mas não foi vista:

- o zoom continua onde estava? (é o primeiro item da coluna, então deveria);
- as prévias de tela descem quando há alerta, sem ficar por baixo dele?
- a **tela ampliada** (`.screen-focus`, `fixed; inset: 0; z-index: 20`) agora é
  filha da coluna. Ela continua cobrindo a janela **porque a coluna não tem
  `z-index`** — se alguém adicionar um ali, a tela ampliada fica presa no
  contexto de empilhamento novo. O raciocínio está no comentário do CSS e do
  `GameView`, mas ninguém abriu uma tela ampliada depois da mudança.

### 3. O `knock.ts` foi refatorado e o toc-toc não foi ouvido depois

O padrão (frequências, `REPEATS`, `CYCLE_S`, `PEAK`) é idêntico, e o `busyUntil`
continua por módulo. O que mudou é o `AudioContext`, agora **compartilhado** com o
pin via `ui/sfx.ts` — o que é o que o próprio comentário do arquivo pedia. Mas o
toc-toc já estava na lista de "nunca foi ouvido", e continua.

### 4. Cancelamentos da caminhada, um por um

Só o "tecla de movimento cancela" é óbvio no código. Não foram exercitados:

- **`E` no meio do trajeto** (sentar cancela — o `sittingChanged` com
  `local.sitting` verdadeiro);
- **começar a caminhada sentado**: a auto-caminhada entra na condição de levantar
  em `LocalPlayer`, então deveria levantar e sair andando;
- **começar ausente**: `Game` cancela o ausente quando o `autoAxis` existe. Sem
  isso o avatar andaria com o celular na mão. É uma linha, e é raciocínio;
- **o alvo saindo do mundo no meio do trajeto** (`walkTargetPos()` devolve `null`
  → `AutoWalk` desiste). Não observado com queda real.

### 5. Duas caminhadas em sequência, e a câmera

Aceitar um chamado enquanto já se caminha para outro simplesmente troca o alvo
(`start` sobrescreve). Ninguém testou, e não há aviso na tela de que a primeira
foi abandonada. A câmera segue o player local, então ela acompanha — mas em zoom
mínimo, com trajeto longo, ninguém olhou como isso lê.

### 6. Custo do BFS não medido

Roda no clique e a cada 500ms enquanto se caminha, sobre até 4060 tiles (Ruínas),
com um `Map` de strings como visitados. Em teoria é sub-milissegundo; não foi
medido, e o `Map<string>` é a escolha que pagaria caro primeiro se algum dia
houver mapa muito maior (a alternativa é um array plano indexado, que exige expor
`cols`/`rows` do `TilemapBase`).

### 7. O cenário Ruínas nunca foi testado com o pathfinder

O `findPath` foi exercitado contra o **Estúdio**. As Ruínas são 58x70 com muros em
U e vãos estreitos, e é o cenário onde uma rota ruim apareceria primeiro. Nada
indica problema (o BFS é ótimo em passos), mas o corte de canto em corredor
estreito é o candidato a surpresa.

### 8. Não há trilha no banco

`presence:call` não grava nada — nem quem chamou, nem quem aceitou. Mesma escolha
do `presence:nudge` e da booble. Se um dia "quem chama e ninguém vai" virar
métrica, vai faltar dado.

### 9. O servidor não valida o `callAnswer`

Como ele não guarda os chamados (decisão registrada no doc), um cliente adulterado
pode mandar `presence:callAnswer` para alguém que nunca o chamou. O efeito máximo
é despressionar o item do menu daquela pessoa e mostrar "está vindo" — não abre
acesso a nada e não revela posição. Fica anotado porque é uma escolha, não um
descuido.

### 10. Chamar a si mesmo não existe, e o próprio avatar não tem ação

O item não aparece no próprio boneco (o painel diz "Nenhuma ação sobre você por
enquanto"). É escopo, não pendência.

---

# Menu de contexto no avatar (botão direito) — 2026-08-21

Feature nova: [`docs/features/menu-de-contexto.md`](docs/features/menu-de-contexto.md).
Clique direito num personagem abre um menu ao lado do cursor. **Ele está vazio
por pedido** — o que a entrega constrói é o caminho clique→store→painel. Entrega
só de client; nada mudou em `server/`, `shared/` ou `db/`.

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
  Importa mais que de costume: é a **primeira vez** que o projeto usa a API de
  eventos do Pixi (`FederatedPointerEvent`, `Rectangle`, `eventFeatures`), e o
  `tsc` é o único juiz que rodou.
- ✅ `grep -rn "\.emit(" client/src | grep -v "client/src/net/"` continua vazio.

## Falta verificar (em ordem de importância)

### 1. Nada foi clicado num navegador — e aqui isso é quase tudo

A feature **é** uma interação. `tsc` não prova nenhuma das perguntas que
importam:

- o `rightdown` do Pixi chega? (`eventMode = 'static'` é o que o habilita, e a
  ausência dele falha **em silêncio**, sem erro no console);
- a `hitArea` acerta o boneco e **não** o vazio ao lado? O caso que ela existe
  para resolver é o passo 4 do roteiro: clicar a ~5 tiles do próprio avatar, de
  dentro do círculo de proximidade, **não** pode abrir o menu. Se abrir, os
  *bounds* estão vencendo e a área derivada está errada;
- o menu do navegador some de fato sobre o canvas?
- **dois bonecos sobrepostos**: deve ganhar o da frente. É raciocínio sobre o
  `sortableChildren` da `playersLayer`, não observação — precisa de duas pessoas
  no mesmo tile.

### 2. O posicionamento e o virar na borda

Todo o `useLayoutEffect` que mede o painel e o dobra para dentro da janela é
código não exercitado. O que pode estar errado sem o `tsc` notar: um frame com o
menu visível fora da tela antes de virar (o `visibility: hidden` inicial existe
para isso, e não foi visto); e o menu colado no cursor em vez de ao lado dele.

### 3. O CSS não foi visto

`.avatar-menu` é o **único** painel `fixed` do projeto (os outros são
`absolute`, herdado de `.panel`) e o único no `z-index` 42. Falta ver: se ele
fica de fato acima dos popovers da barra, se o nome comprido corta com
reticências como pedido, e se a caixa não fica larga demais para um menu.

### 4. O fechamento por roda e por saída da pessoa

Dois caminhos deliberados e nenhum observado: girar a roda fecha (o zoom moveria
o mundo debaixo de um painel preso à tela), e a pessoa **sair do mundo** com o
menu aberto sobre ela fecha sozinho — que é o ponto inteiro de o store guardar
só o `id` e resolver o resto pelo `roster`.

### 5. `eventFeatures: { move: false, globalMove: false }` mexeu no app inteiro

É otimização deliberada (sem ela, cada `mousemove` sobre o canvas dispara teste
de acerto na camada de players) e **não foi medida** — nem antes nem depois.
Consequência registrada no doc: quem quiser *hover* algum dia precisa religar
`move`, e o sintoma de esquecer é "o hover não funciona e não dá erro".

### 6. WASD anda com o menu aberto

O painel não tem `data-capture-keys` porque não tem campo de texto. É a decisão
certa hoje e vira defeito **no primeiro item com input** — o menu de
configurações já mostra o que fazer nesse dia.

### 7. O balão de cochicho fica meio fora da área clicável

Nasceu do **merge** com o `db4c556` (balão de booble), não de uma decisão: as
duas features mexem no mesmo container do avatar e nenhuma das duas sabia da
outra. A `hitArea` do menu é a caixa do sprite (`x ∈ [-16, 16]`), e o balão fica
em `x ∈ [6, 24]` (`CX = 15`, `W = 18` em `BoobleWhisper.ts`) — então clicar com o
direito na **metade esquerda** do balão abre o menu e na **metade direita** não.

Nada quebra, mas é incoerente, e ninguém viu isso num navegador. As saídas
possíveis: alargar a `hitArea` quando há balão, ou aceitar que o alvo é o corpo
do boneco e nunca o balão (que é a leitura mais defensável — o balão é
informação, não alvo). Não mexi porque exige ver na tela para escolher.

### 8. O menu não tem itens — RESOLVIDO em 2026-08-21

O menu nasceu vazio por pedido. Ele ganhou o primeiro item (**chamar**) na
entrega registrada no topo deste arquivo — ver
[`docs/features/chamar-e-ir-ate.md`](docs/features/chamar-e-ir-ate.md). O item 6
acima (WASD anda com o menu aberto) **continua** valendo e continua aceitável: o
`chamar` é um botão, não um campo de texto.

---

# Menu de configurações no jogo — 2026-08-21

Feature nova: [`docs/features/configuracoes-no-jogo.md`](docs/features/configuracoes-no-jogo.md).
Engrenagem na barra inferior abrindo um menu com o mundo atual, o seu ID,
**adicionar alguém pelo ID sem sair do mundo** e o "Finalizar chamada" (que saiu
da barra). Entrega **só de client**: nada mudou em `server/`, `shared/` ou `db/`.

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ `grep -rn "\.emit(" client/src | grep -v "client/src/net/"` continua vazio —
  o menu fala com o servidor por `createLobbyApi(() => runtime.socket)`.
- ✅ **`smoke-test.mts` 14/14** contra o servidor headless em modo anônimo
  (`PORT=3001`, `SUPABASE_*`/`LIVEKIT_*` vazias). Nada de `server/` mudou, mas é
  barato.
- ✅ **A premissa da entrega, executada** (script de socket na raiz, 5/5,
  apagado depois): `lobby:addMember` e `lobby:list` **respondem no socket do
  jogo, depois do `join`** — mesmo motivo (`not-configured`) antes e depois de
  entrar no mundo, e nem o socket nem a sessão de mundo caem por causa deles (o
  `move` continua passando). Era o único jeito de a entrega estar *estruturalmente*
  errada, e não está: os handlers de lobby são alcançáveis de dentro do mundo.

  O que isso **não** prova: o caminho autenticado. Sem Supabase tudo para no
  `whoAmI` com `not-configured`, antes de qualquer verificação de token, papel ou
  escrita.

## Falta verificar (em ordem de importância)

### 1. O caminho de SUCESSO de `lobby:addMember` de dentro do mundo

Provado que o handler responde; **não** provado que ele adiciona alguém. Falta o
que exige Supabase: o token do handshake do socket do **jogo** sendo aceito pelo
`verifyAccessToken` do lobby, o `manageableWorld` reconhecendo o papel, e a
escrita de `addMemberToWorld`. Se o token não chegar como se espera, o sintoma é
o menu mostrando "Sua sessão expirou" em vez de adicionar. Roteiro nos passos 1 a
4 do doc.

Agravante: a escrita de `addMemberToWorld` **também** nunca foi confirmada pelo
lobby (já registrado na seção de autenticação deste arquivo). Falhando aqui,
convém separar as duas causas testando o mesmo ID pelo lobby antes.

### 2. Nenhuma tela foi aberta num navegador

Todo o `SettingsMenu` é lógica de client não exercitada: o popover abrindo, o
fechamento por Escape/clique fora/`×`, o foco voltando para a engrenagem, a linha
do mundo, o "Copiado" por 2s, a mensagem de sucesso, a de erro, e o campo
desabilitado até `isProfileId` passar. A barra também não foi vista sem o
telefone.

Dois riscos específicos:

- **`data-capture-keys`**: sem ele, colar o uuid faz o avatar andar. O atributo
  está no painel, mas isso só se prova digitando.
- **O `pointerdown` em fase de captura**: é o que impede o canvas do Pixi de
  engolir o clique de fora. Copiado do `AudioSettings`, que também nunca foi
  observado fechando.

### 3. O CSS não foi visto

`.settings-popover` reusa a ancoragem do `.audio-popover` (`bottom: 96px`,
centrado na pílula) e a largura do `.soundboard-popover`. O que pode estar
errado e o `tsc` não pega: o uuid de 36 caracteres estourando o `.join-input`
mesmo com a fonte reduzida; o painel ficando alto demais com as duas seções
abertas ao mesmo tempo (não há `max-height` nem rolagem); e o `.join-hint`
realinhado à esquerda por override — se a especificidade não vencer, o texto
volta a ficar centralizado.

### 4. O caminho de `member` e o modo anônimo

Os dois são condicionais de render (`canAdd`, `myId`) e não foram exercitados.
O caso `member` depende de `worlds` estar no store com o `myRole` certo — e
`worlds` é a foto do lobby, que pode estar velha (registrado como armadilha no
doc).

### 5. `copyText` e `REASON_TEXT` mudaram de lugar

`LobbyScreen` passou a importá-los em vez de declará-los. Compila e o
comportamento é o mesmo, mas **o lobby não foi reaberto** depois da extração — em
particular o caminho de falha do `copyText` (contexto não seguro), que já estava
na lista de não verificados antes desta entrega.

---

# Soundboard gamificado — 2026-08-21

Feature nova: [`docs/features/soundboard.md`](docs/features/soundboard.md). Sons
curtos do próprio usuário, liberados por tempo na plataforma
(`profiles.presence_seconds` + `PRESENCE_LEVELS`), guardados no **Supabase
Storage** (primeiro uso de Storage no projeto) e tocados em WebAudio para quem
está perto.

## Já verificado

### Sem banco

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ **`smoke-test.mts` 14/14** contra o servidor headless em modo anônimo
  (`PORT=3099`, `SUPABASE_*`/`LIVEKIT_*` vazias) — o crédito de presença novo
  roda no mesmo caminho do `join`/`disconnect` e, sem banco, tem de ser no-op.
- ✅ Teste dirigido de socket: os três eventos por ack respondem
  `not-configured`; evento **sem ack** não derruba o socket; `soundboard:play`
  com id malformado e com uuid inexistente é ignorado em silêncio, sem derrubar
  socket nenhum.
- ✅ **`audienceFor` contra o mapa real do Estúdio** (é o coração da entrega, e
  foi por isso que ela é função exportada e não método do handler): área aberta
  entrega só a quem está no raio; sala fechada não vaza para fora **e** entrega a
  quem está na sala mesmo além do raio (192px > 160px, porque dentro da sala o
  volume é plano); booble atravessa parede e distância; booble alheia não muda o
  meu alcance; id desconhecido devolve lista vazia; o emissor nunca entra na
  própria audiência.
- ✅ **Tabela de níveis**, 20 casos: fronteiras exatas de cada marco (59min→0,
  1h→1, 7h59→1, 8h→2 …), teto acima do último marco, e as entradas defensivas
  (negativo, `NaN`, `Infinity`) devolvendo **0 slots** — falha de leitura não
  vira slot de graça.

- ✅ **`clampVolume`**, 18 casos — e ela **pegou um defeito**: `Number(null)`,
  `Number('')` e `Number(false)` valem 0, então um valor ausente silenciava a
  pessoa em vez de cair no default de 70. O comentário prometia uma coisa e o
  código fazia outra; agora confere o `typeof` antes de converter, e o handler do
  servidor recusa o que não é número em vez de gravar 0.
- ✅ **`clampStart` e `peaks`** (a lógica do seletor de trecho), 15 casos:
  início respeitado no meio, recuado quando passa do fim (`duração - 5`), 0 para
  negativo/`NaN`, e áudio de 5s ou menos só permitindo início 0; picos usando o
  **máximo absoluto** por faixa (média de áudio tende a zero e desenharia uma
  linha reta), sem `NaN` quando há mais buckets que amostras.
- ✅ **`encodeWav`** (o recorte reescreve em WAV): 22 checagens de cabeçalho RIFF
  (magic, tamanhos, PCM=1, mono, sample rate, byte rate, block align, 16 bits) e
  da conversão float→int16 — monotônica, sem dar a volta no complemento de dois,
  com estouro **clampado** nos dois extremos (sem clamp, um som normalizado no
  talo viraria estalo). E 5s mono a 22,05 kHz = **215 KB**, dentro do
  `SOUND_MAX_BYTES` de 512 KB, que é o que torna o teto seguro.

Os scripts de teste rodaram da raiz e **não** ficaram no repo (só o
`smoke-test.mts`, que continua como estava).

## Corrigido no primeiro uso real (2026-08-21)

**O bucket recusava `audio/wav`.** O upload de um áudio que precisou ser
recortado falhava com `mime type audio/wav is not supported` no log e "upload
recusado: error" na tela. Causa: a `0010` foi aplicada **antes** de o recorte
existir, e o `insert into storage.buckets` dela é `on conflict do nothing` —
reaplicar a `0010` não atualiza a whitelist de um bucket que já existe. Pior, a
`0010` tinha sido **editada depois de aplicada**, o que é justamente o que o
`db/README.md` proíbe, e foi o que fez o banco divergir do repo.

Corrigido em três frentes: a `0010` voltou ao estado em que foi aplicada (arquivo
aplicado é história), a whitelist nova virou **`0011_soundboard_wav.sql`**, e o
`insertUserSound` passou a nomear essa causa no log em vez de deixá-la virar
`error` genérico — no mesmo espírito dos avisos de `42501`/`42P01` no boot.

## Falta verificar (em ordem de importância)

### 1. Nada foi executado contra um Supabase real

A `0010` **foi** aplicada (o erro do bucket acima é prova de que o caminho de
upload chegou ao Storage), mas a **`0011`** (whitelist do bucket) e a **`0012`**
(`soundboard_volume`) ainda não, e nenhum upload completou. Segue sem verificação: `insertUserSound` (upload no bucket + linha), `deleteUserSound`,
`listUserSounds` (inclusive o `createSignedUrls` em lote), `getUserSound`,
`loadPresenceSeconds`, `loadSoundboardPrefs`, `saveSoundboardVolume` e a RPC
`app_add_presence_seconds`. Roteiro completo em
"Como testar" no doc da feature.

Três pontos merecem atenção na primeira execução:

- **O bucket pode não existir.** O `insert into storage.buckets` exige
  privilégio no schema `storage`; se ele falhar, o resto da migração passa e só o
  upload quebra — com o erro aparecendo apenas como `[db] insertUserSound` no log
  (o `db.ts` é fail-soft). Confira em *Storage* que existe um bucket **privado**
  `soundboard`.
- **`insertUserSound` faz duas escritas sem transação** (arquivo, depois linha).
  A ordem foi escolhida para que a falha parcial deixe arquivo órfão — invisível
  e sobrescrito no próximo upload do mesmo slot — em vez de linha apontando para
  arquivo que não existe. Não foi provado interrompendo no meio.
- **A RPC nunca rodou.** `app_add_presence_seconds` é a única função nova do
  schema, e a única coisa neste projeto que usa `client.rpc()`. Se o nome ou a
  assinatura divergirem, o crédito falha em silêncio e ninguém ganha slot nunca —
  o sintoma seria "o tempo não sobe".

### 2. Nenhuma tela foi vista num navegador

Todo o `SoundboardPanel` é lógica de client não exercitada: a grade com slots
bloqueado/vazio/cheio, o `<input type=file>` escondido, a medição de duração com
`decodeAudioData`, as mensagens de recusa, o slot que acende enquanto o som toca,
a lista "Quem tocou som" e os dois mutes. O botão novo na barra inferior também
não foi visto — em particular o estado **desabilitado** em modo anônimo.

### 3. Nenhum som foi ouvido

O `SoundPlayer` nunca tocou nada. Riscos, na ordem: (a) o `AudioContext` nascer
suspenso e o `resume()` ser recusado porque o som de outra pessoa não vem de um
gesto do usuário — mesmo risco do `knock.ts`, e aqui **não há aviso visual de
reforço** para quem recebe, então o som simplesmente não sai; (b) `SOUND_PEAK`
(0,7) errado na prática, alto ou baixo demais ao lado da voz com AGC do LiveKit;
(c) o teto de `SOUND_MAX_CONCURRENT` (3) descartando som novo em vez de cortar o
antigo — nunca exercitado com três pessoas disparando junto.

### 4. O recorte e o seletor de trecho nunca rodaram

`decodeAudio`, `prepareSound`, `previewClip` e todo o `ClipPicker` **não podem**
ser testados fora do navegador: `AudioContext`, `OfflineAudioContext` e canvas não
existem no Node. O que foi verificado é a lógica pura (`encodeWav`, `clampStart`,
`peaks`). Falta ver, com arquivo de verdade:

- **o trecho salvo é o trecho escolhido** — um erro de offset aqui salva o começo
  do arquivo e ninguém percebe até ouvir;
- a onda desenhada: `devicePixelRatio`, as cores lidas do tema por
  `getComputedStyle` (canvas não herda `currentColor` — se a leitura falhar, as
  barras saem no fallback cinza), e o mínimo de 1px que evita buracos onde há
  silêncio;
- a janela de seleção acompanhando o slider sem descolar da onda;
- o slider pelo **teclado**, e o `stopPropagation` que impede as setas de andarem
  com o avatar ao mesmo tempo;
- a prévia: parar no meio, trocar o início enquanto toca, e fechar o painel
  tocando (o `useEffect` de cleanup é o que evita som órfão);

- que o `OfflineAudioContext` de fato **reamostra** (buffer a 44,1 kHz num
  contexto a 22,05 kHz) e **faz o downmix** de estéreo para mono ao pedir 1
  canal. As duas conversões são comportamento da spec, não código nosso — se
  algum navegador divergir, o sintoma é áudio acelerado ou só um lado da imagem
  estéreo;
- que `source.start(0, 0, seconds)` corta onde se espera (e não do fim, ou com
  offset trocado);
- que o fade-out de 40ms **elimina** o estalo do corte — é audível, não
  verificável por código;
- quanto tempo o corte leva para um mp3 grande (uma música de 5min decodificada
  inteira em memória antes de cortar: são ~50 MB de PCM para um mp3 de 5 MB). O
  painel mostra `busy`, mas ninguém mediu, e num arquivo muito grande pode dar
  uma pausa perceptível — ou estourar a memória da aba;
- o caminho de arquivo que **não é áudio** (`UndecodableAudioError` → "Formato
  não aceito"), incluindo o caso chato: arquivo com extensão de áudio e conteúdo
  corrompido.

### 5. O volume não foi visto persistindo

A `0012` não foi aplicada e nenhuma escrita em `soundboard_volume` aconteceu.
Falta ver:

- o valor **sobrevivendo ao recarregar** (é o ponto inteiro da feature: se a
  coluna não existir, o `db.ts` é fail-soft e o sintoma é o slider voltando a 70
  sem erro na tela);
- o **gain mestre** mudando o volume de um som **que já está tocando**, e sem
  clique (a rampa de 30ms é o que evita o clique, e isso é audível, não
  verificável por código);
- o **debounce**: arrastar o slider de ponta a ponta tem de gerar **uma** escrita,
  não dezenas. Contar no log (`[soundboard] setVolume`) é o jeito;
- fechar o painel **menos de 500ms** depois de mexer no slider — o `useEffect` de
  cleanup grava o pendente, e é o caminho mais provável na prática (abrir o painel
  só para baixar o volume e fechar);
- volume 0 pelo slider (o `start()` desiste antes de agendar nós) contra o mute
  rápido: são dois controles distintos e a tela precisa deixar isso claro;
- a **recusa de `invalid-input`** nunca executou. Sem Supabase tudo para em
  `not-configured` no `whoAmI`, que vem antes da validação — é a mesma situação já
  registrada para o papel no lobby.

### 6. O crédito de presença não foi observado gravando

O timer de 60s por socket, o `unref()`, o crédito do pedaço final no
`disconnect`, e o comportamento com **duas abas da mesma conta** (as duas
creditam, e é por isso que o incremento é RPC e não read-modify-write). Nada
disso rodou contra um banco. Também não há teto: quem deixa a aba aberta a noite
inteira acumula a noite inteira — pode ser exatamente o que se quer, mas é
decisão que ninguém tomou explicitamente.

### 7. Cooldown e recusas do `play` só foram vistos nos caminhos vazios

`SOUND_COOLDOWN_MS` e a recusa de "som que não é seu" / "slot que deixou de
estar liberado" exigem uma linha em `user_sounds` para serem alcançadas. O que
foi provado é que id inválido e inexistente não fazem nada.

### 8. A duração de 5s não é imposta pelo servidor

É decisão registrada no doc, não esquecimento: medir duração em Node exigiria
dependência nova. O limite duro é `SOUND_MAX_BYTES` (512 KB). Consequência
concreta: um cliente adulterado sobe 4s dizendo que são 500ms, e o efeito é um
número errado na legenda do próprio botão dele. Se um dia isso incomodar, o lugar
é uma checagem de duração no servidor — com dependência, e perguntando antes.

### 9. URL assinada vencendo no meio da sessão

`SOUND_URL_TTL_S` é 4h e o cliente cacheia o áudio por `soundId`, então quem já
baixou não sente. Quem **entra depois** de 4h recebe uma URL vencida no evento
`soundboard:played` (o servidor assina no `getUserSound`, a cada toque — então
na prática ela é nova; o caso ruim é a URL da lista, guardada no store desde a
abertura do painel). Nunca foi exercitado com sessão longa.

### 10. Nada é gravado sobre quem tocou o quê

Sem trilha no banco, por escolha — mesma decisão do `presence:nudge`. Se um dia
"quem mais toca som" virar métrica, ou se houver denúncia de abuso, não há dado.

### 11. Custo por disparo não medido

Cada `soundboard:play` faz **duas** consultas (o som e o tempo acumulado) mais
uma assinatura de URL no Storage, antes de emitir. O cooldown de 6s por pessoa
limita a frequência, e o `guard()` limita a espera a 2,5s — mas com muita gente
tocando ao mesmo tempo isso é trabalho de banco que a voz e o chat não fazem.
Dá para cachear a autorização por `soundId` no socket; não foi feito para não
cachear decisão de acesso antes de ver o custo real.

### 12. `soundSenders` guarda `socket.id`

Como os `nudges`, é identificador de exibição: quem cai e volta é uma pessoa
"nova" na lista, e o mute dela se perde. É o comportamento desejado (o mute é de
sessão), mas nunca foi observado com queda real.

---

---

# Booble (conversa paralela) — 2026-08-21

Feature nova: [`docs/features/booble.md`](docs/features/booble.md). Grupo ad-hoc
que prioriza áudio: dentro 100%, fora 7% nos dois sentidos. A filiação é do
servidor (raio, zona, teto); o volume é de cada cliente.

**Revisado no mesmo dia, depois do primeiro olhar do usuário:** os raios eram
grandes demais (entrar no raio audível de 5 tiles, sair só além de 6,5) e a
booble ficava pendurada atrás de quem já tinha saído da conversa. Agora é escala
de cochicho — **2 tiles para entrar, 3 para permanecer** — e o indicador virou um
**círculo dinâmico no chão em volta do grupo** (`game/BoobleRings.ts`), em vez de
uma pastilha por cabeça: o que importa numa booble é quem está com quem, e isso é
relação, não etiqueta.

## Já verificado

### `npm run typecheck` (server + client) limpo e `npm run build` do client OK.

### O servidor, de verdade (headless em :3099, Supabase e LiveKit desligados)

Script de sockets no molde do `smoke-test.mts`, cenário Estúdio. **25/25**:

- **criar**: A entra na booble de B → os dois recebem `player:booble` com o
  **mesmo** id, e o terceiro (de fora) também é avisado;
- **entrar**: C entra na booble existente — id igual, não uma segunda booble; e
  A **não** recebe evento novo, porque a booble dele não mudou;
- **sair**: `booble:leave` remove C e os outros dois **continuam** (2 não dissolve);
- **recusas, todas em silêncio**: alvo longe (> `BOOBLE_JOIN_RADIUS`), alvo
  ausente, alvo = eu mesmo, alvo inexistente, alvo vazio, e **alvo a 32px do
  outro lado da parede** (zona diferente barra a entrada). Nenhum socket caiu;
- **isolamento entre mundos**: quem está na Praça não alcança quem está no Estúdio;
- **quebra por distância**: o membro que andou para além de `BOOBLE_EXIT_RADIUS`
  é removido, é avisado, e os dois que ficaram seguem juntos;
- **atravessa a parede**: formada a booble na área aberta, entrar na sala de
  reunião **não** a quebra (zona muda, filiação não) — é a decisão central;
- **ausente sai da booble**, e quem sobrou sozinho é **dissolvido**;
- **queda**: `disconnect` dissolve a booble que ficaria com uma pessoa só;
- **teto**: 8 pessoas entram na mesma booble e a nona é recusada em silêncio.

E, sobre os raios novos (segunda rodada, 8/8):

- a invariante `entrar <= permanecer` vale, e permanecer < audível;
- entrar a **60px** (dentro de 2 tiles) forma; a **128px** — audível, mas longe —
  é **recusado**, que é a mudança pedida;
- afastar-se para **82px** (< 3 tiles) **não** remove, e para **122px** remove.
  Antes era preciso passar de 208px para sair.

### A regra de volume, sem navegador (16/16)

`audioVolumeFor` é função pura, então foi chamada direto. Cobre a **regressão**
(sem booble em jogo, tudo idêntico a antes: rampa, zona diferente = 0, sala =
plano), a booble atravessando zona e distância, os 7% nos **dois** sentidos,
booble alheia contando como "fora", `0.1 × 0 = 0` (a sala fechada não é furada) e
a **simetria exata** em cinco distâncias.

### No navegador, confirmado pelo usuário — 2026-08-21

"tudo funcionando", depois dos ajustes de raio e do círculo. **Eu não vi a tela**;
o que segue é o que essa confirmação necessariamente exercitou, não o que foi
conferido item por item:

- ✅ o botão **booble** aparecendo na linha de quem está ao alcance — o que
  exercita o `boobleReachIds` novo (perto + mesma zona, calculado no `Game`), e
  não o predicado do áudio;
- ✅ a booble se formando pelo clique e o `player:booble` chegando aos dois lados;
- ✅ **o círculo no chão**, que era o maior risco desta entrega: a geometria
  (`PAD`, `MIN_RADIUS`, `FLATTEN`) e a camada entre o mapa e os avatares. Nada
  disso se verifica por `tsc`;
- ✅ a atenuação sendo audível na prática — ou seja, `BOOBLE_OUTSIDE_VOLUME`
  não ficou inaudível ao ponto de a feature parecer quebrada, que era a dúvida
  registrada aqui. **Atenção: isso foi verificado com `0.1`**; o valor hoje é
  `0.07` (ver o item 0 abaixo);
- ✅ sair da booble no raio novo (3 tiles) sendo prático.

### Regressão

`smoke-test.mts` **14/14** contra o servidor headless. Importa porque
`PlayerState` ganhou um campo e o `world:snapshot` é posicional.

Os dois scripts de teste rodaram da raiz e foram apagados; o `smoke-test.mts`
continua como está.

## Falta verificar (em ordem de importância)

O caminho principal está confirmado. O que sobra são os cantos.

### 0. `BOOBLE_OUTSIDE_VOLUME` a 0,07 continua audível (2026-08-21)

O valor foi baixado de `0.1` para `0.07` a pedido do usuário. A verificação de
ouvido acima foi feita com `0.1`, então ela **não** cobre o valor atual. O ganho
é linear: 0,07 soa perto de −23 dB, ~3 dB abaixo do que já era baixo. Como ele
ainda multiplica a rampa de distância, quem está no limite do raio audível sai
praticamente inaudível através de uma booble — o que já era verdade antes, só
que agora um pouco mais cedo.

O que confirmar em duas abas: estando numa booble, a sala **continua perceptível**
(é a promessa da feature — 7% não pode ter virado 0 na prática). Se tiver, o botão
a girar é este único número em `shared/src/constants.ts`.

### 0.5. O balão de cochicho (2026-08-21) — nada disto foi visto na tela

Indicador novo por pessoa: três pontinhos violeta em onda dentro de um balãozinho
ao lado da cabeça de quem está numa booble (`client/src/game/BoobleWhisper.ts`).
`tsc` e `vite build` passam, e a geometria e a onda foram conferidas por
**cálculo** (os pontos ficam dentro do corpo do balão, a onda corre da esquerda
para a direita em 1,15s, as fases iniciais saem espalhadas). Nada disso é ver.

O que falta olhar, em ordem:

- **a posição do balão em cada personagem.** Ele usa coordenadas FIXAS
  (`CX = 15`, `BOTTOM = -26`), copiando a decisão da telinha do `AwayIndicator`,
  em vez de sair do `label.y` como a pastilha de ausente. Se algum boneco tiver a
  cabeça em outra altura, o balão encosta nela ou flutua solto. **Testar com mais
  de um personagem.**
- **o tamanho no zoom mínimo (0.5x).** O balão tem 18×11px de mundo e os pontos
  1,5px de raio. A 0.5x isso é ~9×5px com pontos de menos de 1px — pode virar
  borrão ou sumir. Era para ser "bem pequeno", mas invisível não serve.
- **legibilidade em grupo cheio.** Com 8 membros são 8 balões animando ao mesmo
  tempo perto uns dos outros. As fases estão espalhadas de propósito, mas se lê
  como poluição ou não, só olhando.
- **o balão sobre fundo claro e sobre fundo escuro** — o corpo é o mesmo
  `INK 0x181a22` a 85% do `AwayIndicator`, que já se provou, mas o contorno
  violeta a 55% é mais fraco que o âmbar a 55%.
- **`addRemote`**: abrir uma 4ª aba com a booble já formada e conferir que os
  balões aparecem de saída (é o caminho que o `setPlayerBooble` sozinho **não**
  cobre).
- **`whispering` batendo com `booble`** em `__togetherAvatars()` nas três abas.

### 1. Os detalhes visuais que o caminho principal não separa

"Funcionando" cobre o círculo aparecendo e acompanhando o grupo. **Não** separa:

- **duas boobles próximas**: círculos sobrepostos somando alpha podem virar uma
  mancha só, e aí perde-se justamente a informação que o círculo existe para dar
  (quem está com quem). Precisa de 4 pessoas em dois pares;
- **a booble de outra pessoa**, desenhada mais fraca (`OTHER_FILL`/`OTHER_STROKE`)
  — só aparece com uma terceira pessoa de fora olhando;
- **o crescimento** de 2 para 3 pessoas, que muda o raio de um frame para o outro
  sem transição: pode ler como salto;
- **zoom mínimo e máximo** sobre o círculo;
- o **"+N"** do aviso a partir de `BOOBLE_MAX_NAMES` (precisa de 4 na booble) e a
  precedência dos selos `ausente > booble > voz` na lista.

### 2. Sem LiveKit configurado

O botão passou a não depender do tick da voz exatamente para funcionar sem
LiveKit, e isso foi corrigido **por leitura do código**. A verificação do usuário
foi com voz ligada, então o caminho sem voz continua não observado. É o passo 11
do roteiro em "Como testar".

### 3. O teto de 16 subscrições nunca foi provocado

Duas coisas dependem dele e só importam com **mais de 16 pessoas audíveis ao
mesmo tempo** — situação nunca testada, porque exige 17 abas:

- membros da booble entram na frente do `slice(0, MAX_AUDIO_SUBSCRIPTIONS)`. É o
  caminho em que a booble falharia de forma silenciosa e difícil de diagnosticar:
  "sem stream" é silêncio, não volume baixo;
- o badge `voz` passou a exigir `audioWanted` além de volume audível, o que
  conserta um caso em que ele mentia **desde antes desta feature** (quem sobrava
  do teto aparecia como audível). A correção é por leitura do código, não por
  observação.

### 4. A tela compartilhada dentro de uma booble

O portão do vídeo passou a aceitar membro da booble (atravessando zona). Compila
e a lógica é o mesmo booleano do áudio, mas ninguém compartilhou tela através de
uma parede com alguém da mesma booble.

### 5. Custo do `evictFarBooble` por movimento não medido

Roda a cada `move` (15/s por pessoa) e sai na hora para quem não está em booble
nenhuma. Quando está, é O(membros ≤ 8). Irrelevante em teoria, não medido.

### 6. Reconexão no meio de uma booble

Quem cai e volta é um `socket.id` novo, logo sem booble — por desenho. Mas nunca
foi exercitado com queda real, e o outro lado recebe `player:left` seguido de um
`player:joined` sem booble; não foi observado se a pastilha some corretamente
nessa sequência.

### 7. Não há trilha no banco

`booble:join`/`leave` não gravam nada (nem quem esteve com quem, nem por quanto
tempo). Foi escolha — a booble é efêmera, como o chamado de ausente —, mas
`zone_visits` grava o equivalente para salas fechadas. Se um dia isso virar
métrica ("quanto do dia as pessoas passam em conversa paralela"), vai faltar dado.

### 8. `evictFarBooble` só olha quem se mexeu

A remoção é avaliada no `move` de quem andou. Se um dia existir teletransporte,
mudança de posição pelo servidor ou restauração de posição salva, esses caminhos
**não** passam por lá e uma booble poderia esticar pelo mapa.

# Vínculo com o mundo (o nome fica guardado) — 2026-08-20

Feature nova: [`docs/features/vinculo-com-o-mundo.md`](docs/features/vinculo-com-o-mundo.md).
O nome/cor/personagem de cada pessoa passam a ser gravados **por mundo** em
`presence_state` (migração `0009`), e o lobby entra direto no jogo quando esse
vínculo existe.

## Já verificado

### Contra um Supabase real, no navegador (2026-08-20)

A `0009` foi aplicada e **o caminho principal funciona**: sair da conta, entrar de
novo, clicar Entrar num mundo onde já se entrou antes e cair **direto no jogo**
com o nome guardado, sem tela de entrada. Isso exercita de uma vez as três coisas
novas que tocam o banco — `savePosition` gravando `display_name`/`avatar_color`,
a consulta de vínculo em `listWorldsFor`, e `ensureProfile` devolvendo a
aparência.

Com isso caem as três pendências que estavam no topo desta lista: "a migração não
foi aplicada", "nada da interface foi visto num navegador" (o caminho principal
foi) e "o caminho do logout, que é o pedido original".

### Sem banco

- `npm run typecheck` (server + client) limpo e `npm run build` do client sem
  erro.
- **`smoke-test.mts` inteiro: 14/14**, contra o servidor headless em modo anônimo
  (`PORT=3099` com as `SUPABASE_*`/`LIVEKIT_*` vazias no ambiente). Importa
  porque o `persistPosition(true)` novo na entrada roda no mesmo caminho e, sem
  banco, tem de ser um no-op silencioso — e é.
- **Teste headless do `store`**, cobrindo as seis transições que a feature
  introduz: prefill vindo do `setLobby`; mundo sem vínculo → tela de entrada com
  o prefill e o cenário do mundo; mundo com vínculo → **entra direto** com
  nome/cor/personagem guardados; "Editar" → tela preenchida; recusa
  (`place-full`) → tela de entrada com o motivo, sem loop; `leave()` mantendo o
  nome. O script rodou da raiz e **não** ficou no repo.

## Falta verificar (em ordem de importância)

Nada aqui bloqueia o uso — o caminho principal está confirmado. São os cantos.

> **Vale para qualquer outro ambiente (produção incluída):** a `0009` é
> obrigatória junto com este código. O upsert de posição passou a mandar
> `display_name`/`avatar_color`, e contra um banco sem essas colunas o Postgres
> recusa a escrita **inteira** (`42703`) — e como `db.ts` é fail-soft, o sintoma é
> silencioso e duplo: ninguém volta onde parou **e** nenhum vínculo é criado. Rode
> o passo 9 do [`db/README.md`](db/README.md) em cada banco.

### 1. Nome diferente em mundos diferentes

O desenho permite ser "Iago" num mundo e "Iago (cliente)" em outro (é o que
justifica o vínculo ser por mundo, e não por conta). Nunca foi provocado com dois
mundos de verdade — passo 7 do roteiro.

### 2. O botão **Editar** e a recusa na entrada direta

Trocar nome/cor/personagem num mundo que já tem vínculo (passo 6 do roteiro) e a
entrada direta sendo **recusada** (`place-full`, `place-restricted`) e caindo na
tela de entrada com o motivo. O segundo caso foi provado no teste headless do
store, nunca no navegador.

### 3. Linha antiga de `presence_state`

Quem já entrava antes da `0009` tem `display_name` nulo e deve ser perguntado
**uma** vez. O filtro (`not display_name is null`) nunca rodou contra uma linha
dessas.

### 4. A consulta a mais no lobby não foi medida

`listWorldsFor` fazia 4 consultas e agora faz 5, filtrando em JS. Continua fora
do caminho quente e continua sem medição — igual ao que já estava anotado para a
entrega do lobby.

### 5. `LobbyState.me` cacheado por socket

Hoje é seguro porque trocar de aparência exige entrar num mundo, e entrar fecha o
socket do lobby. Se o lobby ganhar socket persistente, esse valor envelhece — não
há teste que perceba isso.

---

# Indicador visual de ausente (feed + pastilha) — 2026-08-20

Ver [`docs/features/modo-ausente.md`](docs/features/modo-ausente.md). Camada
visual nova em cima do modo ausente, que já existia: a mini-tela com o feed
rolando ao lado da cabeça e a pastilha **ausente** acima do nome.

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ Por leitura do código: local, remotos e quem **entra depois** passam todos
  por `Avatar.setAway` (`Game.setSelfAway`, o handler de `player:away` e o
  `spawnRemote` do `world:snapshot`), então os três casos estão cobertos sem
  caminho novo. Nada em `shared/` nem no protocolo do Socket.IO mudou.

## Falta verificar (em ordem de importância)

### 1. Nada foi visto num navegador
Todo o indicador é desenho em Pixi, e desenho não se verifica por `tsc`. O que
pode estar errado e o compilador não pega:

- **A máscara do feed.** Ela é irmã do container (as coordenadas do `feed` estão
  deslocadas) e precisa estar na árvore de exibição para valer no Pixi v8. Se
  não valer, os cards aparecem **fora** da telinha, subindo pelo mapa.
- **Posição e escala.** Os números (`SCREEN_X = 15`, `SCREEN_TOP = -30`) foram
  derivados da geometria do sprite (16×32 a 2x, pés na borda de baixo), não
  olhados: a telinha pode encostar no corpo, ou brigar com um nome comprido.
- **A pastilha.** A altura sai de `label.height`, medido em runtime — se o
  `Text` do Pixi medir diferente do esperado, ela pode sobrepor o nome.
- **O loop do feed.** `offset % CARD_PITCH` com 4 cards deveria ser contínuo;
  uma emenda visível a cada ciclo é o sintoma de a conta estar errada por um card.
- **Zoom.** O indicador vive em coordenadas do mundo. Em zoom mínimo o texto
  "ausente" (9px) pode ficar ilegível — nesse caso, ou cresce, ou some abaixo de
  um limiar de zoom.

O roteiro completo está em "Como testar" no doc da feature — `npm run dev`, duas
abas (e uma terceira para o caso do `world:snapshot`).

### 2. Custo por frame não medido
Cada avatar ausente reposiciona 4 `Graphics` por frame e mantém uma máscara
(uma passada de render a mais). Irrelevante para uma equipe; não medido com
muita gente ausente ao mesmo tempo.

---

# Chamado de quem está ausente ("toc-toc") — 2026-08-20

Feature nova: `docs/features/chamado-ausente.md`.

## Já verificado

### O servidor, de verdade (headless, modo anônimo em :3099)

Script de quatro sockets no molde do `smoke-test.mts`, contra o servidor rodando
com Supabase e LiveKit desligados. Passou em tudo:

- chamado chega **só no alvo**, com o `socket.id` e o nome de quem chamou;
- **chamar quem está presente é recusado** (o alvo tem de estar ausente);
- **cooldown por par**: o segundo clique dentro de `NUDGE_COOLDOWN_MS` não passa;
- o cooldown **não é global**: outro remetente do mesmo mundo passa na hora;
- **isolamento entre mundos**: quem está em outro cenário não alcança o alvo;
- alvo inexistente, alvo vazio e chamar a si mesmo são ignorados sem derrubar
  socket nenhum;
- quem **voltou** de ausente para de receber chamado.

Também: `npm run typecheck` (server + client) limpo e `npm run build` do client
sem erro. O script de teste ficou fora do repo (rodou da raiz e foi apagado; o
`smoke-test.mts` continua como está).

## Falta verificar (em ordem de importância)

### 1. Nada da interface foi visto num navegador

Tudo abaixo é lógica de client que **não** foi exercitada: o botão **chamar** na
linha de quem está ausente, o aviso `.notice.nudge` na pilha, o texto no plural
("Ana e Bruno estão te chamando"), o "+N" a partir de `NUDGE_MAX_NAMES`, o botão
**Voltar**, o dispensar (`×`) e o estado "chamado" do botão por 15s. O roteiro
está em "Como testar" no doc da feature — `npm run dev`, duas abas.

### 2. O "toc-toc" nunca foi ouvido

`client/src/ui/knock.ts` sintetiza o som em WebAudio (~2,5s: quatro ciclos de
duas batidas) e nunca rodou num navegador. Riscos: (a) o `AudioContext` nascer
suspenso e o `resume()` ser recusado porque o chamado não vem de um gesto do
usuário — nesse caso o aviso visual continua, mas o som não toca, e é justo o
canal que serve para quem está olhando outra janela; (b) volume/timbre errados
na prática (`PEAK` = 0,14); (c) o padrão de 2,5s pode soar insistente demais no
uso real — `REPEATS` e `CYCLE_S` são os dois números para ajustar; (d) a trava
`busyUntil` (chamado novo durante o som não redispara) nunca foi exercitada com
duas pessoas chamando quase junto.

### 3. Reconexão no meio de um chamado

Se o socket do alvo cair e voltar, ele é um `socket.id` novo — o `nudgedAt` do
remetente ainda tem o id antigo, então um chamado novo passa na hora (o que é o
comportamento desejado), mas nada disso foi exercitado com queda real.

### 4. Chamado com o alvo em outra aba congelada

Aba em segundo plano pode ter o timer estrangulado pelo navegador e o socket
caído por `ping timeout` (é o que o log de `disconnect` já mostrava). Se o alvo
tinha caído, o chamado simplesmente não chega e quem chamou não sabe — por
desenho, mas nunca foi observado.

### 5. Não há trilha no banco

`presence:nudge` não grava nada (nem quem chamou, nem quando). As outras
atividades de sessão (visita de sala, tela compartilhada, token de voz) gravam.
Ficou de fora por escolha — chamado é efêmero — mas se um dia isso virar
métrica de "ninguém responde quando chamam", vai faltar dado.

### 6. Ausência é sempre manual

Não existe detecção automática de idle: ficar ausente é só o botão de celular. A
feature entrega a notificação para **quem já está ausente** — se a ideia era
também "entrar em idle sozinho depois de N minutos sem teclado", isso não foi
feito e não estava no pedido.

---

# Deploy no Railway: Node 22 — 2026-08-20

O deploy depois do commit `eec1849` entrou em **loop de restart**. Causa, nos
logs do Railway: `Error: Node.js detected but native WebSocket not found` em
`@supabase/realtime-js`, com `Node.js v20.20.2`. O `createClient` de
`server/src/supabase.ts` roda no import do módulo, então o processo morre antes
de subir o HTTP — o fail-soft do `supabase.ts` cobre "sem variável" e "banco
fora do ar", não "runtime sem `WebSocket`".

Correção aplicada: `engines.node` para `>=22` e **`.nvmrc` com `22`** (o
Nixpacks resolve a versão pelo `.nvmrc`; o range `>=20.12` ele resolvia para o
Node 20). README atualizado nos dois lugares que citavam Node 20.12+.

## Falta verificar

### 1. O deploy em si
Ninguém confirmou que o Railway rebuildou com Node 22 e que o serviço ficou de
pé. Como verificar: novo deploy, e no log de boot esperar o listen do server
sem o `Node.js detected but native WebSocket not found`. Se o log ainda mostrar
`Node.js v20.*`, o Nixpacks ignorou o `.nvmrc` — nesse caso definir
`NIXPACKS_NODE_VERSION=22` nas Variables do serviço.

### 2. Nada foi rodado localmente em Node 22
A máquina de desenvolvimento está em Node 24, então o `>=22` só foi verificado
por `npm run typecheck` (limpo). Se alguém estiver em Node 20, o `npm install`
agora avisa/quebra por `engines` — é o comportamento desejado.

---

# Camada de requisição no client — 2026-08-20

Ver a seção **Arquitetura** do `README.md` e `docs/features/lobby.md`.

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` OK.
- ✅ **Nenhum `socket.emit` fora de `client/src/net/`** — a regra que a camada
  existe para impor.
- ✅ Os quatro defeitos, com teste dirigido contra o servidor real (script
  temporário, sem Supabase):
  - socket caído → `socket-down` em **0ms** (antes: pendurava até o prazo do ack,
    porque o pacote ia para o `sendBuffer` e o ack nunca era limpo);
  - queda **durante** a espera → `socket-down` em 0ms, o que destrava o botão
    (antes o `busy` ficava preso até remontar o componente);
  - dois `create` simultâneos → 1 requisição, o segundo devolve `null`, e a
    chave libera depois (não trava para sempre);
  - `chatSend` devolve `false` sem conexão e `true` com — é o que faz o `Chat`
    não limpar o campo de uma mensagem que não foi.
- ✅ Regressão: `smoke-test.mts` 14/14, e os 12 métodos da api levando
  `invalid-token` com Supabase configurado e fora do ar (portão intacto).

## Corrigido depois do primeiro uso real (2026-08-20)

Três defeitos que só apareceram quando alguém tentou subir o app de verdade, e
que a verificação por script nunca pegaria:

- **O Vite não lia o `.env` da raiz.** `envDir` não estava definido, então ele
  procurava em `client/` e as duas `VITE_*` eram silenciosamente ignoradas — o
  client achava que não havia login enquanto o servidor exigia token. Corrigido
  com `envDir: '..'` em `client/vite.config.ts`.
- **`createClient` no topo do módulo derrubava o app.** URL inválida faz o SDK
  lançar em tempo de import, e a página ficava **em branco**. Agora degrada para
  o modo anônimo com erro no console.
- **A fase `boot` podia ficar presa e era invisível.** `currentSession()` sem
  `.catch` + `boot` renderizando um `<div>` vazio = tela branca sem pista.
  Agora tem `catch` (falha ao ler sessão = tela de login) e o `boot` mostra o
  logo.
- **Beco sem saída em `auth-required`.** A mensagem mandava "entre com sua
  conta" mesmo quando o client não tinha login configurado — ou seja, sem tela
  de login para onde ir. Agora nomeia a causa real (falta `VITE_SUPABASE_*` no
  deploy).

## Falta verificar

### 1. Nada disso foi visto num navegador
Igual ao resto do lobby: a camada foi exercitada por script Node contra o
servidor, não pela UI. Em particular, o comportamento do `busy` na tela (botão
que destrava ao cair a conexão) foi provado na api, não no React.

### 2. `move`/`sit` passaram a atravessar uma função por tick
Rodam a `TICK_RATE` (15/s) e agora vão por `worldApi`. O custo é uma chamada de
função — irrelevante em teoria, não medido em prática. Se algum dia o game loop
aparecer num profile, é um lugar a olhar.

### 3. A api do lobby lê o socket por getter
`createLobbyApi(() => socketRef.current)` resolve o socket no momento do envio,
o que é o certo para reconexão — mas nunca foi testado com o socket sendo
substituído no meio de uma chamada.

---

# Lobby (criar mundos e convidar) — 2026-08-20

Ver [`docs/features/lobby.md`](docs/features/lobby.md).

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ Sem Supabase: os eventos do lobby respondem `not-configured`, e o modo
  anônimo do jogo continua entrando **sem** `worldId` — `smoke-test.mts` 14/14.
- ✅ Com login exigido e banco fora do ar: os **doze** eventos respondem
  `invalid-token`, sem token e com token lixo. Nada é criado, arquivado,
  removido, revogado, promovido nem transferido (o log do servidor não registra
  escrita nenhuma), e o `join` é recusado antes de avaliar o mundo.

## Verificado contra um Supabase real — 2026-08-20

- ✅ **`lobby:list` roda de verdade**: `buildState`, `listWorldsFor`,
  `listPendingInvites` e o `myId` novo. Era o primeiro evento a falhar (perfil não
  criado) e é o que passou a funcionar.
- ✅ A tela do lobby abre com Supabase configurado (antes só compilava).

Ver a seção de autenticação para a cadeia inteira e o que ela prova.

## Falta verificar (em ordem de importância)

### 1. As ESCRITAS do lobby ainda não foram executadas
Criar mundo, criar a empresa pessoal e **adicionar alguém pelo ID** não foram
confirmados. São as sequências mais frágeis: `ensureOrgForNewWorld` faz duas
escritas sem transação (empresa + membership) e `addMemberToWorld` faz duas, mais a
leitura que evita rebaixar o dono. A ordem foi escolhida para falhar de forma
recuperável, e isso não foi observado. (O convite por e-mail virou dormente — ver
a seção de autenticação.)

### 2. A tela do lobby nunca foi aberta
Compila e o bundle constrói; ninguém viu a lista, o formulário de criar, o campo
de convite nem o botão "Cheio" num navegador. Roteiro de 8 passos no doc.

### 3. Nada do gerenciamento foi executado
Renomear, mudar lotação, alternar visibilidade, tirar membro, cancelar convite,
recusar convite, arquivar, **definir papel** e **passar a propriedade** nunca
rodaram contra um Supabase real. Três pontos merecem atenção na primeira
verificação:

- `ejectFrom()` nunca desconectou ninguém — a sequência "perde acesso → é
  desconectado → reconecta → portão recusa com o motivo certo" é raciocínio,
  não observação. É o comportamento mais visível da entrega.
- `transferWorldOwnership()` faz três escritas sem transação. A ordem foi
  escolhida para que nenhuma falha parcial deixe o mundo sem administrador, mas
  isso não foi provado interrompendo no meio.
- **A validação de papel não foi alcançada em teste.** Mandar um papel
  inventado é recusado, mas por `invalid-token` — a autenticação vem antes da
  validação de entrada, então o `check` de `'host' | 'member'` nunca executou.

### 4. Duplo clique em "Criar" — resolvido no client, ainda não no servidor
`once()` em `net/request.ts` deduplica por chave e **não** depende de render do
React (verificado: dois `create` simultâneos = 1 requisição). Mas a proteção de
verdade seria no servidor: dois sockets, ou duas abas, ainda criariam dois
mundos com o mesmo nome. Não há unicidade de `places.name` por empresa.

### 5. Mundo com cenário trocado por baixo
O cliente monta o mapa a partir do cenário que o lobby informou. Se o
`scenario_id` do mundo mudar entre listar e entrar, o mapa carregado divergiria
do que o servidor usa. Não tratado e não medido (janela minúscula, consequência
feia).

### 6. Sem UI para desfazer
**Resolvido para o mundo**: remover membro, cancelar convite, mudar lotação e
visibilidade, renomear, arquivar, definir papel e passar a propriedade agora são
tela. Continua só por SQL: **desarquivar** um mundo e administrar a **empresa**
(convite de empresa, `memberships.role`, suspender membro). `expires_at` de
convite é respeitado na leitura, mas ninguém limpa linhas velhas.

### 6b. Nada audita papel nem propriedade
Não há registro de quem promoveu quem, nem de quando um mundo mudou de dono —
só o `console.log`, que morre no restart. `voice_token_grants` tem trilha; isto
não. Vale uma tabela se mais de uma pessoa administrar o mesmo mundo.

### 7. `listWorldsFor` com volume
Faz 4 consultas e filtra em JS. Nunca foi medido com muitos mundos ou muitas
empresas.

---

# Autenticação e controle de acesso — 2026-08-20

Ver [`docs/features/autenticacao-e-acesso.md`](docs/features/autenticacao-e-acesso.md).

**Estado:** funcionando contra um Supabase real. O login e a entrada num mundo
deixaram de ser teoria; o **acesso por ID entre duas contas** é o que falta
confirmar.

## Já verificado

### Contra um Supabase real — 2026-08-20

Confirmado pelo usuário ("agora está pronto") depois de aplicar `0001`→`0008` e o
`seed.sql`. **Eu não vi a tela** — o que segue é o que essa confirmação
necessariamente exercitou, não o que foi conferido item por item:

- ✅ Boot com Supabase configurado e a sonda limpa: sem `42501` (privilégio), sem
  `42P01` (schema) e com `characters` populada.
- ✅ **Criar conta / entrar com e-mail e senha, sem confirmação.** O `signUp`
  devolvendo sessão na hora é o que tira a tela do login — se "Confirm email"
  estivesse ligado, teria parado aí.
- ✅ **`verifyAccessToken` no caminho de SUCESSO.** Até aqui só o caminho de
  recusa havia rodado (todo teste anterior parava em `invalid-token`).
- ✅ **`ensureProfile` criando perfil de verdade** — era exatamente o que estava
  quebrado, por três causas em série (ver "Corrigido" abaixo).
- ✅ `lobby:list` inteiro: `buildState`, `listWorldsFor`, `listPendingInvites` e o
  `myId` novo.
- ✅ O portão do `join` no caminho de sucesso, até `getWorld`.

### Antes, por lógica e caminho de recusa

- ✅ `npm run typecheck` (server + client) e `npm run build` limpos.
- ✅ Modo anônimo (sem Supabase) intacto: `smoke-test.mts` 14/14 depois de o
  `join` perder a identidade e de o mundo passar a ser por local.
- ✅ **Fail-closed na autenticação**, com Supabase apontando para porta fechada:
  socket sem token leva `auth-required`, token inválido leva `invalid-token`, e o
  recusado **não** anda, **não** fala, **não** obtém token de voz e **não**
  aparece para outros sockets. A recusa não trava o socket.
- ✅ **Isolamento por local**: dois locais no mesmo cenário são mundos distintos,
  o chat é separado, e as salas de LiveKit são distintas e sanitizadas. A chave
  sintética do modo sem banco (`scenario-*`) não colide com uuid de local.
- ✅ `world.size` acompanha entrada e saída (base da lotação).
- ✅ Empiricamente: `node --env-file` **não** sobrepõe variável já exportada no
  shell (o shell ganha) — causa de "está no `.env` e não funciona".

## Corrigido no primeiro uso real (2026-08-20)

**`profiles.id` sem default — ninguém conseguia entrar.** `profiles` era a única
das sete tabelas com `uuid primary key` **sem** `default gen_random_uuid()`. Era
correto quando o id vinha do cliente (o antigo `shared/src/identity.ts`); quando
a identidade passou para o Supabase Auth, esse arquivo foi removido e a coluna
ficou sem ninguém para preenchê-la. Efeito: todo insert de perfil falhava com
`null value in column "id"`, e como `ensureProfile`/`findOrCreateProfile` são
fail-soft, o erro virava `null`. Corrigido por
`db/migrations/0007_profile_id_default.sql`.

**`service_role` sem privilégio de tabela (`42501`).** Nenhuma migração nossa
revoga nada — o grant nunca existiu. O Supabase concede acesso às tabelas de
`public` por *default privileges*, e elas são registradas **por papel que cria o
objeto**: schema aplicado por outro papel que não o `postgres` cria tabela sem
grant para o `service_role`. E `BYPASSRLS` não dispensa privilégio de tabela —
são dois controles distintos. Corrigido por `db/migrations/0008_grants.sql`
(só `service_role`, por menor privilégio: o navegador não fala com o banco).

**Catálogo vazio (`23503`).** `profiles.character_id` referencia `characters`,
populada pelo `seed.sql` — não por migração. Sem ele, criar perfil falha com
foreign key, e a mensagem fala de constraint, não de seed. Agravante descoberto
na prática: o SQL Editor do Supabase roda o script numa **transação única**, então
um erro em qualquer statement do seed desfaz tudo o que já havia passado — o
catálogo fica vazio para quem jura ter rodado o seed.

Dúvida de desenho, registrada: `characters`/`scenarios`/`audio_zones` são
**catálogo obrigatório** (espelho de `shared/`), não dado de demonstração —
provavelmente deveriam ser migração, deixando no `seed.sql` só a empresa e os
locais de demo. Não mexi agora para não trocar a convenção de `db/` no meio de
uma depuração.

**O boot não sondava nada.** Agora faz um HEAD em `profiles` no start e nomeia os
erros que custaram depuração: `42501` (falta a `0008`), `42P01` (schema não
aplicado) e `characters` vazia (falta o `seed.sql`). Fire-and-forget, não bloqueia
o boot.

**A mensagem mentia, e foi isso que custou o tempo.** O `whoAmI` do lobby
devolvia `LobbyIdentity | null`, e **três** causas distintas — sem token, token
recusado e falha do banco no perfil — colapsavam no mesmo `null`, que o `handle`
traduzia para `invalid-token`: *"Sua sessão expirou. Entre de novo."* A sessão
estava perfeita; o problema era schema. Agora `whoAmI` devolve o motivo
(`auth-required` / `invalid-token` / `error`) e loga explicitamente que token
válido + perfil nulo é falha de **banco**, não de sessão. O portão do `join` em
`handlers.ts` já tratava certo (`deny('error')`) — a confusão era só no lobby.

**O boot não conferia a forma do `SUPABASE_URL`.** Uma URL definida mas
apontando para um site devolve HTML, e o erro do supabase-js
(`Unexpected token '<', "<!DOCTYPE "...`) não menciona configuração. Agora o boot
avisa quando a URL não tem forma de endpoint de projeto (host, caminho), sem
imprimir o ref nem a key — e lembra que **variável exportada no shell sobrepõe o
`.env`**, que é a razão de "está no `.env` e não funciona". Verificado
empiricamente: `node --env-file` não substitui o que já está no ambiente.

**`verifyAccessToken` engolia falha de infraestrutura.** Não logava nada por
design (token vencido em reconexão é rotina e viraria ruído). Mas erro que não é
401/403 — URL do projeto errada, projeto diferente do que o navegador usa,
Supabase fora do ar — desaparecia como "token inválido". Agora esse caso loga a
mensagem do erro (nunca o token) e sugere conferir `SUPABASE_URL` contra o
`VITE_SUPABASE_URL` do client.

---

## Falta verificar (em ordem de importância)

### 1. Acesso por ID entre duas contas — o coração da entrega
`addMemberToWorld` **ainda não foi confirmado**. São duas escritas em sequência
sem transação (membership → `place_members`) mais a leitura que evita rebaixar o
dono. Roteiro: segunda conta em janela anônima → copiar o ID dela → "Adicionar" no
seu mundo → o mundo tem que aparecer no lobby dela **sem passo de aceite**.
Conferir no banco uma linha nova em `memberships` e uma em `place_members`.

### 2. Não rebaixar o dono
Colar o **próprio** ID no seu mundo tem de manter `memberships.role = 'owner'`.
`addMemberToWorld` lê antes de escrever exatamente para isso (um `upsert` com
`role: 'guest'` rebaixaria), e o tratamento nunca foi provocado. É a falha mais
feia possível: o dono perde a empresa.

### 3. ID malformado × ID inexistente
Botão desabilitado para texto torto (`isProfileId` no client) e **`not-found`**,
não `error`, para uuid válido que não é de ninguém. A distinção existe no
servidor e não foi exercitada.

### 4. `myId` na tela e o botão de copiar
`navigator.clipboard` falha em contexto não seguro (HTTP fora de localhost). O
`catch` mostra "selecione e copie à mão" e nunca rodou.

### 5. `capacity`, local restrito e isolamento entre empresas
Nada disso foi exercitado com gente de verdade. Roteiro nos passos 10 a 12 do doc
da feature.

### 6. `no-invite` é um nome que mente
Continua sendo o motivo de recusa de quem não tem acesso, embora não exista mais
convite. Trocar o código toca `shared`, server e client por uma mensagem — dívida
pequena, registrada de propósito.

### 7. Renovação de token em sessão longa
O `auth` do socket é função justamente para a reconexão pegar o token renovado.
Não observado em sessão de mais de 1h. Se estiver errado, a falha aparece só
depois de uma hora, como `invalid-token` no meio da sessão.

### 8. Sessão morta em outra aba
`onAuthStateChange` deveria devolver a pessoa para a tela de login quando a sessão
é revogada no dashboard. Não testado.

### 9. Convite por e-mail: dormente, e é dívida
Continua **inteiro** — tabela `invites`, `inviteToWorld`, `acceptInvite`,
`acceptInviteById`, eventos `lobby:accept`/`lobby:decline`/`lobby:revokeInvite`,
tipos `PendingInvite`/`SentInvite` e a UI que os mostra (condicionada a lista não
vazia, então nunca aparece). Nada cria linha nova.

É decisão, não esquecimento: alcançar **quem ainda não tem conta** só é possível
por e-mail, e é o caminho de volta quando houver domínio. Mas é código que
compila, ninguém executa e que vai envelhecer sem ninguém notar — se ficar claro
que o e-mail não volta, tem de ser deletado, não mantido "por garantia".

O que **saiu de verdade** foi o aceite automático no portão (`handlers.ts`): era
ele o furo que a confirmação de e-mail sustentava, não a tabela.

### 10. Catálogo como seed, e não como migração
`characters`/`scenarios`/`audio_zones` são **catálogo obrigatório** (espelho de
`shared/`) e vivem no `seed.sql`. Sem eles nenhum perfil pode existir, e o SQL
Editor do Supabase desfaz o seed inteiro se um statement falhar — foi assim que o
catálogo ficou vazio "tendo rodado o seed". Provavelmente deveriam virar migração,
deixando no seed só a empresa e os locais de demo. Não mexido para não trocar a
convenção de `db/` no meio de uma depuração.

### 11. Tamanho do bundle inicial
~557 kB (176 kB gzip) no chunk principal com o SDK do Supabase importado de forma
estática (o `App` precisa dele no boot para restaurar a sessão). Não medi o
antes/depois. O chunk de 6 MB do Pixi continua dominante.

### 12. `.env.example` — quase-acidente de segredo, e ainda sem as variáveis
**2026-08-20, achado na varredura de fechamento:** o `.env.example` da árvore de
trabalho continha **valores reais**, incluindo uma `SUPABASE_SERVICE_ROLE_KEY`.
O arquivo é versionado, então isso teria virado vazamento no primeiro commit.

Nada vazou: a versão em `HEAD` não tem nenhum JWT, nenhum commit do histórico
introduziu um, e nada estava staged. **A chave não precisou de rotação.** O
`.githooks/pre-commit` (ativo, `core.hooksPath=.githooks`) também teria barrado —
ele isenta `.env.example` **por nome**, o que é correto, mas a regra de conteúdo
para JWT pega o valor. A rede funcionou; o que faltou foi não ter posto o valor
ali.

Pendente, e é o usuário que executa (as regras `deny` do `.claude/settings.json`
impedem a mim ler e escrever esse arquivo): restaurar o `.env.example` para
`HEAD` e acrescentar **só os nomes** das cinco variáveis do Supabase — que
continuam faltando lá (`HEAD` só tem as quatro do LiveKit). Comando no
fechamento da sessão.

Vale decidir se o padrão `deny` abre exceção para `.env.example`, que por
definição não tem valores — a impossibilidade de eu inspecioná-lo é justamente o
que deixou o valor real passar tanto tempo ali.

---

# Persistência (Supabase) — 2026-08-20

Ver [`docs/features/persistencia-supabase.md`](docs/features/persistencia-supabase.md).

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo.
- ✅ `smoke-test.mts`: as 14 checagens do protocolo passam com o `join`
  assíncrono — inclusive `join` sem `profileId` (cliente antigo).
- ✅ Boot sem `SUPABASE_*`: loga `persistência desativada` e o app funciona
  igual (nenhuma chamada ao banco acontece).
- ✅ `join` duplo no mesmo socket recusado (mundo não ganha player extra) —
  teste de socket real. (O `profileId` no `join` foi removido na entrega de
  autenticação; a identidade agora vem da conta.)
- ✅ `World.validResume()` contra o mapa real do Estúdio: chão livre restaura,
  cadeira+sentado restaura sentado, cadeira sem sentar cai no spawn, parede cai
  no spawn, fora do mapa/`NaN` caem no spawn. E `hydrateChat()` é idempotente.
- ✅ `World.zoneKeyAt()` (atividade): bate com `audioZoneAt()` do cliente nos
  864 tiles do Estúdio, acerta as bordas dos dois retângulos e não vaza para
  fora; área aberta devolve `null`.
- ✅ Evento `share` repetido e com payload inválido não derruba o servidor;
  travessia das duas zonas a 15 msg/s seguida de chat mantém o socket saudável.
  Nenhum erro no log do servidor.

## Falta verificar (em ordem de importância)

### 1. O SQL foi executado — e cobrou três correções
**Resolvido em 2026-08-20.** `0001`→`0008` e o `seed.sql` foram aplicados contra um
projeto real. A primeira aplicação cobrou exatamente o que este item previa:
`profiles.id` sem default (corrigido pela `0007`), `service_role` sem privilégio
de tabela (`0008`) e catálogo vazio porque o SQL Editor desfaz o seed inteiro
quando um statement falha. Detalhes na seção de autenticação.

Continua **não** verificado no SQL: as 3 views, o `security_invoker` e as
políticas de RLS — ver os itens 3 e 4.

### 2. O ciclo completo de "voltar onde parou" e a atividade da sessão
Nada do caminho com banco foi exercitado de verdade: upsert de perfil, leitura
de `presence_state`, gravação com throttle, `sessions` abrindo e fechando,
histórico de chat hidratando após restart. E, do bloco de atividade:
`zone_visits` abrindo/fechando (a **corrente de promessas** nunca foi observada
gravando — é o ponto mais delicado: quem atravessa a copa correndo troca de sala
antes de a visita anterior ter gravado), `screen_shares`, `voice_token_grants` e
`sessions.user_agent`. O roteiro está em "Como testar" no doc da feature
(passos 2 a 9).

### 3. RLS e as views
As 3 views (`v_zone_occupancy`, `v_place_activity`, `v_screen_share_summary`)
nunca foram executadas. Atenção ao `security_invoker = true`: sem ele a view
roda com os direitos do dono e **fura o RLS** das tabelas de baixo. Confira com
a query do `db/README.md` depois de aplicar.

Nenhuma política foi exercitada — todas dependem de `auth.uid()`, e não existe
login ainda. Hoje o efeito prático é "navegador não lê nada", que é o desejado,
mas isso não valida as políticas para quando o login chegar. Atenção especial à
recursão em `memberships` (é o motivo do `security definer`).

### 4. `.env.example`
Ver o item correspondente na seção de autenticação — o arquivo segue barrado
pelas regras `deny`, e agora faltam cinco nomes, não três. Vale rever se o
padrão deveria abrir exceção para `.env.example`, que por definição não tem
valores.

### 5. Schema sem uso no código
`invites`, `place_members` e `profiles.auth_user_id` **passaram a ser usados**
na entrega de autenticação. Continua sem leitor: `profiles.last_seen_at` (só
escrita) e `memberships.invited_by`. `places.visibility = 'restricted'` também não é respeitado: o servidor
ainda tem um mundo por cenário, não por local. É esperado no MVP, mas é dívida
registrada, não feature pronta.

### 6. Compartilhamento nos primeiros instantes da sessão
`openSession` é assíncrono, e o evento `share` só é registrado depois que a
linha de sessão existe. Um compartilhamento iniciado nos ~100ms seguintes ao
join não gera linha em `screen_shares`. Aceito (é histórico, não estado), mas
não medido.

### 7. Histórico de chat sai sem cor
`senderId` de mensagem vinda do banco é o `profile_id`, e o roster do cliente é
indexado por `socket.id` — então mensagem antiga aparece na cor padrão.
Consertar exige expor `profileId` no roster.

---

# Pendências do cenário Ruínas

O que **não foi verificado** na montagem do cenário Ruínas, e itens herdados das
mudanças anteriores. Atualizado em 2026-08-18.

## Já verificado (para referência)

- ✅ Typecheck (server + client) limpo.
- ✅ Servidor: join no cenário `ruins` ecoa o id correto, spawn na praça
  central (400, 592), clamp de movimento em 928x1120 (teste de socket real).
- ✅ Grade de colisão: 35 linhas x 29 colunas exatas, flood fill a partir do
  spawn alcança 396/401 células livres — as 5 restantes são bolsões
  decorativos de grama ao redor do altar, inalcançáveis também na cena
  original.
- ✅ Correções já aplicadas após o debug visual: canto sudoeste (cols 1-2,
  linhas 24-30) e célula (22,6) marcados como sólidos (eram fundo cinza);
  tronco da árvore nordeste reduzido a 1 tile para não selar a área atrás dela.
- ✅ Posições dos overlays: 17 de 20 instâncias localizadas por template
  matching (erro médio < 12/canal); estátua, estela RESH e tumba extraídas
  por chroma-key com retângulo conferido visualmente.

## Falta verificar (em ordem de importância)

### 1. Visual in-game do cenário Ruínas
Nunca foi aberto no navegador. Conferir:
- Se o chão (`ground.png`) renderiza nítido (scale mode nearest) e alinhado
  com a grade de colisão.
- Se os 20 props sobrepostos (árvores, estátua, pilares, lanternas, lápides,
  altar, tumba) estão **pixel-perfeitos** sobre a arte do chão — qualquer
  desalinhamento aparece como "fantasma"/borda dupla no sprite.
- Se o y-sort funciona: player deve passar **por trás** de árvores, estátua e
  monumentos e **na frente** deles quando estiver ao sul.

### 2. Colisão fina nas bordas (transcrição manual)
A grade foi transcrita visualmente da imagem — pode haver célula errada em ±1
nas bordas. Conferir andando no jogo, com atenção a:
- **Escadas**: terraço oeste → pátio (cols 3-6, linhas 15-17), plaza da
  estátua (7,11-12), altar (16,4-6), sala leste → cemitério (25-26,16-18),
  corredor sudeste (20-22,20-22), sala sul (5-6,27-30).
- **Lado da árvore nordeste** (21,7): liberado para dar passagem — conferir se
  não permite "pisar" no tronco.
- **Vaso do canto da sala sul** (~4.5, 28.5): pode sobrepor o pé da escada.
- **Coluna vertical (9,4)-(9,8)** entre o terraço nordeste e a plaza da
  estátua: marcada como parede, mas pode ser uma escada na cena original
  (passagem bloqueada que talvez devesse existir).
- **Beiral da fonte/poço** (célula (5,23)): arco noroeste do poço invade um
  pixel a célula livre.
- Usar o mapa de debug: `docs/ruins-colisao-debug.png` (vermelho = sólido,
  verde = livre, azul = spawn).

### 3. Multiplayer no cenário Ruínas
A arquitetura é a mesma dos outros mundos (testada via socket), mas não foi
testado com 2+ navegadores dentro do `ruins`: voz por proximidade, chat,
isolamento em relação a Praça/Escritório.

### 4. Cenário Escritório — visual in-game
Herdado da tarefa anterior: o renderer procedural foi restaurado do git e o
typecheck passou, mas ninguém abriu o Escritório no navegador desde a
restauração (colisão, spawn no lounge, visual).

### 5. Zoom sobre o bitmap grande
O zoom da câmera (0.5x-2.5x) nunca foi testado sobre o chão de imagem única
das Ruínas (928x1120). Conferir nitidez ao aproximar e desempenho ao afastar.

## Observações menores (não bloqueiam)

- `client/public/tiles/paths.png` existe mas nunca é carregado (sobra da
  Praça, pré-existente).
- Os 5 props altos que o matcher não encontrou individualmente (2ª lanterna
  sobre muro, pilares encostados em paredes) ficaram **sem overlay** — o
  player pode cobrir o topo deles ao passar por trás; todos ficam em locais de
  difícil sobreposição (adjacentes a paredes sólidas).
- Licença: Ruínas usa o pack CC0 do Cainos (sem restrição); a Praça continua
  com a restrição **não-comercial** do Sprout Lands (documentado no README).
- ~~As mudanças do cenário Ruínas ainda não foram commitadas~~ — **resolvido**:
  em 2026-08-20 o working tree estava limpo e os 17 arquivos de `ruins` estão
  versionados.
