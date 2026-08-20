# <Nome da feature>

> Copie este arquivo para `docs/features/<slug>.md`, preencha e adicione a linha
> no índice "Features" do `README.md`. Apague estas instruções e o que não se
> aplicar. Curto e útil: quem lê é a próxima sessão do Claude (ou você em três
> meses), e ela precisa entender **por quê**, não só o quê.

**Status:** em uso · experimental · descontinuada
**Última atualização:** AAAA-MM-DD

## O que faz

Uma ou duas frases, do ponto de vista de quem usa. Se tem atalho de teclado ou
botão, cite-o igual ao README.

## Como funciona

O mecanismo, não o passo a passo do código. O que roda no client, o que roda no
server, o que vem de `shared/`. Se houver um tick, um raio, um limiar — diga o
valor e onde ele está definido.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/...` | |
| `server/src/...` | |
| `shared/src/...` | |

## Decisões e por quê

Escolhas que não são óbvias pelo código, e a alternativa descartada. É a parte
mais valiosa do doc — sem ela alguém "conserta" a decisão de propósito.

## Armadilhas

O que quebra sem aviso claro: ordem de chamada obrigatória, API que exige
`attach()`, estado que precisa ser limpo ao sair, mudança em `shared/` que
afeta os dois lados, dependência de HTTPS/contexto seguro.

## Como testar

Passos reais. Precisa de duas abas? De HTTPS (`npm run dev:https`)? De
credenciais do LiveKit no `.env` (nunca leia o `.env` — só confira se as
variáveis do `.env.example` estão definidas)?

## Não verificado

O que ficou sem teste. Espelhe em `PENDENTES.md` para não se perder.

## Relacionado

Links para outros `docs/features/*.md` e para a seção correspondente do README.
