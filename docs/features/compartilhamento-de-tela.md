# Compartilhamento de tela

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Botão de tela na barra inferior compartilha a sua tela para quem está por perto
(ou para quem está na sua **booble**, atravessando parede). Quem recebe vê uma
**prévia de 240px no topo-centro da tela**, junto de onde aparece o "Na booble ·
Sair"; **clicar na prévia amplia** para a janela inteira, e ali o `⛶` (ou `F`)
entra em fullscreen nativo e `Esc` (ou `✕ Sair`) volta.

Enquanto você compartilha, uma moldura azul enquadra a janela e uma pastilha
"você está compartilhando" pende do topo — é o que evita compartilhar sem
perceber.

## Como funciona

A mídia **nunca passa pelo servidor**: quem publica e distribui é o LiveKit
(SFU). O servidor só é avisado, e só para registrar.

**Publicar** — `VoiceRoom.startScreenShare()` (`client/src/voice/VoiceRoom.ts:820`)
chama `setScreenShareEnabled(true, …)` com:

- `resolution`/`encoding` de `ScreenSharePresets.h1080fps30` — o default do SDK é
  `h1080fps15` (~2,5 Mbps). O dobro de bitrate e de framerate é o que deixa
  código e slides legíveis quando alguém amplia;
- `contentHint: 'detail'` — sem ele o encoder trata a captura como vídeo de
  câmera e borra texto pequeno;
- `audio: false` — áudio de tela não entra; a voz é outra faixa.

Simulcast fica **ligado**: o tile pequeno recebe uma camada baixa e só quem
ampliou paga a resolução cheia.

**Avisar o servidor** — `reportSharing()` (`:289`) espelha em `store.sharing` e
emite `share` (`shared/src/events.ts`). O servidor não repassa a ninguém: ele só
grava em `screen_shares` (`server/src/db.ts:604` `openScreenShare` /
`:620` `closeScreenShare`, chamados de `server/src/handlers.ts:524`). O
`reportSharing` **deduplica** porque quatro caminhos desligam o
compartilhamento: o botão, o "parar de compartilhar" da barra do próprio
navegador (`onLocalUnpublished`, `:510`), o teardown da sala (`:261`) e o
`destroy()`.

**Quem vê** — o portão do vídeo mora no mesmo tick de 250ms (`VOICE_TICK_MS`) da
voz, em `VoiceRoom.tick()` (`:656-673`), e é **binário** — não existe "ver a tela
a 7%" como existe no áudio da booble:

| Condição | Vê |
|---|---|
| mesma booble | sim, mesmo através de parede de zona |
| mesma zona (sala fechada) | sim, a qualquer distância dentro da sala |
| área aberta, `dist <= VIDEO_RADIUS` | sim |
| resto | não (desassina após `DISCONNECT_GRACE_MS` = 2000ms) |

`VIDEO_RADIUS = PROXIMITY_RADIUS + PROXIMITY_HYSTERESIS` (`VoiceRoom.ts:30`) =
6,5 tiles — um pouco mais que o raio audível, para o vídeo não piscar na borda.

**Chegar na tela** — `onTrackSubscribed` (`:385`) guarda a **faixa** (não um
`MediaStream` montado à mão) em `store.addRemoteScreen(participant.identity,
track)`. A identidade no LiveKit é o `socket.id`, então o `peerId` casa 1:1 com o
`roster` — o nome exibido sai sempre do roster, nunca de cópia no store.

**Renderizar** — `client/src/ui/ScreenShareView.tsx`: `.screens` com um
`<button className="screen-tile">` por tela (clicar = ampliar) e, quando há tela
ampliada, `.screen-focus` (`fixed; inset: 0; z-index: 20`).

