# Cenários e mapas ASCII

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Os mapas por onde os avatares andam. São **três cenários, do mesmo estilo de
arte** (Modern Interiors + Modern Office, by LimeZu):

- **Estúdio** (36x24) — lounge, open space, sala de reunião e copa (2 zonas);
- **Escritório** (40x24) — recepção, open space maior, reunião e copa (2 zonas),
  com impressora, máquinas de venda e quadro branco;
- **Café** (30x20) — balcão com estação de café, mesas, lounge e uma sala
  reservada (1 zona).

Cada mapa é desenhado em **ASCII**, uma linha por linha de tiles, e é a mesma
fonte para o desenho no client, a colisão nos dois lados e as zonas de áudio. A
**legenda é uma só** (`MODERN_CHAR_TO_TILE`); a arte de cada cenário vem do tema
(`scenarioThemes.ts`) — o mesmo `q` é TV no Estúdio e quadro no Escritório.

Até 2026-08-21 havia quatro cenários de três packs diferentes; ficou um estilo
só — ver [Por que um estilo só](#por-que-um-estilo-só) — e no mesmo dia o
Escritório e o Café entraram, já no estilo unificado.

## Como funciona

Cada cenário é um `ScenarioDef` em `shared/src/scenarios.ts`:

| Campo | Para que |
|---|---|
| `rows` | o mapa em ASCII, um caractere por tile. **Todas as linhas com o mesmo comprimento** — `buildMap` estoura na hora se uma divergir |
| `charToTile` | a legenda: caractere → `TileType` |
| `defaultTile` | tile de caractere fora da legenda (rede de segurança, não atalho) |
| `spawnTiles` | onde as pessoas entram, em rodízio (`spawnIndex` em `world.ts`) |
| `audioZones` | salas fechadas — ver [Zonas de áudio](../../README.md#zonas-de-áudio-salas-fechadas) |

`parseMap(id)` transforma isso num `WorldMap` (grade de `TileType` + dimensões em
px). **Client e server chamam a mesma função**, e é isso que faz os dois
concordarem sobre onde tem parede sem transmitir mapa nenhum pela rede — só o
`scenarioId` viaja, no `world:snapshot`.

Do `TileType` saem três decisões, todas em `shared/src/map.ts`:

- **`isSolid`** — atravessa ou não. Usado pela colisão do client
  (`TilemapBase.collidesCircle`) e pela validação de posição salva do server
  (`World.validResume`).
- **`isWallLike`** — parede de verdade, que o `ModernTilemap` desenha com face de
  2 tiles quando está virada para o sul (entra no y-sort e oclui quem está atrás)
  e com "teto" branco nas outras.
- **`sitFacingAt`** — se o tile é cadeira sentável e para que lado quem senta
  fica virado. Fonte **única**: o client escolhe a pose e o server valida o
  pedido com a mesma função, então direção nenhuma precisa ir pela rede.

O desenho fica no client, em `client/src/game/ModernTilemap.ts` (subclasse de
`TilemapBase`), e desde 2026-08-21 é **orientado a dados**: os frames vêm de um
**atlas** (`client/public/tiles/modern/furniture.{png,json}`, gerado por
`npm run atlas` — ver [Atlas de tiles](atlas-de-tiles.md)) e a arte de cada
papel vem do **tema do cenário** (`client/src/game/scenarioThemes.ts`). O
renderer agrupa móveis em *runs* horizontais (`>oooo<` = uma mesa longa de 4,
não quatro mesas), sorteia variantes por um `hash(x, y)` determinístico — para
todos os clients verem o mesmo — e divide o resultado em duas camadas: `view`
(chão, abaixo dos avatares) e `props` (sprites altos, que o `Game` joga na
camada com y-sort). Um cenário novo com o mesmo pack é uma entrada em
`SCENARIOS` (shared) + um tema em `SCENARIO_THEMES` + os frames no manifest do
atlas — o `ModernTilemap` não muda.

### O ASCII do Estúdio

```
paredes  # cega   w janela   q quadro/TV   b lousa de parede
pisos    . cinza  h espinha-de-peixe (lounge)   t azulejo verde-água (reunião)
         k azulejo amarelo (copa)   r tapete (caminhável)
móveis   s sofá (run 2-3)   W workstation   o mesa longa (run 4)   T banqueta
         E estante (run 2)  L lousa de cavalete (run 2)   K balcão (run 2)
         G geladeira        g globo          P planta
animados C máquina de café  A aquário (run 2 — `AA`)   [ver objetos-animados.md]
cadeiras > senta olhando à direita    < senta olhando à esquerda
         c decorativa (de frente para a câmera, sem arte de sentar)
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/scenarios.ts` | os cenários: ASCII, legenda, spawns, zonas. **Fonte única** |
| `shared/src/map.ts` | `TileType`, `buildMap`, `isSolid`, `isWallLike`, `sitFacingAt` |
| `client/src/game/ModernTilemap.ts` | desenho: frames do atlas por nome, runs, y-sort |
| `client/src/game/scenarioThemes.ts` | a arte de cada cenário: papel → nome de frame no atlas |
| `client/src/game/TilemapBase.ts` | colisão e busca de cadeira, comum a qualquer renderer |
| `client/public/tiles/modern/` | o atlas gerado (`furniture.png` + `furniture.json`) |
| `scripts/build-atlas.mjs` · `scripts/atlas.manifest.json` | geram o atlas a partir do pack pago — ver [Atlas de tiles](atlas-de-tiles.md) |
| `server/src/world.ts` | usa `parseMap` e `spawnTiles`; valida posição salva contra o mapa |
| `db/seed.sql` · `db/migrations/0013_single_scenario.sql` · `0015_scenarios_office_cafe.sql` | catálogo `scenarios` no banco |

## Decisões e por quê

### ASCII em vez de um editor de mapas

Um `.tmx` do Tiled seria mais poderoso e ilegível num diff. O ASCII cabe na
revisão de código: mover uma mesa é trocar um caractere, e a mudança aparece no
`git diff` como o desenho que ela é. O custo é o teto — um mapa muito grande ou
com muitas camadas não caberia assim (as Ruínas, com 58x70, já eram desconfortáveis).

### Por que um estilo só

Quatro cenários de três packs diferentes significavam três renderers
(`Tilemap` do Sprout Lands, `RuinsTilemap`, `OfficeTilemap` procedural,
`ModernTilemap`), três vocabulários de tile no mesmo enum e três licenças para
respeitar. Custo alto e nenhum ganho: as pessoas usavam o Estúdio, que é o
`DEFAULT_SCENARIO`, e é o único com salas fechadas — ou seja, o único onde as
zonas de áudio existem.

Com a compra do pack **completo** do LimeZu, a decisão foi ficar nesse estilo. O
que saiu, em 2026-08-21: os três `ScenarioDef`, os três renderers, o
`client/src/game/tilesets.ts`, as sheets em `client/public/tiles/` e doze
`TileType` que só existiam para eles (grama, água, cerca, árvore…).

`ScenarioId` **continua sendo uma união** (`'studio'`, e só) em vez de virar
`string`: mapa novo é uma entrada nova em `SCENARIOS`, e o compilador continua
cobrando exaustividade em todo lugar que casa por cenário.

### O `theme` saiu com eles

Havia um campo `theme` em `ScenarioDef` e um encadeado de ternários no `Game`
escolhendo o renderer por ele. Com um renderer só, a bifurcação era código morto:
o `Game` instancia `ModernTilemap` direto. Entrando um estilo novo, o campo volta
— e com ele o despacho.

### Renumerar o `TileType` foi seguro (e verificado)

Remover doze tiles deixaria buracos no enum. Renumerar é seguro porque nenhum
valor de `TileType` é gravado no banco nem transmitido pela rede — posição vai em
pixels, e client e server constroem a grade da **mesma** fonte. Foi verificado
célula por célula (ver [Não verificado](#não-verificado)).

### Um mundo restrito não é o mesmo que um cenário

Cenário é o *mapa*; mundo (`places`) é o *lugar*. Duas empresas usam o mesmo
cenário e não podem se ver — inclusive na sala de voz. Quem separa é a
`World.key` (o `places.id`, ou um sintético `scenario-<id>` no modo anônimo), não
o `scenarioId`. Ver [Lobby](lobby.md).

## Armadilhas

- **Linhas de comprimento diferente**: `buildMap` lança
  `Mapa 'studio': linha N tem X colunas, esperado Y`. É proposital — falhar no
  boot é melhor que uma coluna fantasma de colisão.
- **Editar o ASCII invalida posição salva.** A posição é gravada em pixels; o
  chão de ontem pode ser a parede de hoje. `World.validResume` recusa a posição
  e manda a pessoa para o spawn — com uma exceção que parece contradição: tile de
  cadeira é `isSolid`, mas quem senta fica **em cima** dele, então sólido é
  aceito quando é cadeira sentável e a pessoa saiu sentada.
- **Mexer em `audioZones` é mexer em quem ouve quem.** O retângulo tem de cobrir
  o piso da sala **e a linha da porta** — sem a porta, quem para na soleira cai
  num limbo onde ninguém se ouve.
- **`charToTile` e o banco não conversam.** Adicionar um cenário exige a linha
  em `scenarios` (`db/seed.sql`), senão o FK de `places` não fecha. Remover um
  exige migração — foi o que a `0013` fez.
- **Frame que não existe no atlas falha ALTO no boot** (`Atlas de tiles não tem
  o frame "..."`), de propósito: um tema apontando para nome errado seria móvel
  invisível. Se aparecer esse erro, ou o nome no tema está errado, ou o manifest
  perdeu a linha — rode `npm run atlas` e confira. As coordenadas do manifest
  são das sheets **master** do pack (em `assets_temp/`), e só o script as lê.
- Girar uma cadeira é trocar `>` por `<`. As mesas ficam com cadeira nas
  **laterais** porque a arte de sentar do pack só tem perfil.

## Como testar

1. `npm run dev`, abrir `http://localhost:5173`, entrar.
2. Andar com WASD pelas quatro áreas (lounge, open space, reunião, copa) e
   encostar nas paredes: nada de atravessar móvel nem sair do mapa.
3. `E` ao lado de uma cadeira (`>oooo<` na reunião, `>T<` na copa): senta virado
   para a mesa. `E` de novo levanta.
4. Entrar na sala de reunião e conferir no HUD o nome da zona, com o círculo de
   alcance do avatar desaparecendo.
5. Segunda aba: as duas pessoas se ouvem no open space e **não** se ouvem com uma
   dentro da reunião e outra colada na parede do lado de fora.
6. Zoom mínimo e máximo (roda do mouse) sobre as paredes viradas para o sul: a
   face de 2 tiles tem de ocluir quem passa atrás.

## Não verificado

Verificado nesta entrega (script temporário, rodado da raiz e apagado — 21
checagens): as 864 células do Estúdio parseando para o tile que a legenda manda
**e** com a solidez esperada por uma tabela escrita à mão, independente do enum
(é o que pegaria uma renumeração errada); `isWallLike` valendo para `#/w/q/b` e
só para eles; as 8 cadeiras sentáveis e nenhum outro tile virando cadeira;
`isScenarioId` recusando `plaza`/`ruins`/`office`; as duas zonas, inclusive as
soleiras. Mais: `join` mandando `'plaza'` (cliente antigo) cai no Estúdio sem
derrubar o socket, e `smoke-test.mts` 14/14.

**Nada foi visto num navegador nesta entrega** — nem o mapa depois da
renumeração, nem as telas sem o seletor de cenário. Detalhe em
[`PENDENTES.md`](../../PENDENTES.md).

## Relacionado

- [Zonas de áudio (salas fechadas)](../../README.md#zonas-de-áudio-salas-fechadas) — no README
- [Booble](booble.md) — a terceira camada de audibilidade, acima de zona e distância
- [Lobby](lobby.md) — por que mundo e cenário são coisas separadas
- [Persistência (Supabase)](persistencia-supabase.md) — `places.scenario_id` e a posição salva
