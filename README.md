# toGether 🏢

Escritório virtual 2D estilo Gather para a equipe: ande com seu avatar pelo mapa,
chegue perto de alguém para conversar por **voz** (SFU via LiveKit), compartilhe
sua **tela** e use o **chat** de texto.

**Stack:** React 18 · PixiJS v8 · LiveKit (SFU) · Socket.IO · TypeScript · Vite

## Rodando

Requisitos: Node 20.12+.

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Servidor: http://localhost:3001 (o Vite faz proxy de `/socket.io`)

Abra duas abas para testar sozinho.

## Controles

| Ação | Como |
|---|---|
| Andar | `WASD` ou setas |
| Sentar | `E` ao lado de uma cadeira (a dica aparece no painel). `E` de novo, ou qualquer tecla de movimento, levanta |
| Falar | Chegue a até ~5 tiles de alguém (círculo claro ao redor do seu avatar) — o volume cai com a distância |
| Mutar microfone | Botão 🎙️ na barra inferior |
| Parar de ouvir todos | Botão de fone na barra inferior (muta seu microfone junto) |
| Ficar ausente | Botão de celular na barra inferior: corta microfone e áudio, e seu avatar aparece mexendo no celular. Andar volta ao normal. Suas preferências de microfone e fone são preservadas |
| Compartilhar tela | Botão de tela na barra inferior (visível para quem está perto) |
| Chat | Painel no canto inferior direito (global) |

## Features

Cada feature tem (ou vai ter) um doc próprio em `docs/features/`, criado a
partir de [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md). **Este
índice é a porta de entrada**: antes de mexer em qualquer coisa, ache a feature
aqui e leia o doc dela. Feature nova entra nesta tabela no mesmo commit do
código — a regra completa está em [`CLAUDE.md`](CLAUDE.md).

