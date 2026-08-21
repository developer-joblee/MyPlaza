# Modo ausente (celular)

**Status:** em uso
**Última atualização:** 2026-08-20

## O que faz

O botão de **celular** na barra inferior liga a ausência. Enquanto ausente:

- **microfone e áudio ficam cortados** — a pessoa não fala e não ouve ninguém;
- **o avatar dela muda de pose**: passa a mexer no celular, virado para a câmera;
- **uma mini-tela ao lado da cabeça mostra um feed rolando** em loop, e
- **uma pastilha "ausente" fica acima do nome** dela no mundo;
- na lista do HUD a linha dela apaga (55%) e ganha o selo `ausente` e o botão
  **chamar** (ver [Chamado de quem está ausente](chamado-ausente.md)).

**Andar volta ao normal**: qualquer tecla de movimento desfaz a ausência. As
preferências de microfone e fone são preservadas — voltar devolve o estado
anterior, não "tudo ligado".

Os três sinais visuais valem para **todo mundo**: no seu avatar e no dos outros.

## Como funciona

O estado mora em quatro lugares e quem garante a ordem é **`client/src/presence.ts`**:

```
setAway(true) → store.setAway   (UI: botão âmbar, selo na lista, limpa nudges)
              → voice.setAway   (desassina o áudio no SFU + muta o mic)
              → game.setSelfAway(true) → Avatar.setAway  (pose + indicador)
              → api.setAway(true) → evento `away` → server → `player:away`
```

Do outro lado, `Game.ts` liga `player:away` em `remote.avatar.setAway(away)` e
em `store.setPlayerAway`, e quem **entra depois** recebe o estado no
`world:snapshot` (`spawnRemote` já chama `avatar.setAway(p.away)`). Ou seja:
**tudo passa por `Avatar.setAway`** — local, remoto e snapshot —, e é por isso
que o indicador visual não precisou de nenhum caminho novo.

### A pose

`frames.phone` (`characterDefs.ts`): **linha 6** da spritesheet do LimeZu, **9
quadros**, a `phoneFrameS = 0,16s`. Existe **numa direção só** (de frente), e
por isso quem fica ausente aparece virado para a câmera independentemente de
para onde estava olhando. No `Avatar.update`, a pose de ausente **ganha de
sentar e de andar** — é a informação mais útil para quem olha.

### O indicador (`AwayIndicator.ts`)

Criado **na primeira vez** que aquele avatar fica ausente (a maioria nunca
fica), e a partir daí só liga/desliga. Duas peças, ambas em `Graphics`/`Text`,
em coordenadas locais do `Avatar.view` — ou seja, em pixels do mundo, o que faz
elas acompanharem o zoom da câmera igual ao nome:

- **A telinha**, 13×18px à direita da cabeça (o corpo ocupa x −16..16). Dentro,
  quatro "cards" — miniatura + duas linhas — subindo a `FEED_SPEED = 14 px/s`
  com passo `CARD_PITCH = 6`, recortados por uma máscara. O `offset` é
  `% CARD_PITCH`, então o conjunto é cíclico e o loop não tem emenda.
- **A pastilha "ausente"**, centrada acima do nome. A posição sai do próprio
  `label` (`label.y − label.height − PILL_GAP`), não de uma constante, porque
  `labelY` varia por personagem.

