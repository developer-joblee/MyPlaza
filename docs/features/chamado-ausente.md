# Chamado de quem está ausente ("toc-toc")

**Status:** em uso
**Última atualização:** 2026-08-20

## O que faz

Quando alguém está **ausente** (botão de celular na barra inferior), quem
precisa dela clica em **"chamar"** ao lado do nome dela na lista do HUD. Na tela
de quem está ausente aparece um aviso — *"Ana está te chamando · 14:32"* — junto
com um "toc-toc" de ~2,5s (quatro batidas duplas, com pausa entre elas), e um
botão **Voltar** que desfaz a ausência na hora.

O aviso **não desaparece sozinho**: sai quando a pessoa volta ou quando ela
dispensa (`×`).

## Como funciona

Ausente **desassina o áudio no SFU** (`VoiceRoom.applySilence`): quem está
ausente literalmente não recebe a voz de ninguém, nem colado no avatar. Por isso
o chamado é um canal próprio, e não "fale mais alto".

1. **Client (quem chama)** — o botão na linha da roster chama
   `presence.nudge(id)` → `net/worldApi.nudge` → `presence:nudge`. O botão fica
   `chamado` e desabilitado por `NUDGE_COOLDOWN_MS`, e só marca isso se o
   `fire()` disse que o evento foi para a rede.
2. **Server** (`handlers.ts`) — recusa **em silêncio** em três casos: alvo fora
   do mesmo mundo, alvo que não está ausente, ou cooldown por par ainda
   correndo (`socket.data.nudgedAt`, podado a cada chamado). Passando, emite
   `presence:nudged(fromId, fromName)` **só para o socket do alvo**.
3. **Client (quem recebe)** — `bindStore` entrega a `presence.receiveNudge()`,
   que ignora o chamado se a pessoa já voltou, guarda em `store.nudges` (um por
   pessoa, o mais recente ganha) e toca `ui/knock.ts`. O `Notices` renderiza o
   primeiro item da pilha.