| Feature | Doc | Código principal |
|---|---|---|
| Voz por proximidade | [Arquitetura](#arquitetura) *(sem doc próprio ainda)* | `client/src/voice/VoiceRoom.ts`, `voice/proximity.ts` |
| Zonas de áudio (salas fechadas) | [Zonas de áudio](#zonas-de-áudio-salas-fechadas) *(sem doc próprio ainda)* | `client/src/voice/VoiceRoom.ts`, `shared/src/scenarios.ts` |
| Compartilhamento de tela | [Arquitetura](#arquitetura) *(sem doc próprio ainda)* | `client/src/ui/ScreenShareView.tsx`, `client/src/voice/VoiceRoom.ts` |
| Chat de texto | — *(sem doc)* | `client/src/ui/Chat.tsx`, `server/src/handlers.ts` |
| Modo ausente (celular) | [Controles](#controles) *(sem doc próprio ainda)* | `client/src/ui/MediaControls.tsx`, `client/src/game/Avatar.ts` |
| Sentar em cadeiras | [Controles](#controles) *(sem doc próprio ainda)* | `client/src/game/LocalPlayer.ts`, `client/src/game/characterDefs.ts` |
| Cenários e mapas ASCII | [Editando o mapa](#editando-o-mapa) *(sem doc próprio ainda)* | `shared/src/scenarios.ts`, `client/src/game/*Tilemap.ts` |
| Token do LiveKit (assinatura no server) | [Deploy](#deploy-railway) *(sem doc próprio ainda)* | `server/src/voice.ts`, `client/src/voice/token.ts` |

> As features acima nasceram antes desta convenção e hoje estão descritas nas
> seções deste README. Ao mexer em uma delas, crie o `docs/features/<slug>.md`,
> mova o detalhe técnico para lá e deixe aqui só o resumo e o link.

## Convenções de desenvolvimento

As regras de trabalho no repo (o que ler antes, onde cada coisa mora, reuso,
doc por feature e o tratamento de segredos) estão em **[`CLAUDE.md`](CLAUDE.md)**
— carregado automaticamente pelo Claude Code em toda sessão, e vale igual para
humano.

**Ative o hook de pre-commit uma vez por clone:**

```bash
git config core.hooksPath .githooks
```

`.githooks/pre-commit` varre o que está no staged e **bloqueia o commit** se
achar credencial (`.env`, `.pem`, `.key`, keystore, token, chave privada, ou
`VITE_*` com nome de segredo — que iria para o bundle do navegador). Ele nunca
imprime o valor encontrado, só o arquivo, a linha e o tipo. Falso positivo:
marque a linha com `secret-scan:ignore`.

Atalhos disponíveis no Claude Code:

| Comando | Para que |
|---|---|
| `/nova-feature <descrição>` | Feature nova seguindo o ritual: ler README/docs → checar reuso → plano → implementar → documentar → typecheck |
| `/doc-feature <nome>` | Criar o `docs/features/` de uma feature que já existe, migrando o detalhe do README |

> **Segredos:** o `.env` nunca é lido nem compartilhado — nem por humano em
> print de tela, nem pelo Claude (há regras `deny` em `.claude/settings.json`).
> Para saber quais variáveis existem, use o [`.env.example`](.env.example): ele
> tem os nomes, não os valores. `LIVEKIT_API_SECRET` vive só no server. Se uma
> chave vazar, rotacione no dashboard do LiveKit — apagar o commit não desfaz.

## Usando com a equipe na rede local

`getUserMedia`/`getDisplayMedia` exigem contexto seguro (HTTPS) fora de
`localhost`. Para os colegas acessarem pelo IP da sua máquina:

```bash
npm run dev:https
```

e compartilhe `https://SEU_IP:5173` (aceitem o certificado autoassinado do
`@vitejs/plugin-basic-ssl`). Alternativa: um túnel (ex.: `cloudflared tunnel --url http://localhost:5173`).

> Voz e tela passam por um SFU (LiveKit Cloud): cada pessoa envia seu áudio
> uma vez e o servidor replica, então não degrada com o tamanho do grupo. O
> TURN/TLS vem incluso, o que resolve rede corporativa restritiva.
>
> Sem as variáveis `LIVEKIT_*` o app roda normalmente — só sem voz nem tela.
> Copie o `.env.example` para `.env` e preencha com as credenciais do
> [LiveKit Cloud](https://cloud.livekit.io).

## Arquitetura

```
shared/   tipos, eventos Socket.IO, constantes e o mapa (fonte única client+server)
server/   Node + Socket.IO: presença, posições, chat e emissão de token do LiveKit
client/   Vite + React (UI) + PixiJS (jogo, fora do React)
```

- **PixiJS fora do React**: `client/src/game/Game.ts` roda o game loop no canvas;
  o React só renderiza a UI sobreposta (HUD, chat, controles). Comunicação via
  store zustand (`client/src/state/store.ts`) e `client/src/runtime.ts`.
- **Voz por proximidade**: `client/src/voice/VoiceRoom.ts` mantém a sala e, num
  tick de 250ms, assina/desassina o áudio de cada participante conforme a distância no mapa e
  aplica o volume pela curva de `voice/proximity.ts`. A identidade no LiveKit é
  o `socket.id`, o que faz o mapa de distâncias do jogo casar 1:1 com os
  participantes. Assina num raio 2,5× maior que o audível: nessa faixa o volume
  já é 0, então a conexão fica pré-carregada e não há corte ao se aproximar.
- **Tela compartilhada**: publicada como `ScreenShare` no LiveKit; o consumo usa
  `track.attach()` (obrigatório com `adaptiveStream`, senão o servidor para de
  encaminhar e a tela fica preta). Some quando o peer sai do alcance.
- **Debug**: no console do navegador, `__togetherVoice()` mostra estado da sala,
  identidade, e distância/volume/subscrição por participante; `__togetherPos()`
  mostra a sua posição.

## Editando o mapa

Os mapas são ASCII em `shared/src/scenarios.ts`, um por cenário (Praça,
Escritório, Ruínas e Estúdio), cada um com sua legenda `charToTile` e spawns
próprios. Todas as linhas precisam ter o mesmo comprimento. No cenário
Ruínas o visual é uma imagem única da cena (`client/public/tiles/ruins/`);
o ASCII define apenas a colisão (`#` sólido, `.` livre).

## Zonas de áudio (salas fechadas)

Por padrão a voz é por proximidade: o volume cai com a distância. Uma **zona**
sobrepõe isso — dentro dela só se ouve quem também está dentro, e quem está fora
não ouve nada, nem colado na parede. Para ouvir, precisa entrar.

A regra inteira é uma comparação, em `client/src/voice/VoiceRoom.ts`:

```ts
const mesmaZona = (zone: string | null) => zone === selfZone;
```

`null` é "área aberta", então duas pessoas fora de qualquer sala continuam se
ouvindo por proximidade (`null === null`). Dentro de uma sala o volume é **plano**:
quem está na ponta da mesa ouve como quem está ao lado.

### Criando uma zona num mapa

Adicione `audioZones` ao cenário em `shared/src/scenarios.ts`, com um retângulo
em tiles (inclusivo) que cubra o piso da sala **e a porta**:

```ts
audioZones: [
  { id: 'reuniao', label: 'Sala de reunião', rect: [25, 1, 34, 8] },
],
```

Incluir a linha da porta é de propósito: quem para na soleira conta como dentro,
o que evita um limbo onde ninguém se ouve. Paredes dentro do retângulo não
incomodam, porque não são caminháveis. Cenário sem `audioZones` funciona como
antes, 100% por proximidade — hoje só o Estúdio tem zonas (reunião e copa).

Dentro de uma sala o círculo de alcance do avatar desaparece (ele mentiria, já
que o alcance passa a ser a sala) e o HUD mostra o nome dela.

> Quem impõe é o SFU: fora da zona o cliente desassina e o servidor **para de
> enviar** aquele áudio — não é volume zero com o som chegando. Mas quem pede a
> subscrição é o assinante, então um cliente modificado ainda poderia escutar.
> É o mesmo nível de confiança da proximidade; para impor de fato, o servidor
> teria que gerenciar as permissões via LiveKit.

## Deploy (Railway)

Um serviço só: o server serve o build estático do client e o Socket.IO na
mesma origem. O Nixpacks detecta tudo pelos scripts da raiz:

- **Build**: `npm install && npm run build` (automático)
- **Start**: `npm start` (automático — roda `tsx` no server, que respeita `process.env.PORT`)
- Node 20.12+ (declarado em `engines`; o `--env-file-if-exists` exige essa versão)

O TLS do Railway já satisfaz o requisito de HTTPS do microfone e do
compartilhamento de tela.

Para a voz, adicione em **Variables** do serviço: `LIVEKIT_URL`,
`LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. **Não** defina `LIVEKIT_ROOM_PREFIX`
em produção: sem ele as salas viram `together-*`, distintas do `dev-*` do
ambiente local — caso contrário dev e produção cairiam na mesma sala.

> O LiveKit não substitui o Railway. A mídia vai do navegador direto para o
> LiveKit Cloud; o Railway serve o client, roda o Socket.IO (posições, chat,
> roster) e **assina os tokens** — a `API_SECRET` nunca pode ir para o
> navegador. Por isso o deploy não precisa de UDP.

## Créditos de assets

- **Praça (terreno e objetos)**: [Sprout Lands — Basic pack](https://cupnooble.itch.io/sprout-lands-asset-pack),
  by **Cup Nooble** — uso não-comercial, conforme a licença do pack.
- **Ruínas (cena e objetos)**: [Pixel Art Top Down — Basic](https://cainos.itch.io/pixel-art-top-down-basic),
  by **Cainos** — licença CC0.
- **Interiores modernos (Estúdio) e personagens**: [Modern Interiors — free](https://limezu.itch.io/moderninteriors),
  by **LimeZu** — uso não-comercial, conforme a licença do pack. Os quatro
  personagens (Adam, Alex, Amélia, Bob) vêm daí, incluindo as poses de sentar.

> Atenção: a licença do Sprout Lands Basic é **não-comercial**. Para uso
> comercial, contate o autor (Discord: `cup_nooble`).
