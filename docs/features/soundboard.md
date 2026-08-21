# Soundboard gamificado

**Status:** experimental
**Última atualização:** 2026-08-21

## O que faz

Cada pessoa sobe seus próprios sons curtos (até **5s**) e toca para quem está por
perto, pelo botão de **grade** na barra inferior. Quantos sons ela pode ter é
**conquistado pelo tempo na plataforma**: 1h libera o primeiro, 8h o segundo, e
assim por diante até cinco.

Quem ouve, ouve como ouviria uma voz: o volume cai com a distância, sala fechada
não deixa o som atravessar, e dentro de uma booble o som vem cheio. O painel tem
um **volume só do soundboard** — não mexe na voz das pessoas e fica salvo no
perfil, então vale em qualquer navegador — mais o silenciar rápido, de todos ou de
uma pessoa específica.

## Como funciona

Três partes independentes: a progressão, a biblioteca e o disparo.

### A progressão (tempo → slots)

O tempo acumulado é **creditado em fatias** de `PRESENCE_CREDIT_MS` (60s) na
coluna `profiles.presence_seconds`, por um timer por socket em `handlers.ts`. O
`disconnect` credita o pedaço final. O incremento vai por RPC
(`app_add_presence_seconds`) porque precisa ser `x = x + n` no banco.

A tabela de marcos vive em **`shared/src/levels.ts`** (`PRESENCE_LEVELS`), com
`slotsFor(seconds)` como a função que o servidor usa para autorizar e o cliente
para desenhar a grade.

### A biblioteca (upload e remoção)

Três eventos **por ack**, no molde do lobby: sucesso devolve o estado inteiro
(`SoundboardState`), então a tela nunca precisa refazer o `list`. Os bytes do
arquivo vão **no próprio ack** do Socket.IO; o servidor sobe para o bucket
privado `soundboard` com a `service_role` e assina a URL de leitura por 4h.

Limites, todos em `shared/src/constants.ts`: `SOUND_MAX_BYTES` (512 KB, o limite
**duro**), `SOUND_MAX_MS` (5000, conferido **no cliente**), `SOUND_MIME`
(whitelist) e `SOUND_LABEL_MAX` (24).

**Recorte** (`client/src/soundboard/trim.ts` + `ui/ClipPicker.tsx`): antes de
subir, o cliente decodifica o arquivo. Se ele cabe nos dois limites, sobe
**intacto**. Se não, abre o seletor de trecho: a onda é uma miniatura desenhada em
canvas (picos por faixa), a janela de 5s é um overlay em CSS movido por um
`<input type="range">`, e o botão **Ouvir** toca exatamente o que vai ser salvo.
Confirmado, o `OfflineAudioContext` renderiza o trecho em mono a
`SOUND_TRIM_RATE` (22,05 kHz), com fade de `SOUND_TRIM_FADE_MS` nas **duas**
pontas, e sai um WAV de ~215 KB.

### O volume (preferência de quem ouve)

`profiles.soundboard_volume` (0..100, default `SOUND_VOLUME_DEFAULT` = 70) viaja
no `SoundboardState` e é aplicado num **gain mestre** do `SoundPlayer`, por onde
todo som passa antes do destino — é isso que faz arrastar o slider mudar o som que
**já está tocando**. São dois estágios independentes: a atenuação por distância é
o gain de cada som, a preferência é o mestre. Não toca na voz.

### O disparo (quem ouve, e quanto)

1. **Client** → `soundboard:play(soundId)`, sem ack.
2. **Server** confere que o som é seu, que o slot continua liberado e o cooldown
   (`SOUND_COOLDOWN_MS` = 6s, por **emissor**). Recusa em silêncio.
3. **Server escolhe os destinatários** — `audienceFor(world, selfId)`: quem está
   no raio audível **e** na mesma zona, mais quem está na mesma booble. Emite
   `soundboard:played` só para eles, um `io.to(id)` por pessoa.
