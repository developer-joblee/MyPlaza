# Regras de trabalho — toGether

Este arquivo é carregado em toda sessão do Claude Code neste repo. Vale para
**qualquer feature nova, correção ou refactor**. Se algo aqui conflitar com um
pedido pontual do usuário, o pedido do usuário ganha — mas avise o conflito.

## 1. Antes de escrever código: ler

Nesta ordem, sempre:

1. **`README.md`** — porta de entrada. Stack, arquitetura (`shared`/`server`/`client`),
   como rodar, deploy e o **índice de features** (seção "Features").
2. **`docs/features/<feature>.md`** — se a feature que você vai mexer (ou algo
   que ela toca) já está no índice do README, leia o doc dela antes. Ele é a
   fonte de verdade sobre decisões, armadilhas e o que já foi testado.
3. **`PENDENTES.md`** — o que ainda não foi verificado. Não retrabalhe o que já
   está verificado, e não assuma como pronto o que está pendente.
4. O código real dos arquivos citados nesses docs. Docs podem ter envelhecido;
   o código manda.

Não comece a implementar sem ter feito essa leitura. Se a feature não existe em
nenhum doc, diga isso explicitamente antes de propor o desenho.

## 2. Organização e reuso de componentes

A regra é: **procure antes de criar**. Duplicar componente, helper, tipo ou
constante que já existe é bug em potencial (dois lugares para corrigir).

Onde cada coisa mora:

| O que | Onde | Observação |
|---|---|---|
| Tipos, eventos Socket.IO, constantes, mapas/cenários | `shared/src/` | **Fonte única** client+server. Nada de redeclarar do lado do client. |
| Presença, posições, chat, token do LiveKit | `server/src/` | Único lugar que vê segredos. |
| UI (React) | `client/src/ui/` | HUD, chat, controles, telas. |
| Jogo (PixiJS, fora do React) | `client/src/game/` | Game loop no canvas; não misturar React aqui. |
| Estado compartilhado UI↔jogo | `client/src/state/store.ts` (zustand) + `client/src/runtime.ts` | A ponte é essa. Não criar canal paralelo. |
| Voz/proximidade/zonas | `client/src/voice/` | `VoiceRoom.ts` é o dono da assinatura de áudio. |
| Ícones | `client/src/ui/icons.tsx` | Adicione ali; não inline SVG novo em componente. |
| Estilos | `client/src/styles.css` | Um arquivo só. Não introduzir CSS-in-JS. |
| Helpers de UI | `client/src/ui/util.ts` | Antes de criar um helper, veja se já está aqui. |

Além disso:

- Componente que aparece em mais de um lugar sai do arquivo onde nasceu e vira
  componente próprio em `client/src/ui/`, com props explícitas. Não copie JSX.
- Constante mágica (raio, tempo de tick, tamanho de tile, cor) vai para
  `shared/src/constants.ts` ou para o módulo dono da feature — nunca literal
  espalhado.
- **Não adicione dependência nova sem perguntar.** Idem para asset novo: os
  packs usados têm licença (parte é **não-comercial**) e todo asset precisa de
  crédito na seção "Créditos de assets" do README.
- Mudança em `shared/` afeta server e client: verifique os dois.

## 3. Toda feature tem seu próprio doc

Cada feature vive em **`docs/features/<slug>.md`**, criado a partir de
`docs/features/_TEMPLATE.md`, e é **linkada no índice "Features" do README**.
Isso existe para que a próxima sessão encontre a feature pelo README em vez de
reengenharia a partir do código.

Regras:

- **Feature nova** → cria `docs/features/<slug>.md` e adiciona a linha no índice
  do README, **no mesmo commit** do código. Feature sem doc não está pronta.
- **Feature existente que ainda não tem doc** (hoje várias estão descritas
  direto no README) → ao mexer nela, crie o doc, mova para lá o detalhe
  técnico e deixe no README apenas o resumo + link. Sem duplicar conteúdo:
  informação em dois lugares divergem.