Valores, todos em `shared/src/constants.ts`: `NUDGE_COOLDOWN_MS` = 15000,
`NUDGE_MAX_NAMES` = 2 (a partir daí o aviso vira "Ana, Bruno e +2").

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/events.ts` | `presence:nudge` (c→s) e `presence:nudged` (s→c, unicast) |
| `shared/src/constants.ts` | `NUDGE_COOLDOWN_MS`, `NUDGE_MAX_NAMES` |
| `server/src/handlers.ts` | valida mundo, ausência e cooldown; entrega ponto a ponto |
| `client/src/presence.ts` | `nudge()` e `receiveNudge()` — os efeitos de presença num só lugar |
| `client/src/net/worldApi.ts` | `nudge(targetId)` na fronteira de requisição |
| `client/src/net/bindStore.ts` | ouve `presence:nudged` |
| `client/src/state/store.ts` | `nudges: Nudge[]`, `pushNudge`, `clearNudges` |
| `client/src/ui/Notices.tsx` | o aviso (`.notice.nudge`), com "Voltar" e dispensar |
| `client/src/ui/Hud.tsx` | botão "chamar" nas linhas de quem está ausente |
| `client/src/ui/knock.ts` | o padrão de batidas (~2,5s), sintetizado em WebAudio |
| `client/src/ui/icons.tsx` | `BellIcon` |

## Decisões e por quê

- **Chamado explícito, não detecção automática.** A alternativa considerada era
  disparar o aviso quando houvesse gente falando perto do avatar ausente. Foi
  descartada por falso positivo: duas pessoas conversando entre si perto da sua
  mesa viram "estão te chamando", e ninguém confia num aviso que mente. O clique
  também é o que dá ao servidor algo para limitar.
- **O aviso não expira.** É a decisão mais importante aqui. Quem está ausente
  está longe da tela — um toast de 5s garante que a pessoa perca exatamente a
  informação que a feature existe para entregar. Por isso o aviso persiste e
  carrega a **hora** do chamado (`formatTime`), para não mentir sobre quando
  aquilo aconteceu.
- **Só para quem está ausente.** O servidor confere `target.away`. Sem isso o
  evento viraria um "cutucar" genérico — outra feature, com outro problema de
  abuso. Quem está presente é alcançável por voz ou pelo chat.
- **Recusa em silêncio, sem ack.** Responder "não deu" transformaria o chamado
  em sonda: dá para descobrir se alguém está ausente, ou se está no seu mundo,
  sem estar perto. Segue a convenção dos outros eventos de mundo
  (`shared/src/events.ts`): sem ack, o efeito volta como evento.
- **Cooldown no servidor, não só no botão.** O botão desabilitado é conforto;
  esconder o botão não é limite. O mapa vive no `socket.data` (cai com a
  conexão) e é podado a cada chamado, então não cresce.
- **Som sintetizado, sem asset.** Os packs de arte do projeto são em parte
  não-comerciais e todo asset exige crédito no README — um aviso de 2,5s não
  vale esse peso, nem uma dependência nova. `ui/knock.ts` gera as batidas em
  onda triangular com WebAudio.
- **~2,5s de repetição, não um tom longo.** Quatro ciclos de duas batidas
  (`REPEATS` × `CYCLE_S` em `knock.ts`) com pausa audível entre eles. Quem está
  ausente está olhando outra janela, e o ouvido descarta som contínuo muito mais
  rápido do que descarta algo que insiste — um tom de 2,5s soa como alarme e é
  fácil de ignorar; batida repetida soa como alguém na porta. A primeira versão
  tinha 270ms, que era curto o bastante para passar batido.
- **Dois chamados juntos não somam dois sons.** Enquanto o padrão está tocando,
  um chamado novo não dispara outro (`busyUntil` no `knock.ts`): duas pessoas
  chamando ao mesmo tempo embolariam 5s de batida em cima de si mesmas, e o
  aviso na tela já lista os dois nomes.
- **O som toca mesmo com a pessoa "surda".** Ficar ausente corta mic e áudio da
  conversa; o chamado é a campainha da porta, não a conversa da sala. Se o
  navegador barrar o `AudioContext`, o `catch` engole — o aviso na tela é o
  canal principal, o som é reforço.
- **`nudges` zera nos dois sentidos do `setAway`.** Voltar é a resposta ao
  chamado; e ausentar-se de novo não deve arrastar o aviso da vez passada.
  Chamado velho pendurado na tela é pior que nenhum.
- **Entrega por `io.to(socketId)`.** O Socket.IO já mantém cada socket numa sala
  com o próprio id: é unicast sem estrutura nova, e o mundo não fica sabendo
  quem cutucou quem.

## Armadilhas

- **`receiveNudge` mora em `presence.ts`, não no `bindStore`.** O chamado tem
  efeito colateral (som) e o dono dos efeitos de presença é aquele módulo. Ligar
  o evento direto no store deixaria o som órfão.
- **`nudges` guarda `socket.id`**, que muda a cada reconexão — é identificador
  de exibição, não identidade. Não use para nada persistente.
- **O aviso depende de `away === true` no render.** Se algum dia a ausência
  passar a ser desligada por outro caminho que não `presence.setAway`, o aviso
  fica pendurado; a limpeza está no `store.setAway`.
- **Mudança em `shared/`** — os dois lados compilam contra os mesmos eventos:
  rode `npm run typecheck` (server + client).

## Como testar

Servidor, headless (é o que já foi feito):

```bash
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= PORT=3099 npx tsx server/src/index.ts
```

e um script de dois sockets no molde do `smoke-test.mts`: A e B entram, B manda
`away true`, A manda `presence:nudge` com o id de B, e B tem de receber
`presence:nudged`. Os casos que importam são as recusas — alvo presente, alvo em
outro mundo, segundo clique dentro do cooldown, alvo inexistente.

Interface, `npm run dev` com duas abas:

1. Aba 1 entra como Ana; aba 2 como Bruno.
2. Bruno clica no botão de celular (fica ausente) — Ana vê "ausente" e o botão
   **chamar** na linha dele.
3. Ana clica em chamar: na aba do Bruno aparece o aviso e toca o "toc-toc"; o
   botão da Ana vira "chamado" por 15s.
4. Bruno clica em **Voltar**: o aviso sai, o mic e o fone dele voltam como
   estavam, e a linha dele deixa de ter o botão.
5. Duas pessoas chamando: o aviso deve dizer "Ana e Cida estão te chamando".

## Não verificado

Nada da interface foi visto num navegador — ver `PENDENTES.md`.

## Relacionado

- README: [Controles](../../README.md#controles) (o modo ausente em si, ainda
  sem doc próprio) e o índice de Features.
