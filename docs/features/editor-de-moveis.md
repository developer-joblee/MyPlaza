# Editor de móveis

**Status:** em uso (v2: com colisão e variantes)
**Última atualização:** 2026-08-21

## O que faz

Quem administra o mundo abre **engrenagem → Editar móveis** e ganha uma paleta
com 12 móveis do catálogo. Escolher um item mostra uma prévia translúcida que
segue o mouse (avermelhada onde não pode); **clique** coloca e **R** alterna a
variante de arte (planta/globo/estante/balcão têm mais de uma). Clicar num
móvel já colocado o pega para mover; **botão direito** remove (ou larga o que
está na mão). Todo mundo no mundo vê as mudanças na hora, e elas persistem por
mundo no banco. Em **modo anônimo** (sem Supabase) todos podem editar — não há
papéis — e a camada vive só em memória.

**Desde a v2 os móveis colidem** como os do mapa: não se atravessa um sofá
colocado pelo editor, o pathfind do "ir até" contorna, e o servidor recusa
colocar móvel em cima de alguém e não restaura posição salva dentro de móvel.

## Como funciona

- **O ASCII continua mandando**: chão, paredes, zonas e colisão vêm do mapa
  estático. O editor mexe numa camada **dinâmica** por mundo (`world_furniture`,
  migração 0016), hidratada no primeiro join como o chat.
- **Catálogo em `shared/src/furniture.ts`** ({id, label, w, h, solid}) — os dois
  lados o usam. A ARTE fica no client (`furnitureArt.ts`: id → frame do atlas),
  reaproveitando frames dos cenários.
- **Protocolo**: `furniture:place/move/remove` (ack `FurnitureResult`, códigos:
  forbidden/invalid/blocked/full/not-found) e broadcasts
  `furniture:snapshot/changed/removed` — **para todos, inclusive quem editou**
  (o sprite nasce do broadcast; o ack só explica recusas).
- **Quem pode editar** é decidido no join (`place.createdBy === profile`; sem
  banco, todos) e vai ao cliente no `furniture:snapshot` (`canEdit`) — o
  cliente nunca afirma papel, e o servidor reconfere em cada pedido.
- **Validações no `World`** (`footprintFree`): footprint inteiro dentro do mapa
  e sobre tile caminhável do mapa estático, sem sobrepor outro móvel dinâmico,
  teto `FURNITURE_MAX_PER_WORLD` (200). No hydrate, móvel cujo footprint deixou
  de ser válido (o ASCII mudou) é **descartado com log** — espelho do
  `validResume`.
- **Client**: `FurnitureLayer` (sprites no playersLayer com a MESMA âncora e
  y-sort do `addProp` — móvel do editor e do mapa são indistinguíveis);
  ghost por `pointermove` **DOM** (não religa `eventFeatures.move` do Pixi);
  `net/furnitureApi.ts` é a fronteira; paleta em `ui/FurniturePalette.tsx`, com
  ícones recortados do próprio `furniture.{png,json}` em canvas.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/furniture.ts` | catálogo, footprints, `PlacedFurniture`, `FurnitureResult` |
| `shared/src/events.ts` | os 3 pedidos com ack + os 3 broadcasts |
| `db/migrations/0016_world_furniture.sql` | a tabela (RLS sem escrita; só o server) |
| `server/src/world.ts` | a regra: footprint, sobreposição, teto, hydrate |
| `server/src/handlers.ts` | gate de papel + validação de entrada + broadcast + escrita |
| `server/src/db.ts` | load/insert/move/delete fail-soft |
| `client/src/net/furnitureApi.ts` | fronteira de requisição |
| `client/src/game/FurnitureLayer.ts` · `furnitureArt.ts` | sprites, ghost, arte |
| `client/src/game/Game.ts` | cliques/ponteiro do modo edição, eventos |
| `client/src/ui/FurniturePalette.tsx` · `SettingsMenu.tsx` | paleta + o botão que liga |

## Decisões e por quê

- **O emissor desenha do broadcast**, como nos emotes: recusa do servidor =
  nada aparece, e não há estado local para reconciliar.
- **O id é cunhado no servidor** (uuid) antes da escrita no banco, para o
  broadcast não esperar o insert (fail-soft: sem banco, tudo funciona em RAM).
- **`w`/`h` no catálogo, não na arte**: a arte pode ser mais alta que o
  footprint (palmeira de 2 tiles de altura ocupa 1 tile de chão).
- **Sem UNIQUE por tile no banco**: footprint > 1 tile; quem valida sobreposição
  é o servidor em memória, que é quem tem o mapa.
- **A colisão dinâmica entra por `TilemapBase.isSolidAt`** (um hook
  `setDynamicSolid`), e não por checagens espalhadas: movimento, pathfind e
  `freeTileNear` já perguntam ali, então enxergam os móveis de graça. O `Game`
  mantém um `Set` de tiles sólidos reconstruído a cada broadcast.
- **Unstuck no `LocalPlayer`**: quem já está DENTRO de um sólido (móvel colocado
  em cima de você na corrida da latência — o servidor recusa o caso visível,
  mas você pode ter andado para lá no meio do caminho) pode andar livre até
  sair. Sem isso, toda direção colidiria e o avatar travaria para sempre.
- **"Rotação" é variante de arte, não geometria**: o pack não tem os móveis
  girados. O `rotation` (0..7) do protocolo/banco indexa a lista de frames de
  `furnitureArt.ts`, módulo o tamanho — móvel de arte única ignora o R.

## Armadilhas

- **Móvel novo no catálogo é DUAS metades**: `shared/src/furniture.ts` (id,
  label, footprint) e `client/src/game/furnitureArt.ts` (frame do atlas). Frame
  inexistente = sprite vazio (a paleta também fica em branco) — conferir no
  navegador.
- O ghost usa `pointermove` DOM com early-return fora do modo edição — se um
  dia religarem `eventFeatures.move` do Pixi por outra razão, este listener
  fica redundante mas inofensivo.
- A paleta NÃO tem `data-capture-keys` de propósito (não tem campo de texto):
  WASD continua andando com ela aberta, o que é desejável para posicionar.

## Como testar

`npm run dev` em modo anônimo (todos editam), duas abas: engrenagem → Editar
móveis → escolher item → ghost segue o mouse (vermelho sobre parede/móvel) →
clique coloca e **a outra aba vê na hora**; clicar no móvel + clicar noutro
lugar move; botão direito remove. F5 em modo anônimo mantém os móveis (memória
do servidor); com Supabase (0016 aplicada), sobrevivem a restart do servidor.

## Não verificado

Ver a seção em `PENDENTES.md` (2026-08-21).

## Relacionado

- [Cenários e mapas ASCII](cenarios-e-mapas.md) — a camada estática por baixo
- [Atlas de tiles](atlas-de-tiles.md) — de onde vem a arte
