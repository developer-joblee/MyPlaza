# Volume por pessoa (voz e soundboard)

**Status:** experimental
**Última atualização:** 2026-08-21

## O que faz

**Botão direito** no boneco de alguém → o menu de contexto tem, abaixo de
**booble** e **chamar**, uma seção **Áudio de X** com dois sliders: **voz** e
**sons**. Eles decidem o quanto *você* ouve *aquela pessoa* — 0% é mudo, e o
ajuste **fica salvo na sua conta**, então vale em qualquer navegador e sobrevive
ao F5, ao seu e ao dela.

Os dois eixos são independentes de propósito: "a voz dela estoura no meu fone"
não é "os sons de soundboard dela me interrompem". E é uma preferência de quem
**ouve**: ninguém é notificado, e ninguém tem como descobrir que foi baixado.

O **volume do soundboard** do painel de sons continua sendo o mestre de todos os
sons. Já o **silenciar uma pessoa** que existia naquele painel (a lista "quem
tocou som") **saiu**: o slider de sons daqui, com 0 no fim do curso, faz o mesmo
e é durável — ver [soundboard](soundboard.md).

## Como funciona

### A chave é um perfil no banco e um `socket.id` na tela

Todo o cliente é chaveado por **`socket.id`**: o roster, o mapa de distâncias, os
participantes do LiveKit. E `socket.id` **morre a cada reconexão** — foi
exatamente esse o argumento que fazia o antigo mute por emissor do soundboard ser
efêmero, e um dos motivos de ele ter sido substituído por esta feature.

Uma preferência durável precisa de identidade durável, que é o `profiles.id`.
Então **o servidor traduz**: ele guarda `peer_audio_prefs(profile_id,
target_profile_id, voice_volume, sound_volume)` e envia ao cliente um mapa
`PeerAudioMap` já chaveado por `socket.id`.

Isso acontece no **join**, em `hydratePeerAudio` (`server/src/audioPrefs.ts`), e
cobre as duas direções num laço só:

1. para quem entrou, o que ele já ajustou de cada presente;
2. para cada presente que já ajustou quem entrou, uma entrada com o `socket.id`
   **novo** — é isso que faz o ajuste sobreviver ao F5 da outra pessoa.

O mapa é sempre **parcial**: quem não está nele está no default
(`PEER_VOLUME_DEFAULT` = 100, ou seja, o comportamento anterior à feature). O
cliente faz *merge*, nunca substituição.

Cada socket lê suas preferências **uma vez**, no join, e guarda em
`socket.data.peerAudio`. O cache não é otimização: sem ele, cada pessoa que
entrasse custaria uma consulta ao banco **por pessoa já presente**.

### Duas funções de volume, e elas não são intercambiáveis

Em `client/src/voice/proximity.ts`:

| Função | Responde | Quem usa |
|---|---|---|
| `audioVolumeFor(self, peer)` | **dá para ouvir esta pessoa?** (booble, zona, distância) | badge `voz` do HUD, anel de "falando", escolha de destinatário do soundboard |
| `peerVolumeFor(self, peer, prefs)` | **que número vai para `setVolume`** (o de cima × a minha preferência) | os dois pontos do `VoiceRoom` que escrevem volume |

A regra continua morando num arquivo só, que é o que a armadilha do
[booble](booble.md) pede — o que ela proíbe é espalhar a regra pelo `VoiceRoom`,
e isso não acontece.

### A cadeia de ganho, inteira

**Voz:** `audioVolumeFor(geometria) × pref.voice / 100`

**Soundboard:** `SOUND_PEAK (0,7) × audioVolumeFor(geometria) × pref.sound / 100
× volumeGlobal / 100`

Os quatro fatores do som são de naturezas diferentes e é por isso que são quatro:
`SOUND_PEAK` é o teto técnico da feature, a geometria é do evento, `pref.sound` é
desta pessoa, e o global é o mestre. **Não adicione um quinto.**

### Aplicar já, gravar depois

O slider aplica **na hora** (`applyPeerAudio` → store + `refreshPeerVolume` na
sala de voz) e grava **500ms depois** (`persistPeerAudio` →
`audio:setPeer`, por ack). Fechar o menu antes do prazo faz o flush.

`refreshPeerVolume` existe porque o tick da voz roda a cada 250ms: esperar por
ele faria o slider responder em degraus e ler como travado.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/types.ts` | `PeerAudioPrefs`, `PeerAudioMap`, `PeerAudioResult`, `PeerAudioErrorReason` |
| `shared/src/constants.ts` | `PEER_VOLUME_MAX`, `PEER_VOLUME_DEFAULT`, `clampPeerVolume` |
| `shared/src/events.ts` | `audio:prefs` (server→client, parcial), `audio:setPeer` (por ack) |
| `db/migrations/0014_peer_audio_prefs.sql` | a tabela, a RLS assimétrica e o grant |
| `server/src/audioPrefs.ts` | a tradução perfil↔socket (`hydratePeerAudio`) e o handler da escrita |
| `server/src/db.ts` | `loadPeerAudioPrefs`, `savePeerAudioPref` (fail-soft por `guard()`) |
| `server/src/handlers.ts` | `SocketData.peerAudio` (o cache) e o gancho no join |
| `client/src/voice/proximity.ts` | `peerVolumeFor` — a única porta para o volume de saída |
| `client/src/voice/VoiceRoom.ts` | usa `peerVolumeFor` no tick e no `onTrackSubscribed`; `refreshPeerVolume`; o `pref` no `__togetherVoice()` |
| `client/src/soundboard/index.ts` | `receiveSound` multiplica por `pref.sound` |
| `client/src/peerAudio.ts` | dono dos efeitos: `applyPeerAudio`, `receivePeerAudio`, `persistPeerAudio` |
| `client/src/net/audioApi.ts` | a fronteira de requisição (sem `once()`) |
| `client/src/state/store.ts` | `peerAudio`, `setPeerAudio`, `mergePeerAudio`, a poda e o reset |
| `client/src/ui/AvatarContextMenu.tsx` | `PeerAudioControls`: os dois sliders, o debounce e o flush |
| `client/src/styles.css` | `.peer-volume` (alias de `.sound-volume`) e `.avatar-menu-audio` |

## Decisões e por quê

- **O servidor traduz perfil→socket, em vez de `profileId` entrar no
  `PlayerState`.** Dois motivos, e o segundo é o decisivo. (a) `profileId` não é
  segredo, mas é uma **capability**: `lobby:addMember(worldId, profileId)`
  consome exatamente esse valor, então publicá-lo no roster deixaria qualquer um
  colher os ids de todos os presentes e passar a poder adicioná-los a mundos que
  administre. É ampliar capability de graça, por uma razão de áudio. (b) Com
  `profileId` no roster, o cliente passaria a ter **duas identidades para a mesma
  pessoa** e a obrigação de manter a junção viva através de reconexão,
  `player:left`/`player:joined` e teardown de sala — e um mapa desalinhado por um
  socket velho é **áudio errado, em silêncio, sem log**.
- **As duas direções do `hydratePeerAudio` num laço só.** Parece redundante e é o
  que fecha uma corrida: se B entra enquanto o `await` do banco de A ainda está no
  ar, o hydrate de B lê o cache de A como vazio e não emite nada para A — mas o
  laço de A, que roda depois do await, já vê B no mundo e cobre. Com uma metade
  só, um dos dois lados ficaria sem a preferência até alguém dar F5.
- **O cache do servidor entra ANTES da escrita, e sobrevive à falha dela.**
  Parece errado e não é: o cache é a verdade **da sessão**, o banco é a verdade
  **entre sessões**. Quando a gravação falha o cliente mantém o valor local (é o
  contrato do volume do soundboard), e um cache sem a entrada faria o F5 do outro
  lado projetar o valor antigo — a pessoa voltaria a 100% no meio da sessão, sem
  nada na tela.
- **O badge `voz` e o anel de "falando" NÃO desaparecem a 0%.** A razão é
  descobribilidade, não pureza: se a pessoa que você zerou ficasse invisível, você
  esqueceria que a zerou e o sintoma seria "não ouço o Bruno" — indistinguível de
  voz quebrada, sem nada na tela apontando a causa. Com o anel aceso e o badge
  presente, ver que ele fala e não sair som **é** o diagnóstico. É o mesmo
  princípio de sempre: silenciar alguém não pode apagar o rastro de que ele
  existe.
  Consequência técnica: `reconcileSpeaking` continua chamando `audioVolumeFor`, e
  essa omissão é **deliberada** — não "conserte" por simetria.
- **A 0% a pessoa continua assinada no LiveKit, com volume 0.** Desassinar
  economizaria uma das 16 vagas de subscrição, e custaria caro no lugar errado:
  subscrição tem quase um segundo de pior caso (é o que o comentário do
  `AUDIO_SUBSCRIBE_RADIUS` diz), então levantar o slider de 0 daria um silêncio
  longo depois do gesto. Pior, tirar de `audioWanted` apaga o badge mas **não** o
  anel, e a inconsistência resultante ("anel aceso, badge apagado") tem como
  explicação o teto de subscrição, que ninguém deduz. Se um dia houver pressão de
  vaga, a saída é **despriorizar** quem está a 0% no `sort` do ranking — uma linha
  no comparador —, nunca excluir.
- **Default 100, e não 70 como o soundboard global.** Aquele nasce baixo porque
  som de soundboard é interrupção de arquivo de terceiro. Aqui o default tem de
  ser exatamente o comportamento de antes da feature: quem nunca abriu o menu de
  ninguém não pode ouvir o mundo diferente de ontem.
- **Escala 0..100 e nada acima de 100.** `RemoteParticipant.setVolume` acaba no
  `.volume` de um `HTMLAudioElement`, que é limitado a 1.0 e ignora o resto — um
  slider que vai a 150% e não faz nada acima de 100 é pior que um que para em 100.
  Amplificar exigiria montar um grafo WebAudio em cima da faixa do LiveKit.
- **`smallint` 0..100 no banco, não `real` 0..1.** Mesma razão da `0012`: é o
  número que a tela mostra e que atravessa a rede duas vezes. A divisão por 100
  acontece só no cliente.
- **Os dois volumes vão juntos no evento, mesmo quando só um mudou.** A linha é um
  upsert do par; mandar um campo só exigiria ler-modificar-escrever no servidor
  para não zerar o outro.
- **A linha não é apagada quando os dois voltam a 100.** Linha ausente e 100/100
  são a mesma coisa para quem lê, então apagar seria uma escrita a mais para
  economizar bytes que ninguém paga.
- **A RLS é assimétrica de propósito.** A política de `select` olha `profile_id`
  (quem ouve) e **nunca** `target_profile_id`. A política "óbvia" que alguém vai
  querer adicionar — poder ler as linhas em que você é o alvo — transformaria a
  tabela num relatório de quem te silenciou. Não adicione, e não crie índice nem
  consulta por `target_profile_id`.
- **O mute por emissor do soundboard (`mutedSenders`) foi removido, e este slider
  ficou como única forma de silenciar uma pessoa.** Por um tempo os dois
  coexistiram, com a divisão "mute rápido de sessão na lista *quem tocou som*,
  slider durável no boneco". Não se sustentou: eram duas respostas para "quanto eu
  ouço essa pessoa", e a da lista era a pior — sumia quando a pessoa parava de
  tocar, e vivia num painel que é sobre os **meus** sons. O 0 do slider cobre o
  caso, e é durável.
- **Nenhum terceiro estágio de gain no `SoundPlayer`.** O fator por emissor é
  propriedade do **evento** (como a distância), então ele multiplica no gain de
  cada som. Consequência, que é o oposto do mestre: mexer no slider de sons de
  alguém **não** muda um som que já está tocando. Aceitável porque sons têm no
  máximo 5s, e é o mesmo comportamento que o mute por pessoa já tem.
- **Arquivo próprio em `net/`, e não uma linha no `worldApi.ts`.** Aquele arquivo é
  inteiro de eventos **sem ack** (devolvem `boolean` de "foi para a rede"), e é
  essa uniformidade que o faz fácil de ler. Aqui é por ack, e o efeito é escrita
  no **perfil** — o mundo entra só como a lista de quem é quem.
- **Sem `once()` na api.** O dedupe descartaria a segunda chamada com a mesma
  chave enquanto a primeira está em vôo — e a segunda é justamente o valor mais
  novo do slider. Tentador aqui, porque a chave natural (`setPeer:${targetId}`)
  pareceria segura. Quem limita a frequência é o debounce da tela.
- **O servidor exige o alvo no mesmo mundo.** Sem isso o handler viraria sonda de
  "esse socket existe?" / "essa pessoa está online?". O preço está nas armadilhas.
- **O `PeerAudioControls` é componente local, não arquivo.** Só este menu o usa; a
  regra do repo manda extrair quando aparece em mais de um lugar.

## Armadilhas

- **"Sua sessão expirou" ao arrastar o slider quase nunca é sessão expirada.**
  `audio:setPeer` responde `invalid-token` e a tela diz isso, mas a causa real já
  foi o token congelado no handshake do socket (aba aberta há mais de 1h) e uma
  falha de infraestrutura disfarçada. Corrigidas na raiz — ver
  [Autenticação e controle de acesso](autenticacao-e-acesso.md).
- **A `0014` é obrigatória junto com este código.** Sem ela os sliders funcionam
  **na sessão** e o valor não sobrevive ao F5 — em silêncio, porque o `db.ts` é
  fail-soft (o motivo aparece como `[db] savePeerAudioPref` no log).
- **O Escape não pode ser barrado pelo slider.** O menu fecha por um listener
  nativo em `document`, e um `stopPropagation()` cru no `onKeyDown` do React
  impede o evento nativo de chegar lá: com o foco no slider, o Escape pararia de
  fechar o menu. Por isso a propagação é barrada **só** para as teclas de
  `RANGE_KEYS`. (O `SoundboardPanel` tem o mesmo shape e o mesmo defeito latente.)
- **`data-capture-keys` no painel é obrigatório.** Sem ele as setas movem o slider
  **e** andam com o avatar. Era a armadilha que o doc do
  [menu de contexto](menu-de-contexto.md) previa para "o primeiro item com input".
- **A altura da seção não pode mudar depois de montar.** O `useLayoutEffect` do
  menu mede **uma vez** para virar a caixa para dentro da janela; uma linha de
  aviso nascendo depois deixaria o painel pendurado fora da tela. É por isso que o
  "não salvo" mora num `<small>` que já existe no cabeçalho da seção.
- **Duas abas da mesma conta divergem.** Cada socket tem seu próprio cache, e não
  há leitura sob demanda: a aba A baixa o Bruno, a aba B continua projetando 100%.
  Mesma classe de obsolescência que o soundboard já assume. A correção (v2) é um
  `audio:prefs` pedido ao abrir o menu.
- **Sair do mundo dentro dos 500ms do último arrasto perde a persistência.** O
  flush manda o evento, o servidor responde `not-found` (o alvo não está mais no
  mundo) e nada é gravado. O valor não se aplicava a ninguém nesta sessão de todo
  jeito; o prejuízo é a próxima vez.
- **`refreshPeerVolume` tem de respeitar `silenced`** (surdo ou ausente), senão o
  slider ressuscita áudio de quem cortou o áudio. Ele checa.
- **`setVolume` do LiveKit não tem rampa** (ao contrário dos 30ms do
  `SoundPlayer`): é `.volume` de um elemento de áudio, aplicado seco. O arrasto
  gera passos pequenos, então na prática não estala; se estalar, a correção é
  throttle no `applyPeerAudio`, não rampa.
- **Um processo só.** `io.sockets.sockets.get(id)` e `io.to(id)` não atravessam
  nós. Já é premissa do repo (o `presence:nudge` faz o mesmo), mas se um dia
  entrar um adapter de Redis, este módulo e o `presence` caem juntos.
- **Mudança em `shared/`** — rode `npm run typecheck` nos dois lados.

## Como testar

Sem banco, com o servidor headless (foi o que se fez):

```bash
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= PORT=3099 npx tsx server/src/index.ts
```

- `audio:setPeer` responde `not-configured` antes e depois do `join`, e lixo
  (alvo vazio/nulo/inexistente/eu mesmo, volume string/negativo/>100/NaN) não
  derruba socket nenhum;
- nenhum `audio:prefs` é emitido sem banco;
- `peerVolumeFor` é função pura e pode ser chamada direto, sem navegador — é
  como a regressão foi verificada.

Com Supabase, `npm run dev`, duas abas e duas contas (aplique a **`0014`** antes):

1. Botão direito no boneco da outra pessoa → a seção **Áudio de X** com os dois
   sliders a 100%.
2. Baixe a **voz** para ~30%: tem de cair **na hora** (não em 250ms), e os
   **sons** dela não podem mudar. Toque um som dela e confirme.
3. Baixe os **sons** para ~20% e toque de novo: sai baixo, e a **voz** continua
   igual.
4. **0%** na voz → silêncio. 0% nos sons → o som nem baixa o arquivo.
5. **F5 na sua aba** → os valores voltam como estavam.
6. **F5 na aba DELA** → os valores continuam valendo, com o `socket.id` novo. É o
   teste que mais provavelmente falha.
7. Outro navegador com a **sua** conta → mesmos valores
   (`select * from peer_audio_prefs;` confere).
8. Arraste de ponta a ponta: **uma** escrita, não dezenas. Feche o menu menos de
   500ms depois de arrastar: tem de gravar.
9. **Escape com o foco no slider fecha o menu**; as **setas** movem o slider e
   **não** andam com o avatar; a roda **sobre o painel** não fecha o menu, e fora
   dele fecha.
10. O menu na borda de baixo da tela vira para dentro (ele está ~90px mais alto).
11. Silenciar a pessoa no painel do soundboard continua funcionando e **não** mexe
    no slider.
12. `__togetherVoice()` no console mostra `geometria`, `meuAjuste` e `volume` por
    participante — é como se responde "por que essa pessoa está baixa".

## Não verificado

Nada foi aberto num navegador e nada rodou contra um Supabase real. Ver
`PENDENTES.md`.

## Relacionado

- [Soundboard gamificado](soundboard.md) — o volume global, o mute por pessoa e a
  cadeia de ganho dos sons
- [Booble](booble.md) — a regra de audibilidade que as duas funções compartilham
- [Menu de contexto no avatar](menu-de-contexto.md) — onde os sliders moram
- [Persistência (Supabase)](persistencia-supabase.md) — `guard()` e fail-soft
- README: [Controles](../../README.md#controles) e o índice de Features
