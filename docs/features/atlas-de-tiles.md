# Atlas de tiles

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Todo o cenário é desenhado a partir de **um** PNG + **um** JSON
(`client/public/tiles/modern/furniture.{png,json}`), gerados por
`npm run atlas` a partir das sheets master do pack pago (Modern Interiors FULL,
em `assets_temp/`, que é gitignored). O JSON é o formato `Spritesheet` nativo do
PixiJS v8: `Assets.load('/tiles/modern/furniture.json')` baixa o PNG junto e
devolve as texturas por nome (`sheet.textures['studio/sofa_big']`).

## Como funciona

- **`scripts/atlas.manifest.json`** é a curadoria: nome semântico
  (`studio/sofa_big`, `floor/gray`, `wall/face`) → `{src, x, y, w, h}` nas
  sheets master. Adicionar um móvel = uma linha aqui + `npm run atlas`.
- **`scripts/build-atlas.mjs`** valida os recortes, empacota em prateleiras
  (shelf packing por altura, ordenação determinística — rodar duas vezes gera o
  mesmo arquivo, diff estável), blita com 2px de respiro entre frames e escreve
  o PNG + o JSON. Hoje: 35 frames em 512×248, ~27 KB.
- O consumo é `loadTileAtlas()` em `client/src/game/ModernTilemap.ts` (cache de
  módulo, `scaleMode 'nearest'`); a arte de cada papel por cenário vem de
  `client/src/game/scenarioThemes.ts`.

## Decisões e por quê

- **Por que atlas, e não a sheet master direto:** a `Interiors_32x32.png` do
  pack tem **512×34048 px** — mais alta que o `MAX_TEXTURE_SIZE` de muitas GPUs
  (8192/16384). Ela não *pode* virar textura; não é otimização, é viabilidade.
- **Por que não um PNG por móvel:** dezenas de requests e batching quebrado no
  renderer, para o mesmo resultado.
- **Como as coordenadas do manifest nasceram:** casamento **pixel a pixel** dos
  recortes antigos (calibrados na versão free, que era subconjunto da paga)
  contra as sheets master — 33 de 35 bateram exatos; `studio/easel` e
  `studio/plant_3` bateram com ~3% de divergência (retoques da própria arte
  paga). Nenhuma coordenada foi medida no olho.
- **Os gerados são commitados**, não gitignorados: o deploy (Railway) e os
  outros devs não têm `assets_temp/`. A licença permite (uso comercial com
  crédito) desde que o repo seja **privado** — redistribuir o asset é proibido.
- `pngjs` (devDependency, aprovada) é o único requisito do script; roda com
  `node`, sem build.

## Armadilhas

- **Rodar `npm run atlas` sem o pack no disco falha de propósito** com a
  mensagem do caminho esperado. Os gerados commitados continuam valendo.
- **Renomear um frame no manifest quebra os temas** (`scenarioThemes.ts`) — mas
  quebra ALTO no boot do jogo, não em silêncio (ver `ModernTilemap.tex`).
- **Não recalibrar nada no olho.** Precisando de um móvel novo, recorte da sheet
  master (as pastas `Theme_Sorter_*_Singles` do pack ajudam a localizar a arte;
  a posição na master se acha com um script de casamento de pixel, como os
  usados nesta entrega).
- O `PAD` de 2px entre frames evita sangria de vizinho no zoom; se algum dia um
  frame aparecer com uma borda de outro móvel, é aqui que se mexe.

## Como testar

`npm run atlas` duas vezes (a segunda não pode mudar nada — `git status` limpo);
`npm run dev` e o Estúdio inteiro desenhado: lounge, open space, reunião, copa,
janelas e quadros nas paredes. Erro de frame faltando aparece no console do
navegador no boot do jogo.

## Relacionado

- [Cenários e mapas ASCII](cenarios-e-mapas.md) — quem consome o atlas
- [Personagens e aparência](personagens-e-aparencia.md) — a outra metade da
  troca de assets (script irmão: `npm run assets:characters`)
- README, "Créditos de assets" — a licença e o crédito
