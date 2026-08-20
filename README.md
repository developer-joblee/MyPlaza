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
| Compartilhar tela | Botão de tela na barra inferior (visível para quem está perto) |
| Chat | Painel no canto inferior direito (global) |

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