**Layout** — as prévias e a pilha de avisos vivem na mesma coluna
`.top-center-stack` (`client/src/ui/GameView.tsx`), prévias primeiro. As telas
ficam **lado a lado** (`.screens` é `row` com `wrap`), centralizadas.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/ui/MediaControls.tsx` | o botão (4º da barra), `.media-btn.active` mint quando ligado |
| `client/src/voice/VoiceRoom.ts` | publicar (`startScreenShare`/`stopScreenShare`), o portão de proximidade do vídeo e o `reportSharing` |
| `client/src/ui/ScreenShareView.tsx` | as prévias, o `track.attach()` e a tela ampliada |
| `client/src/ui/GameView.tsx` | a coluna `.top-center-stack` (prévias + avisos) |
| `client/src/ui/SharingIndicator.tsx` | moldura azul + pastilha "você está compartilhando" |
| `client/src/state/store.ts` | `sharing`, `remoteScreens` (`RemoteScreen`), `focusedScreenId` |
| `client/src/styles.css` | `.top-center-stack`, `.screens`, `.screen-tile`, `.screen-focus*`, `.sharing-*` |
| `shared/src/events.ts` | evento `share` (só para o servidor registrar) |
| `server/src/db.ts`, `server/src/handlers.ts` | tabela `screen_shares` |

## Decisões e por quê

**A prévia no topo-centro, e não num canto (2026-08-21).** Ela nasceu no canto
superior direito, junto do zoom e do alerta de chamado. O problema não era
sobreposição — era que ninguém olha aquele canto, então dava para alguém
apresentar e o resto não perceber. O topo-centro é o único ponto da tela por onde
o olho já passa, porque é onde vivem os avisos ("Na booble · Sair", "Reconectando
à voz"). Descartado: um item na barra inferior — ela é de *mídia*, e a prévia não
é controle, é conteúdo.

**A prévia acima dos avisos, não abaixo.** Quando alguém compartilha, a tela é o
assunto; um aviso que desce 150px continua legível. O contrário deslocaria a
prévia a cada chamado, reconexão ou booble — conteúdo que se mexe é pior que
aviso que se mexe.

**240px mantidos.** A prévia não precisa ser legível, precisa ser reconhecível
("é o slide da Ana") e clicável. Diminuir para 120px foi considerado e recusado:
vira só um retângulo cinza, e o clique fica pequeno.

**Lado a lado, não em coluna.** No canto direito empilhar para baixo era grátis.
No topo-centro, duas telas em coluna cobririam o mapa exatamente onde o avatar
costuma estar. `wrap` cobre a janela estreita.

**A tela ampliada não mudou nada.** A entrega de 2026-08-21 é troca de âncora,
não de comportamento: `.screen-focus`, o `⛶`, o `Esc`, a barra que desaparece e o
filtro do tile continuam idênticos. Foi o pedido — "clicar e ampliar, aí segue
normalmente o que temos hoje".

**Portão binário, sem fade.** O áudio da booble tem 7% para quem está fora; o
vídeo não tem meio-termo — ou você vê a tela, ou não vê. Um vídeo a 7% não
significa nada, e "quase ver" a tela de alguém é pior que não ver.

**1080p30 em vez do default.** Custa o dobro de banda de subida de quem
compartilha. A alternativa (o default de 15fps) foi testada e deixava texto
pequeno ilegível na tela ampliada, que é o caso de uso inteiro.

**O servidor sabe, mas não repassa.** Ele poderia broadcastar "X está
compartilhando" — não faz, porque quem descobre isso é o LiveKit pela faixa
publicada, e um segundo canal de verdade divergiria. O evento `share` existe
**só** para o registro em `screen_shares`.

## Armadilhas

- **`track.attach(el)` é obrigatório.** Com `adaptiveStream`, o SDK decide se
  encaminha o vídeo observando os elementos anexados; sem `attach()` ele conclui
  que a faixa está invisível e o servidor **para de enviar** — tela preta, sem
  erro no console. É por isso que `ScreenVideo` é ref + effect e não ref-callback
  (no React 18 o ref-callback não tem cleanup para chamar `detach`).
- **O tile da tela ampliada tem de sair de cena** (o `.filter` em
  `ScreenShareView.tsx:121`). Com dois elementos anexados, o `adaptiveStream`
  mira o maior — manter só o grande é o que garante que a camada pedida seja a de
  resolução cheia.
- **O fullscreen nativo é pedido no `<html>`, não na overlay.** Só o elemento em
  fullscreen e seus descendentes renderizam: pedir na `.screen-focus` apagaria a
  barra de mídia e o aviso de compartilhamento, que são **irmãos** no DOM. É a
  mesma razão pela qual `.media-controls` tem `z-index: 40`, acima dos 20 da
  `.screen-focus`.
- **`.top-center-stack` não pode ganhar `z-index` nem `transform`.** A
  `.screen-focus` é descendente dela. `z-index` criaria um contexto de
  empilhamento e a ampliada deixaria de cobrir a barra de mídia (40). O
  `transform` é **pior**: ele cria contexto de empilhamento **e** bloco contentor
  para descendente `position: fixed`, então o `inset: 0` passaria a medir a coluna
  de 240px em vez da viewport — a tela "ampliada" viraria uma janelinha no topo.
  É por isso que a coluna centraliza com `left: 0; right: 0` + `align-items:
  center`, e não com o `left: 50%` + `translateX(-50%)` que a `.notice-stack`
  usava quando se ancorava sozinha. (A restrição já morou na `.top-right-stack` e
  andou junto com o componente.)
- **`pointer-events` andam em par.** A coluna ocupa a largura toda (é o preço de
  não usar `transform`), então ela **precisa** de `pointer-events: none` — senão
  engoliria todo clique na faixa de cima do mapa. Daí `.screens` também é `none`
  (o espaço entre duas telas tem de deixar o clique passar) e quem religa é
  `.screen-tile`, `.notice` e **`.screen-focus`**. Esquecer o `auto` da
  `.screen-focus` mata os botões `⛶` e `✕ Sair` sem erro nenhum no console.
- **`Esc` tem guard, `F` não.** Com a tela ampliada aberta, o `keydown` é
  registrado na `window` sem checar o alvo — digitar **f** no chat dispara
  fullscreen. Defeito conhecido, registrado em `PENDENTES.md`.
- **Precisa de contexto seguro.** `getDisplayMedia` só existe em HTTPS fora de
  `localhost`: para testar com colegas na rede local, `npm run dev:https`.
- **Sem as `LIVEKIT_*` não há tela nenhuma** — o botão fica desabilitado
  (`voiceStatus === 'unavailable'`).
- **`store.leave()` e o teardown limpam `remoteScreens`.** Sem isso ficava um
  tile renderizando faixa morta para sempre; e `screenSharing` preso em `true`
  fazia `startScreenShare()` retornar cedo **para sempre**.

## Como testar

Precisa das `LIVEKIT_*` definidas (confira a presença pela seção
[Variáveis](../../README.md#variáveis) — nunca leia o `.env`) e de duas abas.
Fora de `localhost`, `npm run dev:https`.

1. `npm run dev`, duas abas, as duas no mesmo mundo e **perto** uma da outra.
2. Aba B: botão de tela → escolher uma janela. Na B aparece a moldura azul e a
   pastilha do topo; o botão fica mint.
3. Aba A: a prévia de 240px aparece **no topo-centro**, com `🖥️ nome`.
4. **Clicar na prévia**: amplia para a janela inteira, e o tile pequeno
   desaparece. `⛶`/`F` entra em fullscreen nativo, `Esc` sai do fullscreen
   primeiro e só depois fecha, `✕ Sair` fecha.
5. Com a ampliada aberta: a barra de mídia continua clicável por cima dela.
6. Entrar numa **booble** com a prévia na tela: o aviso "Na booble · Sair"
   aparece **abaixo** da prévia, sem sobrepor.
7. Clicar no mapa **ao lado** da prévia move o avatar; clicar **na** prévia
   amplia.
8. As duas abas compartilhando: a pastilha azul do topo não cobre a prévia.
9. Afastar os avatares além de 6,5 tiles: a prévia sai após ~2s. Aproximar:
   volta.
10. Entrar numa sala fechada com o outro fora: a tela **não** vaza. Os dois
    dentro: vê a qualquer distância dentro da sala.
11. Parar pelo botão **e** pelo "parar de compartilhar" da barra do navegador —
    os dois têm de apagar a moldura e a prévia do outro lado.

## Não verificado

Ver `PENDENTES.md`. Em resumo: a mudança de layout de 2026-08-21 não foi aberta
num navegador, o `:has()` da colisão com a pastilha nunca foi visto, e o defeito
do `F` no chat segue aberto.

## Relacionado

- [Booble](booble.md) — a tela atravessa a parede de zona para quem está na mesma
  booble, pelo mesmo booleano do áudio.
- [Chamar pelo menu de contexto](chamar-e-ir-ate.md) — a coluna
  `.top-right-stack`, de onde as prévias saíram.
- [Persistência (Supabase)](persistencia-supabase.md) — a tabela `screen_shares`.
- [Zonas de áudio](../../README.md#zonas-de-áudio-salas-fechadas) e
  [Arquitetura](../../README.md#arquitetura).
