# Objetos animados no cenário

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Três pontos do Estúdio ganharam vida: a **máquina de café** na copa (vapor
subindo), um **aquário** de dois tiles no open space e a **TV de telejornal** na
parede sul da sala de reunião. São decorativos — não têm interação — mas são
sólidos no mapa (café e aquário), como qualquer móvel.

## Como funciona

- **`client/src/game/AnimatedProp.ts`** — um sprite que troca de textura por
  acumulador de tempo, o MESMO mecanismo do `Avatar.update`. Suporta `loop`
  opcional `[início, fim]`: quadros antes da faixa tocam uma vez (intro — é o
  "4-7 loop" dos nomes de arquivo do pack). Nenhum dos três atuais usa intro.
- **`TilemapBase.animate(dt)`** (antes um gancho vazio) percorre
  `animatedProps`; o `Game.tick` já o chamava todo frame desde sempre.
- As **tiras** ficam em `client/public/tiles/modern/anim/*.png`, copiadas
  inteiras pelo `npm run atlas` (seção `animations` do
  `scripts/atlas.manifest.json`). O recorte em quadros é do client:
  `ANIMATED_SPECS` em `scenarioThemes.ts` diz `frameW`/`frameH`/`frameS` de
  cada uma, e `loadTileArt()` valida `largura % frameW === 0` — uma tira
  trocada falharia em silêncio sem isso.
- Os sprites entram nos `props` (playersLayer, y-sorted), **fora** do
  `cacheAsTexture` que congela o chão — é por isso que podem mudar de quadro.
- Dois `TileType` novos no shared: `CoffeeMachine` (`C`) e `Aquarium` (`A`,
  dois tiles em run `AA`, como estante). Sólidos; colisão de graça pelo
  `isSolid`. A TV não tem tile: é o `q` (`WallArt`) — o tema pode apontar a
  arte de parede para uma animação (`arts: [{ anim: 'tv' }]`).

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/game/AnimatedProp.ts` | o sprite animado (timer + troca de textura) |
| `client/src/game/scenarioThemes.ts` | `ANIMATED_SPECS` (url, quadro, ritmo) e o tema apontando para eles |
| `client/src/game/ModernTilemap.ts` | `loadTileArt` (atlas + tiras), casos `CoffeeMachine`/`Aquarium`, arte de parede animada |
| `client/src/game/TilemapBase.ts` | a lista `animatedProps` e o `animate(dt)` |
| `shared/src/map.ts` · `shared/src/scenarios.ts` | os dois tiles novos, solidez e os chars `C`/`A` no ASCII |
| `scripts/atlas.manifest.json` · `scripts/build-atlas.mjs` | seção `animations` → cópia para `anim/` |

## Decisões e por quê

- **Troca manual de textura, não `AnimatedSprite`**: o projeto já anima o avatar
  assim; um segundo mecanismo (com ticker próprio) seria mais coisa para manter
  sem ganho. Um jeito só de animar.
- **Tiras copiadas inteiras, não empacotadas no atlas**: cada tira já é uma
  textura pequena e os quadros têm posições regulares — empacotá-las no atlas
  obrigaria o manifest a saber de quadros, que é conhecimento do client.
- **`frameS` (segundos por quadro), não fps**: é a convenção do resto do projeto
  (`idleFrameS`, `walkFrameS`...).
- **A TV é a única arte da parede `q`** do Estúdio: o mapa tem um `q` só, então
  os quadros estáticos (planner, fogo, praia) ficaram no atlas sem uso — para o
  dia em que houver mais paredes com arte.
- **Nada disso passa pelo servidor**: animação é desenho. O servidor só conhece
  os dois `TileType` novos (pela solidez), e o smoke test cobre isso.

## Armadilhas

- **Trocar uma tira no manifest exige conferir `ANIMATED_SPECS`**: o PNG novo
  pode ter outro `frameW`/altura — a validação no load falha alto, mas só no
  navegador, não no typecheck.
- O `cacheAsTexture(true)` da `view` continua: **piso animado não funciona**
  por este caminho (só props). Se um dia houver, o cache precisa sair — e ele
  existe por desempenho.
- Editar o ASCII (os `C`/`AA` novos) invalida posição salva — regra de sempre,
  `validResume` cobre.

## Como testar

`npm run dev`, entrar, andar até a direita do mapa: o café na copa solta vapor,
o aquário tem peixes nadando, a TV da parede da reunião passa o telejornal.
`E` perto deles não senta (são móveis, não cadeiras); não dá para atravessá-los.

## Não verificado

Ver a seção em `PENDENTES.md` (2026-08-21).

## Relacionado

- [Atlas de tiles](atlas-de-tiles.md) — de onde as tiras vêm
- [Cenários e mapas ASCII](cenarios-e-mapas.md) — a legenda com `C`/`A`
