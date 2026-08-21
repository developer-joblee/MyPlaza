# Booble (conversa paralela com prioridade de áudio)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Dentro de uma sala grande, duas pessoas que querem trocar duas frases tinham só
duas opções ruins: falar em cima da conversa de todo mundo, ou sair para "chamar
no particular", que é pesado e quebra o fluxo. A **booble** é a terceira.

Chegue **ao lado** de alguém (até 2 tiles) e clique em **booble** na linha dela
na lista. A partir daí:

- **dentro da booble, 100%** — vocês se ouvem cheio;
- **fora, 7%** — o resto da sala vira ruído de fundo, **nos dois sentidos**:
  você ouve a sala a 7% e a sala ouve vocês a 7%.

Ninguém aprova nada: quem chega perto vê **entrar** na linha de quem já tem uma
booble e entra na hora.

**Um círculo violeta no chão** envolve o grupo, e ele é dinâmico: cresce quando
alguém entra e encolhe quando alguém sai. As boobles dos outros também aparecem,
mais fracas — é o que explica por que aquelas duas pessoas estão mais baixas.

Ao lado da cabeça de cada membro aparece um **balãozinho de cochicho**: três
pontinhos violeta em onda, bem pequenos. Ele não diz nada que o círculo já não
diga sobre *quem está com quem* — ele diz que **tem conversa acontecendo ali**,
que é a pergunta de quem olha o grupo de longe.

Sai-se pelo **Sair** no aviso do topo, ou **dando dois passos para o lado**: a
partir de 3 tiles do grupo você é removido. É de propósito — a booble é um
cochicho, e cochicho não te segue pelo escritório.

## Como funciona

Duas metades, e a divisão é o desenho:

- **O servidor é dono da FILIAÇÃO.** Ele é o único que tem a posição de todo
  mundo, então é ele que impõe o raio de entrada, remove quem se afasta e cunha o
  id da booble. Tudo em `server/src/world.ts`.
- **O cliente é dono do VOLUME.** Cada um decide o que assina e com que ganho
  toca, exatamente como já era na proximidade e nas zonas. É o que torna a
  assimetria grátis: "dentro 100%, fora 7%" não exige nada de quem publica.

A booble **é** o conjunto de players com o mesmo `boobleId` (`PlayerState`). Não
existe entidade nem lista paralela no servidor.

### O ciclo

```
clique em [booble] → booble.joinBooble(id) → worldApi.boobleJoin → 'booble:join'
                                                                       ↓
                                       World.joinBooble (valida raio, zona, teto)
                                                                       ↓
                              io.to(worldKey) 'player:booble' (um por quem mudou)
                                                                       ↓
   bindStore → booble.receiveBoobleChange → store.setPlayerBooble  (HUD, aviso)
                                          → Game.setPlayerBooble   (pastilha + áudio)
                                                                       ↓
                     próximo tick da voz (≤250ms) reconcilia volume e subscrição
```

Não há atualização otimista: o id é do servidor, então **nada muda na tela até o
broadcast voltar**. É o que elimina a classe de bug "minha tela diz que estou
numa booble e a dos outros diz que não".

### A regra de volume

Fonte única em `client/src/voice/proximity.ts`:

```ts
audioVolumeFor(self, peer)
  mesma booble                         -> 1                  (ignora zona e distância)
  base = mesma zona ? (na sala ? 1 : volumeForDistance(d)) : 0
  eu ou ele numa booble                -> base * 0.07
  nenhum dos dois numa booble          -> base                (o comportamento de antes)
```

O tick de 250ms (`VoiceRoom.tick`) chama isso e **usa o mesmo número para três
coisas**: o volume, o badge `voz` do HUD e o anel de "falando". Antes esses três
repetiam a comparação de zona e raio à mão, com raios diferentes.

O badge `voz` é `volume > 0 && audioWanted.has(id)` — audível **e** de fato
assinado. O segundo termo fecha uma divergência anterior à booble: passando de
`MAX_AUDIO_SUBSCRIPTIONS` (16) pessoas audíveis, as que sobram do teto ficam sem
stream, e o badge dizia "voz" para alguém que o SFU não estava mandando.

