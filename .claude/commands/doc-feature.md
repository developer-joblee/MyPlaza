---
description: Cria o docs/features/ de uma feature que já existe no código (sem inventar)
argument-hint: <nome da feature ou arquivo principal>
---

Documente uma feature **que já existe** no toGether: **$ARGUMENTS**

Objetivo: transformar o que hoje está espalhado (README + código) em
`docs/features/<slug>.md`, sem inventar e sem duplicar.

1. Leia `README.md` (índice **Features** e a seção que descreve essa feature),
   `PENDENTES.md`, e **todo o código** envolvido — a fonte de verdade é o código.
2. Copie `docs/features/_TEMPLATE.md` para `docs/features/<slug>.md` e preencha
   a partir do que você **leu**, não do que você supõe. Valor de constante,
   raio, tick: cite o valor real e o arquivo onde está definido.
3. Em **Decisões e por quê**, registre só o que você conseguir sustentar pelo
   código, pelos comentários ou pelo histórico do git (`git log -p` no arquivo).
   Não deduza intenção. O que for suposição sua, marque como suposição.
4. Em **Armadilhas**, registre o que quebra sem aviso (ex.: `track.attach()`
   obrigatório com `adaptiveStream`, limpeza de estado ao sair, mudança em
   `shared/` afetando os dois lados).
5. Atualize o índice **Features** do README: troque o link antigo pelo doc novo
   e **reduza a seção do README a resumo + link**, movendo o detalhe técnico
   para o doc. Informação em dois lugares divergem.
6. O que você não conseguiu confirmar vai para **Não verificado** no doc **e**
   para `PENDENTES.md`.

Não leia `.env` nem qualquer credencial; use `.env.example` para nomes de
variáveis. Nunca copie valor de segredo para dentro de doc.