4. **Client** aplica o volume com **`audioVolumeFor`** — a mesma função da voz —
   e toca em WebAudio (`SoundPlayer`), com o áudio cacheado por `soundId`.

O servidor decide **quem**; o cliente decide **quanto**. É a mesma divisão que a
voz já usa.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/levels.ts` | `PRESENCE_LEVELS`, `slotsFor`, `nextLevel`, `secondsToNextLevel` |
| `shared/src/constants.ts` | `SOUND_*`, `PRESENCE_CREDIT_MS`, `isUuid`/`isSoundMime` |
| `shared/src/types.ts` | `UserSound`, `SoundboardState`, `SoundboardResult`, `SoundboardErrorReason` |
| `shared/src/events.ts` | `soundboard:list/upload/remove` (ack), `soundboard:play`, `soundboard:played` |
| `shared/src/map.ts` | `distancePx` — a conta de "perto", uma vez só para os dois lados |
| `db/migrations/0010_soundboard.sql` | `presence_seconds`, `user_sounds`, `app_add_presence_seconds`, bucket privado |
| `server/src/soundboard.ts` | os quatro handlers e o `audienceFor` |
| `server/src/db.ts` | `listUserSounds`, `getUserSound`, `insertUserSound`, `deleteUserSound`, `loadPresenceSeconds`, `addPresenceSeconds` |
| `server/src/handlers.ts` | crédito de presença (`startPresenceCredit`/`creditPresence`/`stopPresenceCredit`) |
| `client/src/soundboard/trim.ts` | decodifica, recorta o trecho escolhido, reescreve em WAV, gera os picos da onda e toca a prévia |
| `client/src/ui/ClipPicker.tsx` | o seletor de trecho: onda, janela de 5s, prévia |
| `db/migrations/0011_soundboard_wav.sql` | o bucket passa a aceitar `audio/wav` |
| `db/migrations/0012_soundboard_volume.sql` | `profiles.soundboard_volume` (0..100) |
| `client/src/soundboard/SoundPlayer.ts` | WebAudio: download, decode, cache, teto de simultâneos |
| `client/src/soundboard/index.ts` | dono dos efeitos: `playSound`, `receiveSound`, `refreshSoundboard` |
| `client/src/net/soundboardApi.ts` | a fronteira de requisição do soundboard |
| `client/src/ui/SoundboardPanel.tsx` | a grade, o upload, o progresso e os dois mutes |
| `client/src/ui/MediaControls.tsx` | o botão da barra (desabilitado sem conta) |
| `client/src/ui/icons.tsx` | `SoundboardIcon`, `MuteSenderIcon` |
| `client/src/state/store.ts` | `soundboard`, `soundboardMuted`, `mutedSenders`, `soundSenders` |

## Decisões e por quê

- **O servidor escolhe quem ouve; o cliente, o volume.** A alternativa era
  difundir para o mundo e filtrar no cliente — descartada porque entregaria o
  evento (e a URL do áudio) a quem não deveria nem saber que aconteceu, e um
  cliente adulterado ouviria o mapa inteiro. O inverso — o servidor calcular o
  volume — foi descartado porque a posição dele é de até 66ms atrás e a regra
  (`audioVolumeFor`) já existe no cliente.
- **Volume pela MESMA função da voz.** `receiveSound` chama `audioVolumeFor`, não
  uma regra própria. Uma segunda regra de audibilidade divergiria da primeira na
  primeira alteração — foi exatamente o que aconteceu quando ela estava copiada
  em dois pontos do `VoiceRoom`, e a divergência aqui é audível.
- **WebAudio local, não faixa no LiveKit.** Publicar o som como track na sala
  mexeria na conta de subscrições (que tem teto), e o token é assinado com
  `canPublishData: false`. Mais forte que isso: o soundboard tem de funcionar em
  ambiente **sem** LiveKit, como o resto do app.
- **Tempo creditado em fatias, não somado de `sessions` na leitura.** Somar é a
  armadilha deste schema: sessão que morre com o processo fica com `left_at is
  null` para sempre, e `coalesce(left_at, now())` — o que a `v_place_activity`
  faz — contaria dias de quem saiu. Em fatias de 60s, uma queda custa 60s.
- **Marcos fixos, não fórmula linear.** Curva linear vira grind: o próximo slot
  está sempre à mesma distância. Marco tem nome, aparece na tela ("faltam 3h") e
  cresce, então o quinto som custa mais que o segundo. A primeira hora dá o
  primeiro slot porque no dia zero ninguém tem tempo, e uma grade toda bloqueada
  é a pior primeira impressão possível.
- **`levels.ts` separado das constantes.** A progressão vai crescer para além de
  tempo (a intenção declarada). O que muda quando isso acontecer é a conta que
  produz o número; a tabela e quem a consome ficam. Por isso as funções recebem
  **segundos** e não olham banco nenhum.
- **Bytes pelo ack do Socket.IO.** As outras duas opções eram piores: upload
  direto do navegador para o Storage exigiria abrir política de INSERT em
  `storage.objects`, o inverso do invariante "só o servidor escreve"
  (`0002_rls.sql`); e uma rota HTTP nova teria de nascer no `node:http` cru do
  `index.ts`, cujo fallback de SPA responde `200 index.html` a qualquer path
  desconhecido — endpoint mal roteado "funcionaria" devolvendo HTML.
- **Recortar, não recusar.** "Esse áudio tem 12s" é uma recusa correta e péssima:
  ninguém abre um editor de áudio para usar um botão de soundboard.
- **A pessoa escolhe o trecho.** A primeira versão cortava os primeiros 5s e
  avisava; funcionava e era ruim para o caso mais comum, porque o pedaço que se
  quer quase nunca está no começo do arquivo — está no meio da fala, da risada,
  da música. Sem escolher, a saída era cortar fora do app e voltar, que é
  exatamente o que a feature existe para evitar.
- **O seletor é uma miniatura, não um editor.** Sem zoom, sem fim independente (a
  janela é sempre de 5s), sem arrastar na onda. O controle de verdade é um
  `<input type="range">`, que já vem com teclado, foco e leitor de tela — um
  handle desenhado em canvas não tem nada disso, e teria de reimplementar tudo.
- **A onda é canvas; a janela de seleção é CSS.** Arrastar o slider mexe só em
  `left`/`width` (composição na GPU) em vez de repintar a onda a cada pixel. E os
  picos são o **máximo absoluto** por faixa, nunca a média: média de sinal de
  áudio tende a zero e desenharia uma linha reta.
- **A prévia soa igual ao que vai ser salvo** (mesmo fade das pontas) e usa um
  `AudioContext` próprio, não o `SoundPlayer` — aquele é o dono dos sons do
  soundboard, com teto de simultâneos, e uma prévia não deve contar como som
  tocando.
- **O corte reencoda em WAV, e o corte acontece no áudio decodificado.** Truncar
  os bytes de um mp3/ogg/webm produz arquivo inválido (frames pela metade,
  duração mentindo no cabeçalho), então não há atalho: é decodificar, cortar,
  reencodar. WAV é um cabeçalho de 44 bytes na frente de PCM — ~40 linhas, sem
  dependência e sem variação entre navegadores. A alternativa era `MediaRecorder`
  sobre um `MediaStreamDestination`, que daria opus (~40 KB em vez de ~215 KB), e
  foi descartada por dois motivos: grava em **tempo real** (5s de espera olhando
  um botão) e o suporte varia — Safari grava mp4/aac, não webm/opus, o que
  significaria dois caminhos para manter. Comprimir melhor um arquivo que já cabe
  no teto não paga isso.
- **`audio/wav` entrou na whitelist por causa do corte.** Ele estava fora por
  tamanho, e continua sendo o pior formato para upload arbitrário — mas o wav que
  **nós** geramos é mono, 22,05 kHz e no máximo 5s, ou seja tem teto conhecido.
  Quem insistir em subir um wav de 44,1 kHz estéreo bate no `SOUND_MAX_BYTES`, que
  é o limite duro de qualquer forma.
- **Duração conferida só no cliente.** Medir 5s no servidor exigiria decodificar
  áudio em Node, ou seja **dependência nova**, que a regra do repo manda
  perguntar antes. O limite que o servidor impõe é o de bytes, e ele é duro. É
  uma limitação consciente: um cliente adulterado sobe 4s de áudio dizendo que
  são 500ms, e o efeito é um número errado na legenda do botão dele.
- **Fade de 40ms nas DUAS pontas.** Cortar no meio de uma onda deixa
  descontinuidade, e descontinuidade **estala** — é o mesmo motivo do envelope
  explícito de cada batida do `knock.ts`. Com o corte fixo no começo o fade de
  entrada não fazia falta (quase todo arquivo começa em silêncio); com trecho
  escolhido no meio, faz.
- **Bucket privado com URL assinada.** Público seria mais simples e está errado:
  a URL de bucket público é adivinhável a partir do caminho, e o caminho contém o
  `profile_id`. O áudio é da pessoa, não do mundo. Mesmo desenho do token do
  LiveKit assinado em `voice.ts`.
- **Cache por `soundId`, nunca por URL.** A URL é assinada e muda a cada 4h;
  cachear por ela baixaria tudo de novo a cada reassinatura.
- **Cooldown por emissor, não por par.** No `presence:nudge` o cooldown é por par
  porque o alvo é uma pessoa. Aqui o alvo é todo mundo que está perto, então "um
  cooldown por alvo" seria nenhum cooldown.
- **O som toca local para quem disparou.** `audienceFor` exclui o emissor, então
  sem o eco local a pessoa clicaria e não ouviria nada — o que lê como botão
  quebrado.
- **Surdo e ausente NÃO ouvem soundboard** — ao contrário do "toc-toc", que
  atravessa de propósito. O chamado é a campainha da porta, dirigida a você; o
  soundboard é a conversa da sala, e quem cortou a sala cortou isso também.
- **Silenciar uma pessoa mora no painel, não na linha do roster.** A linha tem
  uma cadeia de badges **exclusivos** (ausente > booble > voz, um só carrega o
  `margin-left:auto`); um botão a mais ali quebraria essa precedência por um caso
  raro. Em troca, o store guarda `soundSenders` (quem tocou som, teto de 8) para
  o painel ter em quem clicar — registrado **antes** das guardas de mute, senão
  silenciar alguém apagaria o botão de desfazer.
- **O volume vive no banco; o mute rápido, no navegador.** Parecem a mesma coisa e
  não são. Microfone escolhido, cancelamento de ruído e "não quero ouvir agora"
  são propriedades do **dispositivo** — o microfone do laptop não é o da mesa. Já
  "som de soundboard me incomoda a 100%" é propriedade da **pessoa**, e refazer
  esse ajuste em cada navegador é o tipo de atrito que faz alguém desistir da
  feature. Por isso `soundboard_volume` é coluna de `profiles` e `soundboardMuted`
  é `localStorage`. Os dois juntos são o par slider + botão de qualquer mixer.
- **Volume é `smallint` 0..100, não `real` 0..1.** É o número que a tela mostra e
  que atravessa a rede duas vezes; inteiro não vira `0.7000000000000001` no
  banco. A divisão por 100 acontece num lugar só, no `SoundPlayer`.
- **Gain mestre, não multiplicar no gain de cada som.** Sem o mestre, mudar o
  volume só valeria para o próximo disparo — arrastar um slider e não ouvir
  diferença lê como controle quebrado. A mudança entra por rampa de 30ms, porque
  salto de gain em som que já está tocando **clica**.
- **Aplica na hora, grava com debounce.** Um slider dispara `change` a cada
  movimento: sem atraso, um arrasto seria dezenas de escritas no perfil. E
  `setVolume` é a única operação da api **sem** `once()` — aquele dedupe descarta
  a segunda chamada com a mesma chave, e aqui a segunda é justamente o valor mais
  novo; o último tem de ganhar. Fechar o painel grava o pendente na hora.
- **Falhar ao gravar não desfaz o volume local.** A pessoa continua ouvindo o que
  escolheu nesta sessão, com um aviso de que não ficou salvo. Fazer o áudio pular
  de volta sozinho seria pior que o aviso.
- **Valor inválido cai no default, nunca em 0.** `clampVolume` confere o `typeof`
  antes de converter, porque `Number(null)`, `Number('')` e `Number(false)` valem
  todos **0** — um valor ausente silenciaria a pessoa. Foi um teste que pegou a
  divergência entre o comentário e o código.
- **`soundboardMuted` é preferência; `mutedSenders` é sessão.** O primeiro fica
  no `localStorage` e sobrevive a sair do mundo (quem desligou tinha um motivo
  que não muda ao trocar de mapa). O segundo morre com a conexão, porque a chave
  é `socket.id` — e "silenciar o Bruno para sempre" é moderação, que ficou fora.
- **`distancePx` promovida ao `shared`.** `Math.hypot` estava copiado três vezes
  no `Game`, uma no `World`, e o servidor precisava de uma quinta. É o mesmo
  movimento que `audioZoneAt` já sofreu: servidor e cliente não podem discordar
  sobre geometria.
- **A feature rompe o "sem asset novo" do `knock.ts`, e está certo.** Aquela
  regra existe por **licença**: os packs de arte do projeto são em parte
  não-comerciais e todo asset de terceiro exige crédito no README. Aqui o áudio é
  **do usuário**, subido por ele, e não entra no repo nem no bundle — não há nada
  a creditar e nenhuma licença nova. Nenhuma dependência foi adicionada: o
  `@supabase/supabase-js` já estava nos dois lados e o resto é WebAudio na mão.

## Armadilhas

- **A `0010` é obrigatória junto com este código.** Sem ela o painel abre vazio e
  todo upload falha **em silêncio** (`db.ts` é fail-soft) — o motivo aparece só
  como `[db] insertUserSound` no log do servidor.
- **O bucket pode não ter sido criado.** O `insert into storage.buckets` exige
  privilégio no schema `storage`; se ele falhar, o resto da migração passa e só o
  upload quebra. Confira em *Storage* que existe um bucket **privado**
  `soundboard`.
- **Sem Supabase não há soundboard**, e isso é por desenho (não há Storage nem
  tempo acumulado). O botão da barra fica desabilitado com o motivo no `title`.
- **O upload sobe o arquivo ANTES de gravar a linha**, e a remoção apaga a linha
  antes do arquivo. As duas ordens são deliberadas: a falha possível é um arquivo
  órfão no bucket (invisível, sobrescrito no próximo upload do mesmo slot), nunca
  uma linha apontando para arquivo que não existe — que apareceria na grade e não
  tocaria.
- **`AudioContext` pode nascer suspenso.** Como no `knock.ts`, o `resume()` é
  fire-and-forget e a falha é engolida: o slot aceso é o retorno visual quando o
  navegador bloqueia o som. Um clique em qualquer lugar da página resolve.
- **O tempo mostrado pode estar até 1min atrasado** (é o tamanho da fatia de
  crédito). Não é bug: creditar a cada segundo seria uma escrita por segundo por
  pessoa.
- **O corte roda no navegador e não se testa por `tsc`.** `AudioContext` e
  `OfflineAudioContext` não existem no Node, então `prepareSound` só se verifica
  na tela. O que dá para verificar sem navegador é o `encodeWav` (e foi feito):
  cabeçalho RIFF errado gera arquivo que não toca em lugar nenhum.
- **O bucket tem a própria whitelist de MIME, e ela não se atualiza sozinha.**
  Foi o primeiro erro real da feature: o `insert into storage.buckets` da `0010` é
  `on conflict do nothing`, então quem já tinha o bucket não ganhou `audio/wav`
  quando o recorte passou a existir — o upload falhava com `mime type audio/wav is
  not supported` e a tela mostrava o erro genérico. Corrigido pela **`0011`**, e o
  `insertUserSound` agora nomeia essa causa no log.
- **`SOUND_TRIM_RATE` e `SOUND_MAX_BYTES` andam juntos.** O teto de bytes só é
  seguro porque 5s mono a 22,05 kHz dão ~215 KB. Subir a taxa sem olhar o teto faz
  o próprio corte passar a ser recusado.
- **Mudança em `shared/`** — os dois lados compilam contra os mesmos tipos: rode
  `npm run typecheck` (server + client).

## Como testar

Sem banco (é o que já foi feito), com o servidor headless:

```bash
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= PORT=3099 npx tsx server/src/index.ts
```

- os três eventos por ack respondem `not-configured`;
- `soundboard:play` com id inválido ou inexistente é ignorado sem derrubar
  socket;
- `audienceFor` (exportada de `server/src/soundboard.ts`) pode ser exercitada
  direto com um `World` de verdade, sem socket nem banco — é como a regra de
  perto/zona/booble foi verificada contra o mapa do Estúdio.

Com Supabase, `npm run dev` e duas abas (aplique a `0010` antes):

1. Abas 1 e 2 entram no mesmo mundo, com contas diferentes.
2. Abra o painel pelo botão de grade. Com menos de 1h acumulada, todos os slots
   aparecem bloqueados — para testar sem esperar, adiante o tempo com
   `update profiles set presence_seconds = 90000 where id = '<seu id>';`.
3. Clique num slot vazio e escolha um mp3 de ~2s: ele aparece na grade.
3b. Repita com um mp3 **longo** (uma música inteira): em vez de subir, o painel
    abre o seletor. Arraste a janela até o meio, clique em **Ouvir** (tem de tocar
    exatamente aquele trecho, sem estalo nas pontas), e salve — o som guardado tem
    de ser o trecho escolhido, não o começo do arquivo. Teste também o slider pelo
    **teclado** (setas), e confirme que as setas não andam com o avatar.
4. Toque: você ouve na aba 1 e a aba 2 ouve também. Afaste os avatares além de 5
   tiles e toque de novo — a aba 2 não deve ouvir.
5. Entre na sala de reunião do Estúdio com a aba 1 e toque: a aba 2, fora da
   sala, não ouve. Abra uma booble entre as duas e repita: ouve, mesmo longe.
6. Desligue "Ouvir sons de outras pessoas" na aba 2 e confirme o silêncio; ligue
   e silencie **só a pessoa** na lista "Quem tocou som".
6b. Baixe o **Volume dos sons** na aba 2 **durante** um som tocando: tem de cair
    na hora, sem clique. Recarregue a página e confirme que o valor voltou como
    estava — é o que prova que a coluna gravou
    (`select soundboard_volume from profiles where id = '<id>';`). Confirme também
    que o volume **da voz** não mudou.
7. Clique duas vezes em sequência: o segundo som não sai (cooldown de 6s).
8. Remova o som e confirme que o slot volta a ficar vazio.

## Não verificado

Nada com Supabase real foi executado — nenhuma linha de `user_sounds`, nenhum
byte no Storage, nenhum crédito de presença gravado, e nenhuma tela vista num
navegador. Ver `PENDENTES.md`.

## Relacionado

- [Booble](booble.md) — a regra de audibilidade que o soundboard reusa.
- [Chamado de quem está ausente](chamado-ausente.md) — o precedente de evento
  efêmero com som, e a decisão oposta sobre atravessar o silêncio.
- [Persistência (Supabase)](persistencia-supabase.md) — `guard()`, fail-soft e a
  distinção histórico × estado.
- README: [Controles](../../README.md#controles) e o índice de Features.