### Os números

Todos em `shared/src/constants.ts`, porque **os dois lados usam** — o servidor
impõe, o cliente decide o que mostrar:

| Constante | Valor | Para que |
|---|---|---|
| `BOOBLE_OUTSIDE_VOLUME` | `0.07` | quanto se ouve através da borda |
| `BOOBLE_JOIN_RADIUS` | `TILE_SIZE * 2` (64px) | para **entrar** |
| `BOOBLE_EXIT_RADIUS` | `TILE_SIZE * 3` (96px) | para **permanecer** |
| `BOOBLE_MAX_MEMBERS` | `8` | teto de gente |
| `BOOBLE_MAX_NAMES` | `2` | nomes no aviso antes do "+N" |

Os dois raios são **bem menores que o audível** (160px / 5 tiles), e é isso que
faz a booble ser um cochicho em vez de "conversa com todo mundo que eu escuto".
A invariante que não pode ser violada é `entrar <= permanecer`: com a entrada
maior, você entraria e seria expulso no mesmo instante.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/types.ts` | `PlayerState.boobleId` — a booble *é* este campo |
| `shared/src/events.ts` | `booble:join`, `booble:leave` (c→s) e `player:booble` (s→c) |
| `shared/src/constants.ts` | os cinco números acima |
| `server/src/world.ts` | `joinBooble`, `leaveBooble`, `evictFarBooble`, `boobleMembers` — toda a validação |
| `server/src/handlers.ts` | os dois handlers, o `broadcastBooble`, e os três pontos que removem (move, away, disconnect) |
| `client/src/booble.ts` | orquestra store + jogo + rede num só ponto (molde: `presence.ts`) |
| `client/src/net/worldApi.ts` | `boobleJoin`, `boobleLeave` na fronteira de requisição |
| `client/src/net/bindStore.ts` | ouve `player:booble` e delega |
| `client/src/state/store.ts` | `RosterEntry.boobleId`, `selfBooble`, `boobleReachIds`, `setPlayerBooble` |
| `client/src/game/Game.ts` | `setPlayerBooble`, o `booble` por peer em `getAudioInfo`, o desenho dos círculos e o `boobleReachIds` |
| `client/src/voice/proximity.ts` | **`audioVolumeFor`** — a regra inteira, e os tipos do contrato de áudio |
| `client/src/voice/VoiceRoom.ts` | tick: volume, prioridade de subscrição, badge, anel, vídeo |
| `client/src/game/BoobleRings.ts` | o círculo dinâmico no chão em volta do grupo (e o `VIOLET` compartilhado) |
| `client/src/game/BoobleWhisper.ts` | o balãozinho de cochicho, por pessoa |
| `client/src/game/Avatar.ts` | `setBooble` — liga/desliga o balão; `whispering` no `debugFrame` |
| `client/src/ui/Hud.tsx` | selo `booble` e o botão `booble`/`entrar` na linha |
| `client/src/ui/Notices.tsx` | o aviso violeta com os nomes e o **Sair** |
| `client/src/ui/util.ts` | `joinNames` — a lista de nomes, agora compartilhada com o "toc-toc" |
| `client/src/ui/icons.tsx` | `BoobleIcon` |

## Decisões e por quê

- **7%, e não 0.** Zero já existe e chama-se sala fechada (`audioZones`). O
  ponto da booble é que a sala **continua audível**: você percebe que alguém
  falou com você, ouve que a reunião acabou, e sai da booble se quiser. Uma
  booble que isola não é uma booble, é uma sala — e uma sala não se cria com um
  clique no meio do escritório.
- **Atenuação simétrica.** Atenuar só quem está de fora (a leitura alternativa do
  pedido) deixaria quem está na booble com **dois áudios cheios competindo**, que
  é exatamente o problema que a feature existe para resolver. A booble tem de
  baixar a sala *para você*, não só você para a sala.
- **Entrar exige mesma zona; permanecer não.** A assimetria é deliberada, e é a
  decisão mais fácil de "consertar" errado. Se desse para entrar atravessando a
  parede, quem está **fora** de uma sala de reunião poderia puxar quem está
  **dentro** — e morre a promessa "para ouvir, precisa entrar", que é a única
  razão de existir das zonas. Formada a booble, ela atravessa a porta junto com
  as pessoas, o que é o caso de uso real: vocês combinam algo e um dos dois entra
  na sala.
- **A booble quebra por distância.** A alternativa era um canal que te acompanha
  pelo mapa (walkie-talkie). Foi descartada porque a booble ficaria pendurada:
  ninguém desliga o que não vê, e você acabaria com metade do escritório a 7%
  por causa de uma conversa de dois minutos de ontem. Quebrar por distância faz o
  estado morrer sozinho, e o custo é ter de reabrir com um clique.
- **2 tiles para entrar, 3 para permanecer — escala de cochicho.** A primeira
  versão usava o raio audível (5 tiles) e 6,5 para sair, e estava errada por dois
  motivos. Sair exigia atravessar a sala, então a booble ficava pendurada
  exatamente como o walkie-talkie que a decisão acima descartou. E entrar com o
  raio audível fazia a booble ser "conversa com qualquer um que eu escuto" — ou
  seja, a sala inteira, o que não prioriza nada. Cochicho é ao lado da pessoa, e
  sair é dar dois passos.
- **O tile de folga entre entrar (2) e permanecer (3) é obrigatório.** Com um raio
  só, quem para na fronteira entra e sai a cada passo, com um broadcast por vez. É
  a mesma histerese que a voz já usa para o vídeo (`VIDEO_RADIUS`). E a invariante
  `entrar <= permanecer` não pode ser violada nunca: ao contrário, a pessoa entra
  e é expulsa no mesmo instante.
- **A saída compara com o membro MAIS PRÓXIMO, não com todos.** Uma roda de quatro
  pessoas é mais larga que 3 tiles; exigir proximidade de todo mundo dissolveria a
  booble por geometria em vez de por intenção.
- **`boobleId` em `PlayerState`, não uma entidade.** Uma lista de boobles no
  servidor seria uma segunda fonte de verdade sobre quem está com quem, e o
  snapshot já carrega os players. O custo é que "quem está nesta booble" é uma
  varredura — irrelevante numa escala de dezenas, e sem risco de divergir.
- **Sem aceite.** Convite com aceite (no molde do "toc-toc") daria mais controle
  e menos fluidez, e era mais código: evento de convite, aviso, expiração,
  recusa. Como a booble não isola ninguém e não silencia ninguém — o pior que
  acontece com quem foi colocado numa é ouvir o resto da sala mais baixo, e sair
  é um clique —, o custo de errar é pequeno o bastante para não valer um passo
  de aprovação.
- **Um evento (`booble:join`) para três casos.** Criar, entrar numa existente e
  trocar de booble são a mesma intenção de quem clica ("quero falar com essa
  pessoa"), e o servidor sabe distinguir sozinho. Três eventos seriam três
  caminhos para o cliente errar.
- **Recusa em silêncio, sem ack.** Responder "não deu" transformaria o clique em
  sonda: dava para descobrir quem está perto de quem, quem está ausente e quem
  está em qual sala sem estar por perto. Segue a convenção dos outros eventos de
  mundo, e a mesma decisão já registrada em `presence:nudge`.
- **Broadcast com `io.to`, incluindo o autor.** O id é cunhado no servidor, então
  o autor **precisa** do broadcast — não existe atualização otimista possível. De
  quebra, não há como o autor e o resto do mundo discordarem.
- **Ficar ausente sai da booble.** Ausente corta mic e áudio (`applySilence`), e
  continuar membro seria segurar uma vaga sendo inaudível — pior, apareceria como
  "conversando" para quem olha a lista, quando o certo é a pessoa aparecer
  chamável pelo "toc-toc" (que exige `target.away`). Voltar **não** recria a
  booble: adivinhar com quem a pessoa ainda quer falar meia hora depois é chute.
- **Dissolve com um membro só.** Uma booble de uma pessoa não prioriza nada — ela
  apenas baixa a sala inteira a 7% para quem sobrou, que é o oposto do que a
  feature promete.
- **Teto de 8.** Uma booble do tamanho da sala não prioriza ninguém: ela só deixa
  a sala a 7% para os que sobraram fora. Conversa paralela de nove pessoas é uma
  reunião, e para isso o mapa já tem sala fechada.
- **Membros da booble entram na frente na fila de subscrição.** A sala conecta com
  `autoSubscribe: false` e há teto de `MAX_AUDIO_SUBSCRIPTIONS` (16). Sem
  priorizar, um membro que atravessou a porta cairia fora do filtro de zona e
  ficaria **mudo dentro da própria booble** — "ouvir a 100%" pressupõe ter stream.
- **A regra de volume foi extraída para `proximity.ts` antes de crescer.** Ela
  estava copiada em dois pontos do `VoiceRoom`, e mais dois lugares repetiam a
  comparação de zona/raio à mão para o badge e o anel. Quatro cópias de uma regra
  que agora tem três camadas iriam divergir na primeira alteração — e divergência
  aqui é **audível**.
- **`nearbyIds` passou a significar "audível de verdade".** É
  comportamento-preservador no caso comum (`volumeForDistance(d) > 0` ⟺
  `d <= 160`), e o `&& audioWanted` corrige de passagem um caso em que o badge
  mentia desde antes desta feature (mais de 16 audíveis).
- **O botão usa `boobleReachIds`, calculado no `Game`, e não `nearbyIds`.** Duas
  razões, e as duas são defeito se ignoradas. O raio de entrada (2 tiles) é
  **outro** que o audível (5), então o predicado do áudio mostraria o botão para
  quem está longe demais e o clique morreria numa recusa silenciosa. E o tick da
  voz **não roda sem LiveKit configurado** (`if (!room) return`), então num
  ambiente sem voz o botão nunca apareceria. O `Game` sempre roda e já tem
  posição e zona.
- **Violeta, e nada de pulso no aviso.** As três cores do projeto estão ocupadas
  por semântica (amber = ausente, mint = voz/faça-isso, coral = quebrado), e
  booble não é nenhuma delas. `--violet` é `AVATAR_COLORS[5]`, já uma cor do
  projeto. O aviso não pulsa porque, diferente do "toc-toc", ele não precisa ser
  notado: quem está numa booble acabou de clicar. Ele existe para responder "com
  quem?" e para oferecer o **Sair**.
- **O aviso, e não um sexto botão na barra de mídia.** A barra é de mídia
  (mic/fone/celular/tela); um botão que aparece e desaparece desloca as outras
  cinco, e um sempre-presente-e-desabilitado é ruído permanente por um estado
  raro. O aviso só existe enquanto a booble existe.
- **Um círculo em volta do GRUPO, não uma pastilha por cabeça.** A primeira
  versão tinha uma pastilha "booble" acima de cada nome, no molde da de ausente.
  Está errada para esta feature: a informação que importa numa booble é *quem
  está com quem*, e isso é uma **relação** — três etiquetas separadas obrigam
  quem olha a inferir o grupo. O círculo mostra o grupo e, crescendo, mostra o
  tamanho. E nenhuma pose nova: quem está numa booble está conversando como
  sempre, então inventar uma pose mentiria.
- **O círculo é descritivo, não normativo.** Ele envolve as posições **reais**
  (centroide + o membro mais distante + folga), em vez de desenhar um raio fixo.
  Assim ele cresce e encolhe sozinho, sem tabela de "raio para N pessoas", e
  nunca mente: quem decide de fato quem está dentro é o servidor por
  `BOOBLE_EXIT_RADIUS`, e um desenho com forma própria divergiria em qualquer
  arranjo que não fosse uma roda perfeita.
- **Elipse, e numa camada abaixo dos avatares.** Elipse pela mesma razão que a
  sombra e o anel de "falando" são elipses: o mapa é visto de cima em
  perspectiva, e um círculo redondo lê como bolha flutuando em vez de marca no
  chão. E a camada não pode ser dentro do `Avatar`, que é por pessoa — um desenho
  de grupo precisa das posições de todos, e quem as tem é o `Game`.
- **O balão de cochicho é por pessoa, mesmo havendo um desenho de grupo.** Ele
  parece contradizer a decisão acima (que rejeitou uma pastilha por cabeça), e
  não contradiz: as duas respondem a perguntas diferentes. O círculo responde
  *quem está com quem* — uma relação, que uma etiqueta por cabeça comunica mal.
  O balão responde *está acontecendo coisa ali?*, e essa nenhum desenho parado
  responde: um decalque imóvel no chão lê como marcação de cenário. O teste que
  separa os dois é o conteúdo: a pastilha antiga tinha a palavra "booble" (era
  filiação, e redundante); o balão não tem texto e não diz de qual booble a
  pessoa é.
- **O balão anima sempre, não só quando a pessoa fala.** Amarrar ao `speaking`
  seria mais literal e está errado: o balão apareceria e sumiria a cada frase, o
  que lê como glitch, e duplicaria o anel verde que já existe para exatamente
  isso. "Tem uma conversa rolando aqui" é uma propriedade do grupo enquanto ele
  existe, não de quem está com o microfone agora.
- **As fases começam espalhadas.** Todo mundo cochichando no mesmo compasso lê
  como animação de carregamento, não como gente conversando. A fase inicial sai
  de um contador vezes a razão áurea (`BoobleWhisper.phaseSeed`), e não de
  `Math.random`, para o resultado ser reproduzível entre execuções.
- **Ao lado da cabeça, e não acima do nome.** Acima do nome é onde mora a
  pastilha de ausente, a ~70px do centro do avatar — longe do grupo e perto do
  nome de quem está atrás. Do lado da cabeça o balão fica na faixa da telinha do
  `AwayIndicator`, que já se provou funcionar em todos os personagens. Não há
  colisão entre os dois: ficar ausente **sai** da booble.
- **As boobles dos outros também aparecem, mais fracas.** É o que explica por que
  aquelas duas pessoas ficaram mais baixas; esconder produziria "meu áudio mudou
  e não sei por quê". A sua é mais forte para não haver dúvida sobre qual é.
- **Tudo em `Graphics`, sem asset novo** — os packs do projeto são em parte
  não-comerciais e todo asset exige crédito no README.
- **A tela compartilhada acompanha a booble.** Membro passa pelo mesmo portão que
  passa no áudio: "estamos juntos" tem de valer para a tela também, senão quem
  atravessa a porta perde o que o outro está mostrando. Quem está **fora**
  continua na regra de antes — não existe "ver a tela a 7%".
- **Nada é persistido.** A booble morre com a conexão, como o `away`. Quem cai e
  volta é um `socket.id` novo, logo alguém sem booble — o que é o certo, porque a
  booble pressupõe estar perto de alguém **agora**.

## Armadilhas

- **`client/src/booble.ts` é o único caminho.** Escrever `store.setPlayerBooble`
  direto deixa o jogo (pastilha e áudio) desatualizado, e vice-versa.
- **A regra de volume vive em `proximity.ts`.** Mexer no volume dentro do
  `VoiceRoom` recria a duplicata que esta entrega acabou de remover. E se mudar a
  regra, `nearby` e `reconcileSpeaking` mudam junto **de graça** — é o motivo de
  eles derivarem de `audioVolumeFor`.
- **A prioridade na fila de subscrição é obrigatória, não otimização.** Tirar os
  membros da frente do `slice(0, MAX_AUDIO_SUBSCRIPTIONS)` deixa membro sem
  stream, e "sem stream" é silêncio, não volume baixo.
- **`BOOBLE_OUTSIDE_VOLUME` é ganho linear**, não perceptual: 0,07 de amplitude
  soa perto de −23 dB. Pior, ele **multiplica a rampa** — alguém no limite do
  raio audível, ouvido através de uma booble, sai perto de 0,0007 (inaudível).
  Isso é aceitável (a pessoa já estava quase inaudível), mas é a explicação para
  "não ouço nada de quem está longe estando numa booble".
- **`BOOBLE_JOIN_RADIUS` tem de ser `<=` `BOOBLE_EXIT_RADIUS`.** Inverter isso
  faz a pessoa entrar e ser expulsa no mesmo instante, com dois broadcasts, e o
  sintoma na tela é um botão que "não funciona".
- **A booble é desenhada em DOIS lugares, e de propósito.** O círculo de grupo
  vive em `BoobleRings` (camada abaixo dos avatares, alimentada pelo `Game`, que
  tem as posições); o balão de cochicho vive dentro do `Avatar`, porque é por
  pessoa e precisa acompanhar quem anda e ser ocultado na mesma ordem em y que o
  resto do avatar. Efeito de grupo novo → `BoobleRings`; efeito por pessoa →
  `Avatar.setBooble`.
- **O `Avatar` sabe que está numa booble, mas não em QUAL.** `debugFrame()` expõe
  `whispering` (booleano, do próprio avatar) e o `booble` com o id sai do mapa do
  `Game` em `__togetherAvatars()`. Os dois vêm de fontes diferentes **de
  propósito**: é a comparação entre eles que pega um avatar que ficou sem
  `setBooble` — e um avatar sem balão no meio de um grupo é invisível a olho nu.
- **Quem entra numa booble por dois caminhos precisa dos dois ligados.**
  `Game.setPlayerBooble` cobre a mudança ao vivo e `Game.addRemote` cobre quem já
  estava numa quando abrimos a aba. Esquecer o segundo dá o bug clássico "só
  aparece para quem estava online".
- **O círculo é redesenhado a cada frame** (`Graphics.clear()` + uma elipse por
  booble). É de propósito: as posições dos remotos são interpoladas, então um
  desenho por evento ficaria colado no lugar antigo. O custo é zero quando não há
  booble nenhuma.
- **A precedência dos micro-badges na lista é `ausente > booble > voz`** e eles
  são exclusivos por construção, porque só um pode carregar o `margin-left:auto`.
- **`--violet` está em dois lugares**: `styles.css` e `game/BoobleRings.ts` (Pixi
  não lê CSS). Mudou um, muda o outro. O `BoobleWhisper` **importa** o de
  `BoobleRings` em vez de repetir o literal — não crie um terceiro.
- **Zerar em `store.leave()`.** `selfBooble` e `boobleReachIds` entraram na lista
  de campos de sessão; esquecer isso deixa o aviso pendurado ao voltar ao lobby.
- **Mudança em `shared/`** — rode `npm run typecheck` (server + client).

## Como testar

### Servidor, headless (foi o que se fez)

```bash
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= LIVEKIT_URL= LIVEKIT_API_KEY= \
  LIVEKIT_API_SECRET= PORT=3099 npx tsx server/src/index.ts
