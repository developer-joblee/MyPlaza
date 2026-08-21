# toGether 🏢

Escritório virtual 2D estilo Gather para a equipe: ande com seu avatar pelo mapa,
chegue perto de alguém para conversar por **voz** (SFU via LiveKit), compartilhe
sua **tela** e use o **chat** de texto.

**Stack:** React 18 · PixiJS v8 · LiveKit (SFU) · Socket.IO · TypeScript · Vite

## Rodando

Requisitos: **Node 22+** (o `@supabase/supabase-js` exige `WebSocket` global,
que só existe a partir do Node 22).

```bash
npm install
npm run dev
```

- Client: **http://localhost:5173** — é aqui que se abre o app
- Servidor: http://localhost:3001 (o Vite faz proxy de `/socket.io`)

Abra duas abas para testar sozinho.

> `:3001` serve o **build** de `client/dist`, não o dev. Se você abrir essa porta
> e vir uma versão antiga, é isso.

### Três níveis de configuração

O app roda sem nenhuma variável de ambiente, e cada grupo liga um pedaço:

| Sem nada | `LIVEKIT_*` | `+ SUPABASE_*` |
|---|---|---|
| mapa, movimento, chat, entrada anônima | voz por proximidade e tela compartilhada | login obrigatório, lobby, mundos, acesso por ID, tudo salvo |

Nada é obrigatório — mas **os dois grupos do Supabase andam juntos**: definir os
do servidor sem os do navegador deixa o app exigindo um token que ninguém
consegue obter, e todos levam "este servidor exige login".

### Variáveis

Crie um `.env` na **raiz** do repo (um só, para os dois lados: o servidor lê via
`--env-file-if-exists=../.env`, e o Vite lê a raiz por causa do `envDir: '..'`
em `client/vite.config.ts`). O Vite lê `.env` **só na inicialização** — mexeu,
reinicie o `npm run dev`.


> **Por que duas variáveis do Supabase podem ir para o navegador**, se a regra é
> nunca colocar segredo em `VITE_*`: a chave `anon` é publicável por projeto — é
> feita para isso. Quem protege o banco é o RLS
> ([`0002_rls.sql`](db/migrations/0002_rls.sql)), que não tem **nenhuma**
> política de escrita: só o servidor escreve. A `service_role` é o segredo, e
> ela nunca sai de `server/`.

> **O shell ganha do `.env`.** O `--env-file-if-exists` do Node **não sobrepõe**
> variável que já existe no ambiente: se você tem `SUPABASE_URL` (ou qualquer
> outra) exportada no shell — de um teste antigo, do `.zshrc`, de um direnv —
> ela vence, e o `.env` é ignorado **em silêncio**. O sintoma é "está no `.env`
> e não funciona". Para conferir sem imprimir valor:
> `printenv SUPABASE_URL >/dev/null && echo "vem do shell" || echo "vem do .env"`.

### Primeiro login, do zero

Ordem importa, e cada passo tem um jeito próprio de falhar. O boot do servidor
avisa sobre os passos 3 a 5.

1. **`.env` na raiz** com as cinco variáveis do Supabase (bloco acima).
2. **Confira que nenhuma delas está exportada no shell** — o shell sobrepõe o
   `.env` em silêncio (aviso acima). Sintoma: "está no `.env` e não funciona".
3. **Migrações, na ordem, em [`db/README.md`](db/README.md): `0001` → `0009`.**
   As `0007` e `0008` corrigem defeitos que só aparecem contra um Supabase real e
   **as duas são obrigatórias** — sem elas ninguém entra. Rode todas com o
   **mesmo papel**.
4. **`db/seed.sql`**, e **confira** (`select count(*) from characters;` = 4). O
   SQL Editor do Supabase roda o script numa transação só: um erro em qualquer
   linha desfaz o seed inteiro, e o catálogo vazio faz criar perfil falhar com
   `23503`.
