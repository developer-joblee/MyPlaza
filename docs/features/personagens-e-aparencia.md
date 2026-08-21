# Personagens e aparência

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

A aparência do avatar é montada por **camadas** (Character Generator do pack
Modern Interiors FULL): corpo (9 tons), olhos (7), roupa (15) e cabelo (20 + 
"sem cabelo") — ~21 mil combinações. A tela de entrada tem um **montador** com
preview animado (ciclo de andar), botão aleatório e os quatro visuais antigos
como atalhos. Animações: parado (respiração), andar (4 direções), sentar
(perfil) e celular no modo ausente com **intro** (tira o celular do bolso uma
vez, depois loop).

> Histórico: na fase 1 (mesmo dia) os 4 ids fixos passaram a usar 4 premades do
> pack pago; nesta fase os premades saíram e os 4 ids viraram **combinações**
> do gerador (`LEGACY_CHARACTER_APPEARANCE`).

## Como funciona

- **`shared/src/appearance.ts`** — o contrato: catálogo curado de ids
  (`body_01`, `hair_09_05`...), `Appearance`, `isAppearance` (validação campo a
  campo), `appearanceKey` (chave de cache), `randomAppearance`,
  `DEFAULT_APPEARANCE` e `LEGACY_CHARACTER_APPEARANCE` (os 4 antigos como
  combos). Ids são derivados dos nomes de arquivo do pack — `hair_{estilo}_{cor}`.
- **Protocolo**: `PlayerState.appearance` e `WorldBinding.appearance`
  substituíram `character`; o `join` ganhou `appearance` como 6º argumento — o
  4º (`character`) ficou na assinatura como legado: cliente antigo cai em
  `LEGACY_CHARACTER_APPEARANCE[character]`, payload adulterado cai no padrão.
- **Banco** (migração `0014`): coluna `appearance` jsonb em `profiles`,
  `sessions` e `presence_state`. `character_id` continua sendo escrito (FK/NOT
  NULL) com o valor legado ou o default; a leitura faz
  `appearance ?? LEGACY[character_id] ?? DEFAULT` (`toAppearance` no `db.ts`).
- **Composição no client** (`client/src/game/composeCharacter.ts`, zero Pixi):
  as ~51 camadas curadas são pré-carregadas no `Game.create`
  (`loadCuratedLayers`, ~2 MB), e `composeAppearance` desenha
  BODY→EYES→OUTFIT→HAIR num canvas 896×656, cacheado por `appearanceKey`.
  `sprites.ts` transforma o canvas em texturas (`framesForAppearance`,
  **síncrono** — `addRemote` não espera rede). Canvas e não RenderTexture de
  propósito: o Pixi re-sobe texturas de canvas sozinho se o contexto WebGL cair.
- **`client/src/ui/CharacterBuilder.tsx`** — o montador da tela de entrada:
  preview em `<canvas>` com o MESMO compositor (pixel a pixel o que o mapa vai
  mostrar), uma linha de setas por camada, aleatório e quick-picks.
- A geometria (grade 56×20 de quadros 16×32, direções, sentar, celular) é uma
  só para todas as camadas: `GENERATOR_DEF` em `characterDefs.ts`, medida por
  varredura de pixels (ver comentários no arquivo).
- **Assets**: `npm run assets:characters` copia a curadoria de `assets_temp/`
  para `client/public/characters/v2/{body,eyes,hair,outfit}/`. A curadoria vive
  no script (`HAIR_STYLES`, `OUTFIT_PICKS`).

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/appearance.ts` | catálogo, tipos, validação, chave, legado |
| `shared/src/types.ts` · `events.ts` | `PlayerState`/`WorldBinding`/`join` |
| `server/src/handlers.ts` · `world.ts` · `db.ts` | validação, estado, escritas/leituras com coalesce |
| `db/migrations/0014_appearance.sql` | as três colunas jsonb |
| `client/src/game/composeCharacter.ts` | camadas → canvas composto (zero Pixi) |
| `client/src/game/sprites.ts` | canvas → texturas, cache por combinação |
| `client/src/game/characterDefs.ts` | a geometria única da grade (`GENERATOR_DEF`) |
| `client/src/ui/CharacterBuilder.tsx` | o montador da tela de entrada |
| `scripts/build-character-assets.mjs` | copia a curadoria para o repo |

## Decisões e por quê

- **Curadoria com ids estáveis, não o pack inteiro**: 200 cabelos × 132 roupas
  não cabem numa UI de setas nem no repo (licença!). Adicionar id é seguro;
  **remover** id é quebra de dado (perfis gravados com ele caem no padrão) —
  migre as linhas antes.
- **Canvas 2D compartilhado entre jogo e UI**: um compositor só; a tela de
  entrada não carrega Pixi e o preview é fiel por construção.
- **`character_id` fica no banco**: derrubar a FK/coluna exigiria migração de
  dados sem ganho — como fallback de leitura ela dá retrocompat de graça.
- **Acessórios reservados** (`accessory: null` no contrato): o campo já viaja e
  é validado, então a v2 não mexe em protocolo.
- **Sem edição de aparência dentro do jogo** (premissa antiga mantida): trocar
  exige re-entrar; o vínculo por mundo continua mandando.

## Armadilhas

- **A migração 0014 é obrigatória** com Supabase: o servidor SELECIONA a coluna
  `appearance` — sem ela, leitura de perfil/vínculo falha com 42703.
- **Servidor antigo + client novo** (dev desatualizado): o servidor manda
  `character` e o client cai em `DEFAULT_APPEARANCE` (`framesFor` tem `??` para
  isso) — todo mundo igual é o sintoma de servidor velho. Reinicie o `npm run dev`.
- **`Bodies` do pack têm 927px de largura** (paleta de referência em x≥896) — o
  script aceita largura excedente e o canvas de 896 ignora o resto.
- Mudar a curadoria = rodar `npm run assets:characters` **e** atualizar os
  arrays em `shared/src/appearance.ts` — são duas metades do mesmo fato; o
  `decode()` do preload falha alto se um PNG referenciado não existir.
- A intro do celular depende do reset de `frameIndex` em `setAway` (como antes).

## Como testar

`npm run dev` (reinicie se o servidor estava aberto de antes do gerador!), duas
abas com combinações diferentes: cada uma vê a outra com o visual certo.
Montador: setas trocam camada com o preview andando; "sem cabelo" no fim do
ciclo de cabelo; aleatório; quick-picks. `E` para sentar dos dois lados;
ausente com a intro. `window.__togetherAvatars()` mostra a `appearanceKey` de
cada avatar. Com Supabase: aplicar a 0014, entrar, F5 (vínculo mantém a
aparência), re-login de perfil antigo (só `character_id`) entra com o visual
mapeado.

## Não verificado

Ver a seção correspondente em `PENDENTES.md` (2026-08-21).

## Relacionado

- [Atlas de tiles](atlas-de-tiles.md) — a outra metade da troca de assets
- [Vínculo com o mundo](vinculo-com-o-mundo.md) — onde a aparência é lembrada
- README, "Créditos de assets"