As cores espelham o `styles.css`: `--amber` `#f4a261` e o painel `#181a22`, as
mesmas do botão `.media-btn.away` e do selo `.roster .ausente`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/presence.ts` | `setAway()` — o único ponto que orquestra store + voz + jogo + rede |
| `client/src/ui/MediaControls.tsx` | o botão de celular (âmbar quando ligado) |
| `client/src/ui/Hud.tsx` | selo `ausente` e linha apagada na lista |
| `client/src/game/Avatar.ts` | troca a pose e liga o `AwayIndicator` |
| `client/src/game/AwayIndicator.ts` | a telinha com o feed e a pastilha "ausente" |
| `client/src/game/characterDefs.ts` | `PHONE_ROW`, `PHONE_FRAMES`, `phoneFrameS` |
| `client/src/game/Game.ts` | `player:away` nos remotos; andar ausente chama `setAway(false)` |
| `client/src/voice/VoiceRoom.ts` | `setAway()` — desassina o áudio no SFU e muta o mic |
| `client/src/state/store.ts` | `away`, `setAway`, `setPlayerAway` |
| `server/src/handlers.ts` | evento `away` → difunde `player:away` |

## Decisões e por quê

- **A pose sozinha não bastava.** A animação do celular é discreta e, de longe
  ou num mapa cheio, some no meio do idle dos outros — a pessoa parecia estar
  ali. A telinha com o feed rolando dá **movimento** que nenhum outro estado do
  jogo tem, e é o que o olho pega na periferia.
- **Feed rolando, e não "zZz" nem brilho de tela.** "Dormindo" é outra história
  (a pessoa não está dormindo, está em outra janela) e o brilho pulsando é
  bonito mas ambíguo — combina com "falando", "selecionado", qualquer coisa. O
  feed passando conta exatamente o que a pose já diz, em movimento.
- **Pastilha com a palavra "ausente", e não um ícone.** Ícone precisa de
  legenda; o mundo não tem tooltip. E a palavra é **a mesma** que o HUD usa na
  lista, então quem olha o avatar e quem olha a lista leem a mesma coisa. O
  custo é ocupar mais largura acima da cabeça — aceito, porque a pastilha só
  existe enquanto a pessoa está ausente.
- **Tudo em `Graphics`, nenhum asset.** Os packs de arte do projeto são em parte
  **não-comerciais** e todo asset exige crédito no README (ver `CLAUDE.md`). Um
  indicador de 13×18px não vale esse peso, nem uma dependência nova. Mesmo
  raciocínio do som em `ui/knock.ts`.
- **Dentro do `Avatar.view`, não numa camada de HUD.** A alternativa era
  desenhar os indicadores em coordenadas de tela, sobre o canvas. Ficaria
  legível em qualquer zoom, mas exigiria projetar a posição de cada avatar a
  cada frame e reintroduziria o acoplamento React↔Pixi que o projeto evita. No
  `view`, o indicador herda posição, zoom e a ordenação por `y` de graça.
- **Criado na primeira ausência (lazy).** Um `Text` e sete `Graphics` por
  avatar, para um estado que a maioria nunca entra, é desperdício em memória e
  em objetos de cena. `setAway` é o único caminho, então a criação preguiçosa
  não tem outro ponto de entrada para esquecer.
- **A pose de ausente ganha de sentar.** Quem ficou ausente sentado aparece de
  pé mexendo no celular. É deliberado: "não está ali" é mais útil do que "está
  na cadeira", e não existe pose de sentar-com-celular na sheet.
- **Andar cancela a ausência.** Está em `Game.ts` (`keyboard.moving &&
  store.away → setAway(false)`), não na UI: quem voltou para o teclado voltou,
  e obrigar a clicar de novo no botão só produziria gente "ausente" andando.

## Armadilhas

- **`setAway` do `presence.ts` é o único caminho.** Escrever `store.setAway`
  direto deixa a voz, o avatar e os outros clientes desatualizados — e o aviso
  do "toc-toc" pendurado (a limpeza de `nudges` está no `store.setAway`).
- **`Avatar.setAway` sai cedo se o valor não mudou** (`if (this.away === away)
  return`). Qualquer efeito novo de ausência colocado ali herda esse curto-circuito.
- **A máscara do feed é irmã do container, não filha.** Ela vive nas coordenadas
  do indicador, enquanto o `feed` já está deslocado para dentro da telinha; e no
  Pixi a máscara precisa estar na árvore de exibição para valer.
- **`roundRect` do Pixi não limita o raio.** A pastilha usa `h / 2`; um valor
  maior que a metade da menor dimensão (o clássico `99` do CSS) deforma o desenho.
- **A telinha fica sempre à direita.** A pose do celular só existe de frente,
  então não há lado "errado" — mas se algum dia entrar uma pose de celular por
  direção, a posição precisa acompanhar.

## Como testar

`npm run dev`, duas abas:

1. Aba 1 entra como Ana, aba 2 como Bruno, e aproxime os avatares.
2. Bruno clica no **botão de celular**. Na aba dele **e** na da Ana: pose do
   celular, telinha com o feed subindo em loop (sem emenda no ciclo) e pastilha
   **ausente** acima do nome. Na lista, a linha do Bruno apaga e ganha o selo.
3. Zoom para dentro e para fora (`ZoomControls`): a telinha e a pastilha escalam
   junto com o nome, sem sair do lugar.
4. Bruno **anda**: tudo volta ao normal na hora, nas duas abas, e o mic/fone
   dele voltam como estavam.
5. Bruno fica ausente **sentado** (`E` numa cadeira, depois o botão): ele
   levanta a pose para o celular. Sair da ausência volta a sentar.
6. **Entrar depois**: com o Bruno já ausente, abra uma terceira aba. O avatar
   dele tem de nascer com a pose e o indicador (vem do `world:snapshot`).

## Não verificado

Nada do indicador foi visto num navegador — só `npm run typecheck` e
`npm run build`. Ver `PENDENTES.md`.

## Relacionado

- [Chamado de quem está ausente ("toc-toc")](chamado-ausente.md) — como alguém
  traz de volta quem está ausente.
- README: [Controles](../../README.md#controles).