- **Mudou o comportamento** → atualize o doc no mesmo commit. Doc desatualizado
  é pior que doc ausente.
- Doc curto e útil: o que faz, por quê assim, arquivos envolvidos, armadilhas,
  como testar. Não é changelog nem cópia do código.
- O que **não foi verificado** vai para `PENDENTES.md`, não escondido no doc.

## 4. Segurança — segredos são intocáveis

Nível máximo, sem exceção e sem "só para depurar":

- **Nunca leia `.env`** (nem `.env.local`, `.env.*`, chaves, `*.pem`, tokens).
  Não `cat`, não `grep`, não `Read`. Se precisa saber quais variáveis existem,
  leia **`.env.example`** — ele tem os *nomes*, não os valores.
- **Nunca imprima, ecoe, logue ou repita um segredo** em resposta, commit,
  comentário, mensagem de erro, print de tela ou arquivo temporário. Se um valor
  secreto aparecer na sua frente por acidente, não o reproduza — diga apenas
  que apareceu.
- **Nunca envie segredo para fora**: nada de colar em issue, PR, chat externo,
  API de terceiro, gist ou serviço de paste.
- **Nunca commite segredo.** `.env` está no `.gitignore` — mantenha assim.
  Antes de commitar, confira o diff em busca de chave/token colado.
- **`LIVEKIT_API_SECRET` é exclusivamente do server** (`server/src/voice.ts`
  assina os tokens). No client, tudo com prefixo `VITE_` **vai para o bundle do
  navegador** — jamais coloque segredo em variável `VITE_*`.
- Ao logar configuração, logue **presença**, não valor: `LIVEKIT_URL: set` /
  `unset`. Nunca o conteúdo, nem "os primeiros caracteres".
- Se um segredo vazar (foi commitado, apareceu em log público, foi compartilhado):
  pare, avise o usuário e trate como comprometido — a chave precisa ser
  **rotacionada** no dashboard do LiveKit. Remover o commit não desfaz o vazamento.
- Credencial nova só entra via `.env` local + Variables do Railway, com o nome
  documentado no `.env.example`. Nunca hardcoded, nem em `docs/`.

## 5. Definição de pronto

Antes de dizer "feito":

1. `npm run typecheck` (server + client) limpo — obrigatório.
2. Testado de verdade quando dá: `npm run dev`, duas abas, o fluxo da feature.
   Não dá para testar? Diga o que não foi testado e registre em `PENDENTES.md`.
3. Doc da feature criado/atualizado + link no índice do README.
4. Nada de segredo no diff.
5. Relate honestamente o que ficou de fora e por quê.

## 6. Ferramentas que apoiam estas regras

- **`/nova-feature <descrição>`** — executa o ritual acima do começo ao fim
  (leitura → reuso → plano → doc → typecheck). Use para feature nova.
- **`/doc-feature <nome>`** — cria o `docs/features/` de uma feature que já
  existe, migrando o detalhe do README sem duplicar.
- **`.githooks/pre-commit`** — varre o staged diff em busca de segredo e barra
  `.env`, `.pem`, `.key`, keystore e `VITE_*` com nome de segredo. Nunca imprime
  o valor achado, só arquivo, linha e tipo. Também **avisa** (sem bloquear) se
  código em `client|server|shared/src/` foi alterado sem tocar README,
  `docs/features/` ou `PENDENTES.md`.
  Ativar uma vez por clone: `git config core.hooksPath .githooks`.
  Falso positivo: marque a linha com `secret-scan:ignore`.
  Não use `--no-verify` para "resolver" um achado — resolva o achado.
- **`.claude/settings.json`** — o bloco `deny` impede a leitura de `.env`,
  chaves e keystores por ferramenta ou por bash. Se algo aí barrar seu trabalho,
  isso é sinal para perguntar ao usuário, não para procurar outro caminho até o
  arquivo.