5. **Desligue "Confirm email"** em *Authentication → Sign In / Providers →
   Email*. Este app não envia e-mail; com a confirmação ligada, criar conta falha.
6. **`npm run dev`** e leia o boot. Ele grita se a `SUPABASE_URL` tiver forma
   errada, se faltar privilégio (`42501`), se faltar schema (`42P01`) ou se o
   catálogo estiver vazio.
7. **Crie sua conta** — entra na hora. No lobby aparece **o seu ID**; criar um
   mundo próprio funciona sem ninguém te dar acesso.
8. **Mais alguém:** a pessoa cria a conta, copia o ID dela no lobby e te manda.
   Você cola em "Adicionar" no seu mundo, e ela passa a ver o mundo — sem passo
   de aceite.

Para o login e o lobby funcionarem, o schema precisa estar aplicado —
ver **[`db/README.md`](db/README.md)**.

> **Um passo no dashboard, e é o único:** desligue **Confirm email** em
> *Authentication → Sign In / Providers → Email*. Este app **não envia e-mail
> nenhum** — sem domínio para configurar SMTP, o envio ficou de fora, e com ele a
> confirmação de cadastro. Com a confirmação ligada, criar conta falha de um jeito
> que parece bug. Por que isso não abre um furo de segurança está em
> [Autenticação e controle de acesso](docs/features/autenticacao-e-acesso.md).

## Fluxo de telas

Depende de haver Supabase configurado:

```
sem Supabase:   entrada (nome, personagem, cor) -> jogo
com Supabase:   login -> lobby -> entrada (nome, personagem, cor) -> jogo
                login -> lobby -----------------------------------> jogo
                         (mundo em que você já entrou: o nome está guardado)
```

- **login** — e-mail e senha. Criar conta **entra na hora**: não há confirmação,
  porque não há envio de e-mail. O e-mail é só identificador de login.
- **lobby** — a lista de mundos que você pode acessar, **o seu ID** (é o que você
  passa para ser adicionado a um mundo de outra pessoa) e criar mundo. Quem criou
  o mundo administra: adicionar gente pelo ID, papéis, lotação, arquivar.
- **entrada** — nome, personagem e cor. Não há seletor de cenário: existe um
  cenário só (o Estúdio), e o mapa de um mundo vem do mundo. O seletor volta
  sozinho nas duas telas se um segundo cenário entrar em `SCENARIOS` — ver
  [Cenários e mapas ASCII](docs/features/cenarios-e-mapas.md). **Só aparece na
  primeira vez em cada mundo**: depois disso o nome fica guardado no vínculo com
  aquele mundo e "Entrar" vai direto para o jogo, mesmo depois de um logout — ver
  [Vínculo com o mundo](docs/features/vinculo-com-o-mundo.md).

## Controles

