# toGether 🏢

Escritório virtual 2D estilo Gather para a equipe: ande com seu avatar pelo mapa,
chegue perto de alguém para conversar por **voz** (P2P via WebRTC), compartilhe
sua **tela** e use o **chat** de texto.

**Stack:** React 18 · PixiJS v8 · WebRTC (mesh P2P) · Socket.IO · TypeScript · Vite

## Rodando

Requisitos: Node 20+.

```bash
npm install
npm run dev
```

- Client: http://localhost:5173
- Servidor de sinalização: http://localhost:3001 (o Vite faz proxy de `/socket.io`)

Abra duas abas para testar sozinho.

## Controles

| Ação | Como |
|---|---|
| Andar | `WASD` ou setas |
| Falar | Chegue a até ~5 tiles de alguém (círculo claro ao redor do seu avatar) — o volume cai com a distância |
| Mutar microfone | Botão 🎙️ na barra inferior |
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

> O áudio/vídeo é P2P (mesh). Funciona bem para equipes pequenas (~6–8 pessoas
> próximas ao mesmo tempo). Se alguma rede corporativa bloquear P2P, será
> preciso adicionar um servidor TURN (ex.: coturn) em
> `client/src/webrtc/PeerManager.ts` (`RTC_CONFIG`).

## Arquitetura

```
shared/   tipos, eventos Socket.IO, constantes e o mapa (fonte única client+server)
server/   Node + Socket.IO: presença, posições, chat e relay de sinalização WebRTC
client/   Vite + React (UI) + PixiJS (jogo, fora do React)
```

- **PixiJS fora do React**: `client/src/game/Game.ts` roda o game loop no canvas;
  o React só renderiza a UI sobreposta (HUD, chat, controles). Comunicação via
  store zustand (`client/src/state/store.ts`) e `client/src/runtime.ts`.
- **Voz por proximidade**: `client/src/webrtc/PeerManager.ts` abre/fecha uma
  `RTCPeerConnection` por peer conforme a distância no mapa (com histerese),
  usando o padrão *perfect negotiation*. Volume = função da distância.
- **Tela compartilhada**: track de vídeo adicionada às conexões existentes
  (renegociação automática); some quando o peer sai do alcance.
- **Debug**: no console do navegador, `__togetherPeers()` mostra o estado das
  conexões P2P (ICE, volume, pacotes recebidos).

## Editando o mapa

Os mapas são ASCII em `shared/src/scenarios.ts`, um por cenário (Praça,
Escritório e Ruínas), cada um com sua legenda `charToTile` e spawns
próprios. Todas as linhas precisam ter o mesmo comprimento. No cenário
Ruínas o visual é uma imagem única da cena (`client/public/tiles/ruins/`);
o ASCII define apenas a colisão (`#` sólido, `.` livre).

## Créditos de assets

- **Praça (terreno e objetos)**: [Sprout Lands — Basic pack](https://cupnooble.itch.io/sprout-lands-asset-pack),
  by **Cup Nooble** — uso não-comercial, conforme a licença do pack.
- **Ruínas (cena e objetos)**: [Pixel Art Top Down — Basic](https://cainos.itch.io/pixel-art-top-down-basic),
  by **Cainos** — licença CC0.
- **Interiores modernos (Estúdio)**: [Modern Interiors — free](https://limezu.itch.io/moderninteriors),
  by **LimeZu** — uso não-comercial, conforme a licença do pack.
- **Personagem**: Prototype_Character (pack local do projeto).

> Atenção: a licença do Sprout Lands Basic é **não-comercial**. Para uso
> comercial, contate o autor (Discord: `cup_nooble`).
