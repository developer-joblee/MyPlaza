---
description: Ritual de feature nova neste repo — lê README/índice, checa reuso, implementa, documenta
argument-hint: <descrição da feature>
---

Você vai implementar uma feature nova no toGether: **$ARGUMENTS**

Siga o ritual de `CLAUDE.md` **na ordem**, sem pular etapa e sem começar a
escrever código antes de terminar a etapa 1.

## 1. Ler antes (obrigatório)

- `README.md` — em especial a seção **Features** (o índice) e **Arquitetura**.
- `docs/features/*.md` de toda feature que a nova possa tocar. Se a feature
  descrita acima **já existe** no índice, pare e diga isso: pode ser mudança
  numa feature existente, não feature nova.
- `PENDENTES.md` — não retrabalhe o verificado; não confie no pendente.
- O código real dos arquivos citados. Se doc e código divergirem, o código manda
  e o doc está errado — anote para corrigir na etapa 4.

Ao terminar, diga em 3 linhas: o que a feature toca, qual doc/seção já cobre
isso hoje, e o que o código contradiz no doc (se algo).

## 2. Reuso antes de criar

Antes de criar qualquer arquivo, componente, tipo, helper ou constante,
**procure o equivalente existente** e diga o que achou:

- tipo/evento/constante/mapa → `shared/src/` (fonte única client+server)
- componente de UI → `client/src/ui/` · ícone → `client/src/ui/icons.tsx`
- helper de UI → `client/src/ui/util.ts` · estilo → `client/src/styles.css`
- lógica de jogo (Pixi, fora do React) → `client/src/game/`
- estado UI↔jogo → `client/src/state/store.ts` + `client/src/runtime.ts`
- voz/proximidade/zona → `client/src/voice/`
- presença/posição/chat/token → `server/src/`

Se for mesmo preciso criar algo novo, justifique em uma linha por arquivo.
Dependência nova ou asset novo: **pergunte antes** (licença + crédito no README).

## 3. Plano, depois código

Apresente um plano curto (arquivos tocados, o que muda em cada um, o que fica
em `shared/`) e **espere aprovação** se a feature mexer em mais de 3 arquivos,
em `shared/`, na voz/LiveKit ou no protocolo do Socket.IO. Só então implemente.

## 4. Documentar (mesmo commit)

- Crie `docs/features/<slug>.md` a partir de `docs/features/_TEMPLATE.md`.
  Preencha de verdade a seção **Decisões e por quê** — é a parte que evita
  alguém "consertar" a escolha depois.
- Adicione a linha no índice **Features** do `README.md`.
- Se você migrou detalhe de uma feature antiga para um doc novo, deixe no README
  só o resumo + link. **Não duplique** conteúdo.
- O que não foi testado vai para `PENDENTES.md`.

## 5. Fechar

1. `npm run typecheck` limpo (server + client) — obrigatório.
2. Teste real quando possível: `npm run dev`, duas abas, o fluxo da feature.
   Precisa de HTTPS? `npm run dev:https`.
3. Confira o diff: nenhum segredo, nenhuma variável `VITE_*` com nome de
   segredo, nada de `.env` no staged (o hook `.githooks/pre-commit` também barra).
4. Relate honestamente o que ficou de fora e por quê.

## Segurança (vale sempre)

Não leia `.env` nem qualquer chave — se precisar saber quais variáveis existem,
leia `.env.example` (nomes, não valores). Nunca imprima, logue ou repita um
segredo. `LIVEKIT_API_SECRET` é só do server.