| Ação | Como |
|---|---|
| Andar | `WASD` ou setas |
| Sentar | `E` ao lado de uma cadeira (a dica aparece no painel). `E` de novo, ou qualquer tecla de movimento, levanta |
| Falar | Chegue a até ~5 tiles de alguém (círculo claro ao redor do seu avatar) — o volume cai com a distância |
| Mutar microfone | Botão 🎙️ na barra inferior. **Você sempre chega mudo**: entrar, dar F5 ou cair e voltar deixam o microfone desligado, e só um clique aqui liga — ver [Microfone desligado ao entrar](docs/features/microfone-mudo-ao-entrar.md) |
| Parar de ouvir todos | Botão de fone na barra inferior (muta seu microfone junto) |
| Ficar ausente | Botão de celular na barra inferior: corta microfone e áudio, e seu avatar aparece mexendo no celular, com um feed rolando ao lado da cabeça e a pastilha **ausente** acima do nome. Andar volta ao normal, e suas preferências de microfone e fone são preservadas — ver [Modo ausente (celular)](docs/features/modo-ausente.md) |
| Chamar quem está ausente | Botão **chamar** ao lado do nome dela na lista. Ela vê um aviso com quem chamou e a hora, ouve um "toc-toc" e tem um botão para voltar — ver [Chamado de quem está ausente](docs/features/chamado-ausente.md) |
| Conversa paralela (**booble**) | **Botão direito** no boneco de alguém → **booble** (ou **entrar na booble**, se ela já tiver uma), **de qualquer distância**: se estiver longe, seu avatar vai até lá caminhando e a booble abre na chegada — andar, clicar no chão ou o **Cancelar** do aviso desistem. Dentro da booble vocês se ouvem a 100% e o resto da sala cai a 7% — nos dois sentidos. Um círculo violeta no chão envolve o grupo e cresce a cada pessoa que entra, e um balãozinho de cochicho ao lado de cada cabeça mostra que a conversa está rolando. Sai-se pelo **Sair** no aviso, ou dando dois passos para o lado (3 tiles) — ver [Booble](docs/features/booble.md) |
| Compartilhar tela | Botão de tela na barra inferior. Quem está perto (ou na sua **booble**) vê uma **prévia no topo-centro da tela**; clicar nela amplia para a janela inteira, com `⛶`/`F` para fullscreen e `Esc` para voltar — ver [Compartilhamento de tela](docs/features/compartilhamento-de-tela.md) |
| Tocar um som seu | Botão de **grade** na barra inferior: sobe seus sons (áudio maior que 5s abre um seletor de trecho, com a onda e prévia) e toca para quem está perto. O mesmo painel tem o **volume do soundboard**, separado da voz e salvo no seu perfil. Quantos sons você pode ter é liberado pelo **tempo na plataforma** — ver [Soundboard gamificado](docs/features/soundboard.md) |
| Chat | Painel no canto inferior direito (global) |
| Menu de um personagem | **Botão direito** em cima do boneco (o seu ou o de outra pessoa) abre um menu com o nome de quem foi clicado e as ações sobre essa pessoa: **booble**, **chamar** e o **volume dela**. É o lugar das ações *sobre uma pessoa* — na lista do canto superior esquerdo ficam os selos de status — ver [Menu de contexto no avatar](docs/features/menu-de-contexto.md) |
| Ajustar o volume de UMA pessoa | **Botão direito** no boneco dela → a seção **Áudio de X**, com dois sliders: **voz** e **sons** (soundboard), independentes. 0% é mudo, e o ajuste **fica salvo na sua conta** — vale em qualquer navegador e sobrevive ao F5, o seu e o dela. Ninguém é notificado — ver [Volume por pessoa](docs/features/volume-por-pessoa.md) |
| Chamar alguém que está presente | **Botão direito** no boneco → **chamar**. Ela ouve um "pin" e vê no canto superior direito *"SEU NOME te chamou"*, com **Ir até** — que faz o avatar dela **caminhar sozinho** até você, contornando parede, e parar a dois tiles. O item é um interruptor: clicar de novo tira o alerta da tela dela, e clicar mais uma vez toca o pin de novo — ver [Chamar pelo menu de contexto](docs/features/chamar-e-ir-ate.md) |
| Configurações / sair | Botão de **engrenagem** na barra inferior (última posição, onde ficava o telefone): mostra em que mundo você está, **o seu ID**, o campo para **adicionar alguém a este mundo pelo ID** — sem sair do mundo — e o **Finalizar chamada** — ver [Menu de configurações](docs/features/configuracoes-no-jogo.md) |

## Features

Cada feature tem (ou vai ter) um doc próprio em `docs/features/`, criado a
partir de [`docs/features/_TEMPLATE.md`](docs/features/_TEMPLATE.md). **Este
índice é a porta de entrada**: antes de mexer em qualquer coisa, ache a feature
aqui e leia o doc dela. Feature nova entra nesta tabela no mesmo commit do
código — a regra completa está em [`CLAUDE.md`](CLAUDE.md).

