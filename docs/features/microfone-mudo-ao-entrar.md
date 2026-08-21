# Microfone desligado ao entrar (e ao voltar)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Você **sempre chega mudo**. Entrar no mundo, recarregar a página (F5) ou ter a
conexão caído e voltado deixam o botão 🎙️ da barra inferior desligado; para
falar é preciso clicar nele. Nunca se transmite sem um clique deliberado.

Isso vale também para a queda que ninguém percebe: se o socket ou a sala do
LiveKit cai e volta sozinha, o microfone volta **desligado**, não como estava.

## Como funciona

Existem duas representações do estado, e as duas nascem `false`:

- **`micIntent`** (`client/src/voice/VoiceRoom.ts`) — a intenção do usuário. O
  microfone efetivo é `micIntent && !silenced` (`silenced` = surdo ou ausente),
  aplicado por `applyMicState()`, que é o único lugar que chama
  `room.localParticipant.setMicrophoneEnabled()`.
- **`micEnabled`** (`client/src/state/store.ts`) — o espelho para a UI (ícone e
  `aria-pressed` em `MediaControls`, medidor de nível em `AudioSettings`).
  Quem escreve é `applyMicState()`; a UI nunca decide sozinha.

`forceMicOff()` zera `micIntent` e é chamado nos dois momentos em que o áudio
volta a fluir sem gesto do usuário:

1. **sala nova** em `onSocketConnected()` — entrada no mundo, e também qualquer
   reconexão que refaça o token e a sala;
2. **`RoomEvent.Reconnected`** — a reconexão interna do SDK, que **republica as
   faixas locais sozinha**, microfone incluído. Sem este ponto, um blip de rede
   devolvia a pessoa ao ar sem que ela soubesse.

Nada disso é persistido: não há `localStorage` de "eu estava falando". O que
persiste é só a **escolha de dispositivo** (`together:micDeviceId`, em
`voice/mic.ts`), que é outra coisa.

A permissão do navegador continua sendo pedida no clique em "Entrar"
(`probeMic`) — ter permissão não é querer transmitir, e pedir ali é o que faz o
seletor de microfone ter labels e o primeiro clique no 🎙️ ser instantâneo.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/voice/VoiceRoom.ts` | `micIntent = false`, `forceMicOff()`, `applyMicState()`, handler de `RoomEvent.Reconnected` |
| `client/src/state/store.ts` | `micEnabled: false` no estado inicial e no `leave()` |
| `client/src/ui/GameView.tsx` | `setMicEnabled(false)` explícito depois do `probeMic` |
| `client/src/ui/MediaControls.tsx` | botão 🎙️ (só lê o store) |
| `client/src/ui/AudioSettings.tsx` | medidor de nível (só lê o store) |

Nada em `shared/`, nada no servidor, nada no protocolo do Socket.IO: o estado do
microfone nunca saiu do client.

## Decisões e por quê

- **`false` fixo em vez de "lembrar a última escolha".** Uma preferência
  persistida reintroduz exatamente o problema: quem deixou ligado ontem volta
  transmitindo hoje sem clicar em nada.
- **Mudo também no `RoomEvent.Reconnected`, e não só na sala nova.** É a parte
  incômoda da decisão: um blip curto de rede muta você no meio da frase, e é
  preciso clicar de novo. Foi escolhido de propósito — a assimetria de dano é
  clara (um clique perdido contra transmitir sem saber). Se algum dia isso
  incomodar mais que o risco, é **este** handler que se remove, não o resto.
- **`away` e `deafened` não foram tocados.** Ausente e surdo continuam camadas
  por cima que não mexem em `micIntent`, então voltar de ausente reencontra o
  microfone como estava — e depois desta mudança "como estava" já começa mudo.
- **Sem aviso na tela.** O ícone desligado é o próprio aviso. Um toast do tipo
  "seu microfone foi desligado" foi descartado por ora (mais uma coisa
  piscando), mas é o próximo passo natural se alguém reclamar de "sumiu meu
  microfone".

## Armadilhas

- **`applyMicState()` é o único caminho.** `forceMicOff()` só mexe na intenção;
  quem não chamar `applyMicState()` depois deixa a faixa publicada e o store
  mentindo. Todos os chamadores atuais fazem os dois.
- **`applyMicState()` retorna cedo se `opts.micAvailable` for `false`** — sem
  permissão de microfone ele não escreve o store. Só funciona porque o valor
  inicial já é `false`; não conte com ele para "corrigir" o store.
- **O `store.setMicEnabled(false)` do `GameView` parece redundante** com o valor
  inicial, e não é: ele também limpa o que um `leave()` antigo ou um HMR
  deixaram para trás.
- **Não devolva `this.micIntent = opts.micAvailable` ao construtor.** Era essa
  linha que ligava o microfone na entrada.

## Como testar

Precisa de `LIVEKIT_URL`/`LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` definidos (só
confira os nomes no `.env.example`) — sem voz configurada o botão fica
desabilitado e o teste não diz nada.

1. `npm run dev`, entre no mundo: o 🎙️ tem de estar **riscado**, e ninguém na
   outra aba deve te ouvir.
2. Clique no 🎙️, fale (o outro ouve), **F5**: volta riscado e mudo.
3. Reconexão sem perceber: com o mic ligado, mate o servidor por alguns segundos
   e suba de novo (ou desligue o Wi-Fi e religue). Quando o status voltar a
   "Voz conectada", o 🎙️ tem de estar riscado.
4. `__togetherVoice()` no console mostra `micIntent` e o histórico de quedas.

## Não verificado

Nada foi aberto em navegador (registrado em `PENDENTES.md`): os três passos
acima são observação por fazer, e o passo 3 é o único jeito de confirmar que o
handler de `Reconnected` faz o que se espera.

## Relacionado

- [Modo ausente (celular)](modo-ausente.md) — a outra coisa que corta o
  microfone, e que de propósito **não** mexe na intenção.
- [Arquitetura](../README.md#arquitetura) e a linha "Mutar microfone" em
  [Controles](../README.md#controles).