```

Script de sockets no molde do `smoke-test.mts`, no cenário **Estúdio** (é o único
com `audioZones`). Coordenadas úteis: `(784,144)` é área aberta e `(816,144)`
está na sala de reunião — 32px de distância, zonas diferentes.

Os casos que importam são as recusas e as remoções automáticas: alvo longe, alvo
em outra zona, alvo ausente, alvo em outro mundo, alvo inexistente, alvo = eu,
booble cheia; e depois afastar-se (remove), atravessar a porta (**não** remove),
ficar ausente (remove), cair (dissolve quem sobrou sozinho).

### A regra de volume, sem navegador

`audioVolumeFor` é uma função pura: um script que a chama direto prova a simetria
(`f(naBooble, fora) === f(fora, naBooble)`), a preservação da rampa e a
regressão de quem não está em booble nenhuma.

### Interface — `npm run dev`, 3 abas, cenário Estúdio

1. Os três juntos e falando: todos se ouvem normal (regressão).
2. Ana **encosta** no Bruno (até 2 tiles — o botão só aparece aí) e clica em
   `booble`. Nas três abas: círculo violeta no chão em volta dos dois, **balão de
   cochicho ao lado da cabeça dos dois** (e de mais ninguém), selo na lista, e
   aviso violeta com **Sair** para Ana e Bruno. Na aba da Cida o círculo aparece
   **mais fraco** (não é a booble dela) — o balão, não: ele é igual para todos.
   Os pontinhos da Ana e do Bruno **não** podem estar em uníssono.
3. **A prova**, em `__togetherVoice()`:
   - na aba da Ana: `participants[Bruno].volume === 1` e `[Cida].volume ≈ 0.07`;
   - na aba da Cida: `[Ana].volume ≈ 0.07` **e** `[Bruno].volume ≈ 0.07` (simetria);
   - `elVolume` e `tocando` confirmam que o som chega — "assinado" não basta;
   - `minhaBooble` no topo e `booble` por participante.
   - em `__togetherAvatars()`: `whispering === true` exatamente para quem tem
     `booble !== null`, nas três abas. É o que pega o balão faltando em alguém.
4. Cida chega perto e clica em `entrar` na linha da Ana: os três a 100%, e o
   **círculo cresce** para envolver os três. Ela sai: o círculo encolhe.
5. Cida clica em **Sair**: volta a ouvir os dois a 7%.
6. Bruno entra na sala de reunião: Ana continua ouvindo Bruno a 100%; Cida (sem
   booble, fora da sala) para de ouvi-lo, como hoje.
7. Bruno dá **três passos** para o lado (não precisa ir longe): círculo, selo e
   aviso somem nas três abas e os volumes voltam ao normal. Com dois passos (menos
   de 3 tiles) ele **continua** dentro — é a folga de histerese.
8. Bruno fica **ausente** dentro da booble: sai dela, e Ana pode `chamar`.
9. Zoom mínimo e máximo: o círculo acompanha a câmera e continua sob os pés, e o
   balão continua **legível** — a 0.5x ele tem ~9×5px, que é o zoom em que ele
   corre risco de virar borrão.
10. **Entrar depois**: 4ª aba com a booble já formada — o círculo **e os balões**
    têm de aparecer de saída (o círculo vem do `world:snapshot` → `addRemote` →
    mapa de boobles do `Game`; o balão vem do `setBooble` dentro do `addRemote`).
11. **Sem LiveKit**: com as `LIVEKIT_*` vazias, o botão `booble` ainda tem de
    aparecer e a booble ainda tem de se formar (só não há áudio para priorizar).

## Não verificado

O caminho principal foi **confirmado no navegador** pelo usuário em 2026-08-21
(botão, formação da booble, o círculo no chão, a atenuação audível e a saída no
raio de 3 tiles). Ficaram os cantos: duas boobles próximas se sobrepondo, a
booble de outra pessoa vista de fora, o "+N" do aviso, zoom, e o ambiente **sem
LiveKit** (que é onde o `boobleReachIds` foi corrigido por leitura de código, não
por observação).

Duas entregas posteriores do mesmo dia **não foram vistas na tela**:

- **`BOOBLE_OUTSIDE_VOLUME` a 0,07.** A confirmação de ouvido acima foi feita com
  `0.1`; falta ouvir se a 0,07 a sala **continua perceptível** de dentro da
  booble (7% que na prática virou 0 quebra a promessa da feature).
- **O balão de cochicho.** Só `tsc`, `vite build` e a conferência da geometria e
  da onda por cálculo. Os dois riscos reais são a posição fixa (`CX`/`BOTTOM`)
  em personagens de altura diferente e o tamanho no zoom mínimo.

Ver `PENDENTES.md`.

## Relacionado

- README: [Zonas de áudio (salas fechadas)](../../README.md#zonas-de-áudio-salas-fechadas)
  — o mecanismo que a booble atravessa, e [Arquitetura](../../README.md#arquitetura)
  para a voz por proximidade.
- [Modo ausente (celular)](modo-ausente.md) — ficar ausente sai da booble; a
  pastilha da booble é o molde do `AwayIndicator`.
- [Chamado de quem está ausente ("toc-toc")](chamado-ausente.md) — o outro evento
  de mundo que recusa em silêncio, e a origem do `joinNames`.