| Feature | Doc | Código principal |
|---|---|---|
| Voz por proximidade | [Arquitetura](#arquitetura) *(sem doc próprio ainda)* | `client/src/voice/VoiceRoom.ts`, `voice/proximity.ts` |
| Microfone desligado ao entrar (e ao voltar de uma queda) | [Microfone desligado ao entrar](docs/features/microfone-mudo-ao-entrar.md) | `client/src/voice/VoiceRoom.ts`, `client/src/state/store.ts`, `client/src/ui/GameView.tsx` |
| Zonas de áudio (salas fechadas) | [Zonas de áudio](#zonas-de-áudio-salas-fechadas) *(sem doc próprio ainda)* | `client/src/voice/VoiceRoom.ts`, `shared/src/scenarios.ts` |
| Booble (conversa paralela: dentro 100%, fora 7%) | [Booble](docs/features/booble.md) | `client/src/booble.ts`, `client/src/voice/proximity.ts`, `client/src/game/BoobleRings.ts`, `client/src/game/BoobleWhisper.ts`, `client/src/game/AutoWalk.ts`, `client/src/ui/AvatarContextMenu.tsx`, `server/src/world.ts` |
| Soundboard gamificado (sons próprios, liberados por tempo na plataforma) | [Soundboard gamificado](docs/features/soundboard.md) | `client/src/soundboard/`, `server/src/soundboard.ts`, `shared/src/levels.ts` |
| Compartilhamento de tela (prévia no topo-centro, clique amplia) | [Compartilhamento de tela](docs/features/compartilhamento-de-tela.md) | `client/src/ui/ScreenShareView.tsx`, `client/src/voice/VoiceRoom.ts`, `client/src/ui/GameView.tsx` |
| Chat de texto | — *(sem doc)* | `client/src/ui/Chat.tsx`, `server/src/handlers.ts` |
| Modo ausente (celular) | [Modo ausente (celular)](docs/features/modo-ausente.md) | `client/src/presence.ts`, `client/src/game/AwayIndicator.ts`, `client/src/ui/MediaControls.tsx` |
| Chamado de quem está ausente ("toc-toc") | [Chamado de quem está ausente](docs/features/chamado-ausente.md) | `client/src/presence.ts`, `client/src/ui/knock.ts`, `server/src/handlers.ts` |
| Sentar em cadeiras | [Controles](#controles) *(sem doc próprio ainda)* | `client/src/game/LocalPlayer.ts`, `client/src/game/characterDefs.ts` |
| Cenários e mapas ASCII (hoje um só: o Estúdio) | [Cenários e mapas ASCII](docs/features/cenarios-e-mapas.md) | `shared/src/scenarios.ts`, `shared/src/map.ts`, `client/src/game/ModernTilemap.ts` |
| Token do LiveKit (assinatura no server) | [Deploy](#deploy-railway) *(sem doc próprio ainda)* | `server/src/voice.ts`, `client/src/net/voiceApi.ts` |
| Persistência (Supabase): perfis, empresas, locais, posição salva e atividade da sessão | [Persistência (Supabase)](docs/features/persistencia-supabase.md) | `db/`, `server/src/db.ts` |
| Autenticação e controle de acesso (e-mail e senha sem confirmação; acesso por ID, lotação, local restrito) | [Autenticação e controle de acesso](docs/features/autenticacao-e-acesso.md) | `client/src/auth/`, `client/src/net/authToken.ts`, `server/src/auth.ts`, `server/src/socketAuth.ts`, `server/src/handlers.ts` |
| Lobby: criar mundos e convidar pessoas | [Lobby](docs/features/lobby.md) | `client/src/ui/LobbyScreen.tsx`, `server/src/lobby.ts` |
| Menu de configurações no jogo (adicionar pelo ID sem sair do mundo; sair) | [Menu de configurações](docs/features/configuracoes-no-jogo.md) | `client/src/ui/SettingsMenu.tsx`, `client/src/ui/MediaControls.tsx` |
| Menu de contexto no avatar (botão direito; **booble**, **chamar** e o volume da pessoa) | [Menu de contexto no avatar](docs/features/menu-de-contexto.md) | `client/src/ui/AvatarContextMenu.tsx`, `client/src/game/Avatar.ts`, `client/src/game/Game.ts` |
| Volume por pessoa (voz e soundboard, separados, salvos na conta) | [Volume por pessoa](docs/features/volume-por-pessoa.md) | `client/src/peerAudio.ts`, `client/src/voice/proximity.ts`, `server/src/audioPrefs.ts`, `db/migrations/0014_peer_audio_prefs.sql` |
| Chamar pelo menu de contexto ("pin", alerta e **ir até** com caminhada automática) | [Chamar pelo menu de contexto](docs/features/chamar-e-ir-ate.md) | `client/src/call.ts`, `client/src/ui/CallAlerts.tsx`, `client/src/game/pathfind.ts`, `client/src/game/AutoWalk.ts`, `server/src/handlers.ts` |
| Vínculo com o mundo (o nome fica guardado; entrar direto depois do logout) | [Vínculo com o mundo](docs/features/vinculo-com-o-mundo.md) | `db/migrations/0009_world_binding.sql`, `client/src/state/store.ts`, `server/src/db.ts` |
| Camada de requisição (client → servidor) | [Camada de requisição](docs/features/camada-de-requisicao.md) | `client/src/net/` |

> As features **sem doc próprio** nasceram antes desta convenção e estão
> descritas nas seções deste README. Ao mexer em uma delas, crie o
> `docs/features/<slug>.md`, mova o detalhe técnico para lá e deixe aqui só o
> resumo e o link. As dezesseis com doc (persistência, autenticação, lobby,
> camada de requisição, chamado de ausente, modo ausente, vínculo com o mundo,
> booble, soundboard, menu de configurações, menu de contexto, chamar pelo menu
> de contexto, microfone mudo ao entrar, volume por pessoa, cenários e mapas e
> compartilhamento de tela) já seguem a convenção.

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
> Para saber quais variáveis existem, use a seção [Variáveis](#variáveis) acima:
> ela tem os nomes, não os valores. (O `.env.example` foi removido do working
> tree por engano — `git checkout -- .env.example` traz de volta; ele ainda não
> lista as variáveis do Supabase, que estão só aqui.) `LIVEKIT_API_SECRET` vive só no server. Se uma
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
> Preencha as `LIVEKIT_*` no `.env` da raiz (ver [Variáveis](#variáveis)) com as
> credenciais do [LiveKit Cloud](https://cloud.livekit.io).

## Arquitetura

```
shared/   tipos, eventos Socket.IO, constantes e o mapa (fonte única client+server)
server/   Node + Socket.IO: presença, posições, chat e emissão de token do LiveKit
client/   Vite + React (UI) + PixiJS (jogo, fora do React)
db/       schema do Supabase em SQL, aplicado à mão por enquanto
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
  A regra de quanto se ouve de quem — proximidade, zona e booble — é uma função
  pura em `voice/proximity.ts`, e é dela que saem também o badge `voz` e o anel
  de "falando". Ao lado dela vive uma segunda, `peerVolumeFor`, que multiplica
  aquele número pelo **volume que você escolheu para aquela pessoa** — e é só
  essa que vai para o alto-falante. Ver
  [Volume por pessoa](docs/features/volume-por-pessoa.md).
- **Soundboard**: sons curtos do próprio usuário, tocados para quem está perto.
  **Não** passam pelo LiveKit: o servidor escolhe quem recebe (posição, zona e
  booble) e cada navegador baixa o arquivo do Supabase Storage e toca em WebAudio,
  aplicando o volume pela **mesma** função de audibilidade da voz — vezes o
  volume que você escolheu para aquela pessoa, e vezes o volume global do
  soundboard. Quantos sons cada pessoa tem é liberado pelo tempo acumulado na
  plataforma. Ver [Soundboard gamificado](docs/features/soundboard.md).
- **Tela compartilhada**: publicada como `ScreenShare` no LiveKit, com portão de
  proximidade **binário** (não existe "ver a tela a 7%"). Quem recebe vê uma
  prévia no topo-centro e amplia com um clique. Ver
  [Compartilhamento de tela](docs/features/compartilhamento-de-tela.md).
- **Fronteira de requisição**: `client/src/net/` é o único lugar que fala com o
  servidor. Componente, objeto de jogo e store **não** chamam `socket.emit` —
  usam `net/lobbyApi.ts` (operações do lobby), `net/worldApi.ts` (estando
  dentro de um mundo) ou `net/voiceApi.ts` (token do LiveKit). A primitiva em `net/request.ts` confere
  se o socket está conectado antes de emitir, resolve na hora se ele cair no
  meio da espera, e impõe prazo ao ack — sem isso um pedido sumia no
  `sendBuffer` e o botão ficava travado esperando resposta que nunca vinha.
- **Login, lobby e acesso**: com Supabase configurado o fluxo é
  `login → lobby → entrada → jogo`. No **lobby** a pessoa cria mundos e convida
  gente por e-mail; entrar exige **conta** e **convite**. O mundo é por *local*
  (não por cenário), o que isola uma empresa da outra — inclusive a sala de voz
  — e habilita lotação e mundo restrito. Sem Supabase, tudo roda anônimo como
  antes. Ver [Lobby](docs/features/lobby.md) e
  [Autenticação e controle de acesso](docs/features/autenticacao-e-acesso.md).
- **Persistência**: opcional. Com `SUPABASE_*` definido, o servidor guarda
  perfis, empresas, locais, acessos, sessões, chat e **a posição onde cada
  pessoa parou** — cai a internet, você volta no mesmo lugar. Guarda também a
  atividade de cada conexão: salas fechadas visitadas, compartilhamento de tela
  e auditoria de token de voz. Sem essas variáveis o app roda igual, só sem
  persistir. Schema e decisões em
  [`docs/features/persistencia-supabase.md`](docs/features/persistencia-supabase.md).
- **Debug**: no console do navegador, `__togetherVoice()` mostra estado da sala,
  identidade, e distância/volume/subscrição por participante; `__togetherPos()`
  mostra a sua posição.

## Editando o mapa

O mapa é ASCII em `shared/src/scenarios.ts`: um caractere por tile, uma legenda
`charToTile` e os spawns. Todas as linhas precisam ter o mesmo comprimento —
`buildMap` estoura no boot se uma divergir. Mover uma mesa é trocar um caractere.

Hoje existe **um cenário, o Estúdio** (Modern Interiors, by LimeZu): o projeto
tinha quatro, de três packs diferentes, e ficou num estilo só em 2026-08-21.
A legenda completa, o que cada `TileType` decide, como o `ModernTilemap` recorta
as sheets e as armadilhas (editar o ASCII invalida posição salva; trocar a sheet
invalida todos os recortes) estão em
**[Cenários e mapas ASCII](docs/features/cenarios-e-mapas.md)**.

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
incomodam, porque não são caminháveis. Cenário sem `audioZones` funciona 100% por
proximidade; o Estúdio, que é o único cenário, tem duas — reunião e copa.

Dentro de uma sala o círculo de alcance do avatar desaparece (ele mentiria, já
que o alcance passa a ser a sala) e o HUD mostra o nome dela.

### A regra completa vive num lugar só

Zona, distância **e** booble são decididas por `audioVolumeFor()`, em
`client/src/voice/proximity.ts`. O tick da voz usa o número que ela devolve para
três coisas ao mesmo tempo — o volume, o badge `voz` do HUD e o anel de "falando"
—, então os três não podem discordar. Se você for mexer em audibilidade, é ali.

A **[booble](docs/features/booble.md)** é a terceira camada: um grupo ad-hoc que
*prioriza* em vez de isolar (dentro 100%, fora 7%, nos dois sentidos) e que
**atravessa** a parede de uma zona depois de formado — mas só se forma entre
pessoas na mesma zona, justamente para não furar o parágrafo acima. Os raios dela
são de cochicho (2 tiles para entrar, 3 para permanecer), bem menores que os
5 tiles audíveis — e como o clique vale de qualquer distância, é o avatar que
caminha até o raio, não você que precisa estar nele.

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
- **Node 22+** — declarado em dois lugares de propósito: `engines` do
  `package.json` e **`.nvmrc`**. O Nixpacks resolve a versão pelo `.nvmrc`;
  um *range* em `engines` (era `>=20.12`) ele resolvia para o Node 20, e o
  `@supabase/supabase-js` quebra o boot lá (`Node.js detected but native
  WebSocket not found`, em loop de restart). Se ainda subir com Node 20,
  force pela variável `NIXPACKS_NODE_VERSION=22` no serviço.

O TLS do Railway já satisfaz o requisito de HTTPS do microfone e do
compartilhamento de tela.

Para a voz, adicione em **Variables** do serviço: `LIVEKIT_URL`,
`LIVEKIT_API_KEY` e `LIVEKIT_API_SECRET`. Para a persistência e o login:
`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ORG_SLUG` e as duas do
navegador (`VITE_SUPABASE_URL` e a chave `anon`, publicável por design). A
`service_role` passa por cima do RLS e vive **só** no servidor — detalhes em
[`db/README.md`](db/README.md).

> Nada de e-mail precisa ser configurado para o deploy: o app não envia e-mail.
> O único passo no dashboard é **Confirm email** desligado, e ele vale para todos
> os ambientes de uma vez.

> Definir as variáveis do servidor **sem** as do navegador deixa o app exigindo
> um token que ninguém consegue obter: todo mundo leva "este servidor exige
> login". **Não** defina `LIVEKIT_ROOM_PREFIX`
em produção: sem ele as salas viram `together-*`, distintas do `dev-*` do
ambiente local — caso contrário dev e produção cairiam na mesma sala.

> O LiveKit não substitui o Railway. A mídia vai do navegador direto para o
> LiveKit Cloud; o Railway serve o client, roda o Socket.IO (posições, chat,
> roster) e **assina os tokens** — a `API_SECRET` nunca pode ir para o
> navegador. Por isso o deploy não precisa de UDP.

## Créditos de assets

Um pack só, desde 2026-08-21 — os assets dos cenários que saíram (Sprout Lands
by Cup Nooble, na Praça; Pixel Art Top Down by Cainos, nas Ruínas) foram
removidos do repo junto com os mapas.

- **Estúdio (interiores) e personagens**: [Modern Interiors — free](https://limezu.itch.io/moderninteriors),
  by **LimeZu** — uso não-comercial, conforme a licença do pack. Os quatro
  personagens (Adam, Alex, Amélia, Bob) vêm daí, incluindo as poses de sentar.

> **A versão completa do pack foi comprada e ainda não entrou no repo.** O que
> está em `client/public/tiles/modern/` e `client/public/characters/` continua
> sendo recorte da versão **free**. Ao trocar pelas sheets do pack completo,
> atualize este crédito (a linha acima diz "free") e confira a licença que vem
> com ele — a do free é não-comercial, e a paga pode não ser a mesma. Os
> retângulos de recorte do `ModernTilemap` são coordenadas em pixel das sheets
> atuais e **não sobrevivem** à troca: ver
> [Cenários e mapas ASCII](docs/features/cenarios-e-mapas.md#armadilhas).
