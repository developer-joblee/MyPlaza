# Emotes (reações)

**Status:** em uso
**Última atualização:** 2026-08-21

## O que faz

Botão de **carinha** na barra inferior abre um seletor com 6 reações (Opa!,
Hã?, Pensando…, Música, Sono, Adorei). Clicar dispara um balãozinho animado
sobre a cabeça do seu avatar — visível para todos do mundo — que aparece
subindo, pulsa o ícone e some sozinho em 3s. Reação nova substitui a anterior.

## Como funciona

- **Protocolo**: `player:emote` (c→s, só o id) e `player:emoted` (s→c,
  broadcast ao mundo **inclusive o emissor** — o próprio balão nasce do
  broadcast, nunca do clique: caminho único de render, zero divergência).
  Catálogo `EMOTES`/`isEmoteId` + `EMOTE_COOLDOWN_MS` (2s, por emissor) +
  `EMOTE_DURATION_MS` (3s) em `shared/src/constants.ts`.
- **Servidor** (`handlers.ts`): exige estar num mundo, valida o id e impõe o
  cooldown por socket — recusas em silêncio, como `presence:nudge`. **Nada é
  persistido.**
- **Assets**: cada emote é uma tira de 8 quadros de 32px
  (`client/public/emotes/{id}.png`), montada por `npm run assets:characters` a
  partir da `UI_thinking_emotes_animation` do pack: quadros 0-5 são a intro
  (bolha crescendo — igual para todos) e 6-7 o par do ícone pulsando. As
  posições dos ícones na sheet estão no próprio script (`EMOTE_ICONS`).
- **Render** (`client/src/game/`): `emotes.ts` pré-carrega e recorta as tiras
  (no `Game.create`); `EmoteBubble.ts` é o balão — troca manual de textura
  (intro uma vez, loop 6-7) + envelope de alpha/subida — criado pelo `Avatar`
  na primeira reação, como o `AwayIndicator`. O `Game` escuta `player:emoted` e
  chama `avatar.showEmote` (local ou remoto).
- **UI**: `EmotePicker.tsx` (popover no molde do `AudioSettings`; o ícone de
  cada botão é o quadro 7 da própria tira via `background-position`) +
  `EmoteIcon` em `icons.tsx` + botão em `MediaControls`.

## Arquivos

| Arquivo | Papel |
|---|---|
| `shared/src/constants.ts` · `events.ts` | catálogo, cooldown, os dois eventos |
| `server/src/handlers.ts` | validação + cooldown + broadcast |
| `client/src/game/emotes.ts` | preload e recorte das tiras |
| `client/src/game/EmoteBubble.ts` | o balão (quadros + envelope + auto-sumiço) |
| `client/src/game/Avatar.ts` · `Game.ts` | `showEmote` + listener `player:emoted` |
| `client/src/ui/EmotePicker.tsx` · `MediaControls.tsx` · `icons.tsx` | o seletor e o botão |
| `scripts/build-character-assets.mjs` | monta as tiras da sheet do pack |

## Decisões e por quê

- **Sem GIF/`pixi.js/gif`**: o plano original previa GifSprite, mas a sheet
  `UI_thinking_emotes_animation` do pack tem o mesmo conteúdo em spritesheet —
  e o projeto já anima tudo por troca manual de textura. Um mecanismo só.
- **O emissor renderiza pelo broadcast**, não pelo clique: se o servidor
  recusar (cooldown), ninguém vê nada — inclusive você, que é o feedback
  honesto de que não foi.
- **Efêmero e sem banco**, como nudge/call: reação é contexto do momento.
- **Emote sobre pose ausente/sentada funciona** — o balão é filho do container
  do avatar, independe da pose.

## Armadilhas

- **Mudar o catálogo é mexer em DOIS lugares**: `EMOTES` no shared e
  `EMOTE_ICONS` no script (+ rodar `npm run assets:characters`). O preload
  falha alto se a tira de um id não existir.
- O cooldown do seletor é conforto; **o limite é o servidor**. Não confundir a
  grade desabilitada com falha.
- A tira tem de ser 256×32 — validado no load, falha alto.

## Como testar

`npm run dev`, duas abas: carinha na barra → escolher reação → o balão aparece
nas DUAS abas sobre o mesmo avatar, pulsa e some em ~3s. Dois cliques seguidos:
o segundo não sai (grade desabilitada 2s). Reagir ausente/sentado também mostra.

## Não verificado

Ver a seção em `PENDENTES.md` (2026-08-21).

## Relacionado

- [Chamado de quem está ausente](chamado-ausente.md) — o padrão de recusa calada
- [Personagens e aparência](personagens-e-aparencia.md) — o balão acompanha o avatar
