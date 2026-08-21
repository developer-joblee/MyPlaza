# Autenticação e controle de acesso

**Status:** em uso — login e entrada funcionando contra um Supabase real desde
2026-08-20. Sem envio de e-mail (por decisão, até haver domínio): sem confirmação
de cadastro e sem recuperação de senha. O acesso a um mundo é concedido pelo
**ID** da conta.
**Última atualização:** 2026-08-20

## O que faz

A pessoa entra com **conta própria** (e-mail e senha, Supabase Auth) e passa a
ser sempre a mesma pessoa: o perfil, a posição salva e o histórico ficam
amarrados à conta, não ao navegador. Criar conta **entra na hora** — não há
confirmação, porque não há envio de e-mail. Em cima disso, três controles:

- **Quem pode entrar na empresa** — só quem foi adicionado pelo **ID**. Conta
  criada sozinha não dá acesso a nada.
- **Quem pode entrar num local** — local `restricted` exige estar na lista.
- **Quantos cabem** — `places.capacity` barra a partir da N-ésima pessoa.

Sem Supabase configurado, nada disso existe e o app roda anônimo como antes
(dev e demo continuam funcionando).

## Sem e-mail: senha, e acesso pelo ID

**Nada neste app envia e-mail.** Não há confirmação de cadastro, não há link, não
há código, não há recuperação de senha. É uma decisão de "por agora": o SMTP
embutido do Supabase só entrega para membros da organização do projeto, e SMTP
próprio exige um domínio verificado que ainda não existe. Em vez de manter um
fluxo que só funciona para uma pessoa, o e-mail saiu do caminho por completo.

O que sobra é o mínimo que funciona sem envio:

| | Como é |
|---|---|
| Criar conta | e-mail + senha, **entra na hora** (sem confirmação) |
| Entrar | e-mail + senha |
| O e-mail | só **identificador de login** — nunca é destino de nada |
| Ganhar acesso a um mundo | quem administra adiciona a pessoa pelo **ID** dela |
| Esquecer a senha | **não tem saída pela tela** (ver Armadilhas) |

### Por que desligar a confirmação deixou de ser furo

A versão anterior deste doc dizia, corretamente: **não desligue "Confirm
email"**. O motivo era que os convites eram indexados por e-mail
(`invites.email`), então sem verificar o endereço alguém se cadastraria com o
e-mail de outra pessoa e reivindicaria o convite dela. A verificação de e-mail
era o que sustentava o convite.

Esse furo não existe mais porque **o e-mail saiu do caminho do acesso**. O acesso
é concedido contra o `profiles.id` — uma conta que já existe, criada por quem
está usando. Cadastrar-se com o e-mail de outra pessoa não herda nada, porque não
há nada indexado por e-mail para herdar.

As duas mudanças só valem **juntas**: desligar a confirmação mantendo convite por
e-mail seria o furo original de volta. Está registrado aqui porque é
exatamente o tipo de coisa que alguém "religa" seis meses depois sem saber o par.

### O ID

É o `profiles.id` (uuid), exibido no lobby com um botão de copiar. A pessoa entra,
copia o ID e manda para quem administra o mundo — por Slack, WhatsApp, o que for.
Quem administra cola no campo do mundo e a pessoa é adicionada.

**Não há passo de aceite.** Ter um ID significa já ter conta, então não há nada
para esperar: quem administra adiciona e o acesso existe. Isso eliminou a
sequência de três escritas do aceite de convite, que o `PENDENTES.md` apontava
como a mais frágil da entrega do lobby.

**O ID não é segredo.** Por si só ele não dá acesso a nada — só nomeia quem já
tem conta, e quem decide o acesso é quem administra o mundo. Isso é o que permite
exibi-lo na tela e mandá-lo por chat sem cuidado especial. Não é um token.

`isProfileId()` vive em `shared/src/constants.ts` porque os **dois** lados
validam: o cliente para não habilitar o botão com texto colado torto, e o
servidor porque esconder o botão não é validação. Sem a checagem no servidor,
texto qualquer chegaria ao banco e voltaria como erro de sintaxe de uuid — que a
tela mostraria como "erro" onde a verdade é "esse ID não existe".

### O que ficou dormente (e por que não foi deletado)

O convite por e-mail continua **inteiro** no código e no schema — tabela
`invites`, `inviteToWorld`, `acceptInvite`, `acceptInviteById`, os eventos
`lobby:accept`/`lobby:decline`, os tipos `PendingInvite`/`SentInvite` e a UI que
os mostra. Nada cria linha nova, então as listas chegam vazias e a UI não
aparece.

Ficou porque é o caminho de volta quando houver domínio: convidar **quem ainda
não tem conta** só é possível por e-mail, e é um caso real. Deletar para
reescrever depois trocaria código que já existe por código novo não testado. O
que **saiu de verdade** é o aceite automático no portão — esse era o furo, não a
tabela.

## Como funciona

**Onde mora a identidade.** No handshake do socket, não no `join`:
`socket.handshake.auth.token` leva o access token do Supabase, e o servidor
pergunta ao Supabase de quem é (`auth.getUser`). Nome, cor e personagem
continuam vindo do `join`, mas são só escolha de aparência — **o cliente não
pode dizer quem é**.

O `auth` do Socket.IO é passado como **função**, não objeto: ele é reavaliado a
cada tentativa de conexão, então a reconexão pega o token que o SDK renovou. Com
um objeto fixo, uma sessão longa reconectaria com token vencido.

**O portão**, em `server/src/handlers.ts`, na ordem — e qualquer passo que
devolva `null` recusa:

1. tem token? → `auth-required`
2. o token vale? → `invalid-token`
3. perfil desta conta (cria na primeira vez, por `auth_user_id`)
4. o local existe nesta empresa? → `no-place`
5. tem membership ativa? → `no-invite` / `no-membership`. **Só confere, não
   concede**: o aceite automático de convite por e-mail saiu daqui (era o furo
   que a confirmação de e-mail sustentava)
6. local restrito: está na lista? → `place-restricted`
7. cabe? → `place-full`

A recusa volta como `join:denied(reason)` — código, nunca texto livre, para a
mensagem não distinguir "essa empresa não existe" de "você não é membro dela".
O cliente traduz em `JoinScreen.tsx`.

**Mundo por local.** Antes o mundo era indexado pelo cenário
(`getWorld(scenarioId)`) e a sala de voz também (`roomNameFor(scenarioId)`).
Com empresas no banco isso virou furo: o Estúdio da empresa A e o da B eram o
**mesmo lugar**, com a **mesma sala de LiveKit** — gente se ouvindo entre
empresas, invisível no mundo uma da outra. Agora a chave do mundo é o
`places.id`, e é ela que nomeia a sala de voz. Sem banco, uma chave sintética
(`scenario-<id>`) reproduz o comportamento antigo.

**Lotação é contada em memória** (`world.size`), não por `sessions` abertas no
banco: sessão que não fechou por queda de conexão contaria gente que já saiu, e
o local ficaria "cheio" sem ninguém dentro.

## Arquivos

| Arquivo | Papel |
|---|---|
| `client/src/auth/supabase.ts` | cliente do Supabase no navegador, sessão, `signIn`/`signUp` e tradução de erro |
| `client/src/ui/LoginScreen.tsx` | entrar / criar conta, num formulário só (reusa as classes `.join-*`) |
| `client/src/App.tsx` | fases `boot` → `login` → `lobby` → `join` → `playing` |
| `client/src/state/store.ts` | `authEmail` (e a transição de fase que ele dispara) e `myId` |
| `client/src/ui/LobbyScreen.tsx` | mostra o **seu ID** (com copiar) e o campo para adicionar gente |
| `shared/src/constants.ts` | `isProfileId()` — validação do ID nos dois lados |
| `server/src/db.ts` | `addMemberToWorld()`; `inviteToWorld`/`acceptInvite` dormentes |
| `client/src/net/socket.ts` | token no handshake, em forma de função |
| `client/src/net/bindStore.ts` | escuta `join:denied` |
| `client/src/ui/JoinScreen.tsx` | motivo da recusa em português, e "sair da conta" |
| `server/src/auth.ts` | `verifyAccessToken()` — fail-closed |
| `server/src/supabase.ts` | conexão, timeout e dedupe (usado por `auth.ts` e `db.ts`) |
| `server/src/db.ts` | `findOrCreateProfile`, `findMembership`, `acceptInvite`, `isPlaceMember`, `resolvePlace` |
| `server/src/handlers.ts` | o portão, e todo broadcast passando a usar `worldKey` |
| `server/src/world.ts` | `getWorld(key, scenarioId)`, `scenarioWorldKey()`, `world.size` |
| `server/src/voice.ts` | `roomNameFor(worldKey)` — isolamento da voz |
| `shared/src/types.ts` | `JoinDeniedReason` |
| `shared/src/events.ts` | `join` sem identidade; evento `join:denied` |
| `db/migrations/0004_access.sql` | `places.capacity`, índice de convite por e-mail, `v_place_occupancy` |
| `db/migrations/0007_profile_id_default.sql` | `profiles.id` ganha `default gen_random_uuid()` — sem isso ninguém entra |
| `db/migrations/0008_grants.sql` | `grant` nas tabelas para o `service_role` — sem isso, `42501` em tudo |

## Decisões e por quê

**`auth.getUser(token)` em vez de verificar o JWT localmente.** Verificar na mão
seria mais rápido (sem ida à rede), mas exigiria guardar a chave de JWT — uma
chave a mais para vazar — e tratar os dois formatos do Supabase (simétrico
legado e assimétrico/JWKS dos projetos novos). E não respeitaria revogação:
conta desativada continuaria entrando até o token vencer. O custo é **uma**
chamada por conexão, no `join`, com o mesmo teto de tempo das consultas.

**O `join` deixou de carregar identidade.** Antes ia um `profileId` gerado pelo
cliente e guardado no `localStorage`. Isso era placeholder explícito ("id
anônimo agora, Auth depois") e não sobrevive a um sistema com controle de
acesso: quem manda o próprio id pode mandar o de outro. `shared/src/identity.ts`
foi removido junto — deixar o mecanismo antigo ali seria manter dois caminhos de
identidade, e o pior deles ainda funcionando.

**Não implementei migração do perfil anônimo.** `profiles.auth_user_id` existe
para isso, mas perfil anônimo só poderia ter sido criado na janela entre a
entrega anterior e esta, com Supabase configurado e sem login — na prática,
nenhum. Escrever migração para zero linhas é código não testado guardando um
caso que não existe.

**Convite é o único caminho de entrada.** Criar conta no Supabase é aberto (é o
que permite alguém aceitar um convite sozinho), então a conta por si só não pode
valer acesso — senão qualquer pessoa que descobrisse a URL entraria na empresa.
A alternativa (auto-vincular todo login novo à empresa configurada) foi
descartada por isso mesmo. Efeito colateral: `invites`, que estava no schema sem
uso, virou o mecanismo de verdade.

**Login obrigatório exatamente quando dá para verificar.** A regra é uma só:
`SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` presentes ⇒ token exigido. Sem flag
separada, porque flag separada é a coisa que se configura errado em produção.

**Fail-closed na autenticação, fail-soft no resto.** As funções de `db.ts`
engolem erro e seguem sem persistir — persistência é um plus. `verifyAccessToken`
faz o oposto: banco fora do ar devolve `null`, e `null` recusa. Verificado em
teste (Supabase apontado para porta fechada ⇒ `invalid-token`, ninguém entra).

**Acesso por ID, não por e-mail.** O convite por e-mail nunca precisou de
envio — era só uma linha no banco, casada com o e-mail de quem logava. O que ele
precisava era que o e-mail fosse **verificado**, e verificação exige envio. Sem
envio, indexar acesso por e-mail passa a ser reivindicável por qualquer um: é
por isso que a mudança foi para o ID, e não uma escolha de gosto.

**Adicionar direto, sem passo de aceite.** Convite pendente existe para alcançar
quem **ainda não tem conta**. Quem tem ID já tem conta, então esperar aceite
seria cerimônia: quem administra adiciona e o acesso existe. De graça, saiu a
sequência de três escritas sem transação que o `PENDENTES.md` marcava como a mais
frágil do lobby.

**O ID é o `profiles.id`, sem coluna nova.** Um código curto ("ABCD-2345") seria
mais fácil de ditar por telefone, mas custaria migração, geração e tratamento de
colisão. O uso real é copiar e colar num chat, onde 36 caracteres custam o mesmo
que 8. Se algum dia alguém precisar ditar o ID, um código curto é uma migração e
uma coluna — não uma reescrita.

**`invites` ficou, o aceite automático saiu.** A distinção é o ponto: a tabela e
o fluxo de aceite não são o furo, e são a única forma de alcançar quem não tem
conta. O furo era o portão **conceder** acesso a partir de um e-mail não
verificado. Foi isso que saiu de `handlers.ts`.

**Ler antes de escrever em `memberships`.** Um `upsert` com `role: 'guest'`
rebaixaria quem já é `owner` ou `admin` da empresa — e o caso mais fácil de
provocar é o dono colar o próprio ID no seu mundo, perdendo a própria empresa.
`addMemberToWorld` consulta primeiro e só reativa o `status`; o papel nunca é
tocado.

**A `anon key` do client é `VITE_*` de propósito.** O `CLAUDE.md` proíbe segredo
em `VITE_*`, e está certo — mas a anon key não é segredo: é publicável por
projeto, feita para ir no bundle. Quem protege o banco é o RLS, que não tem
nenhuma política de escrita. A `service_role` continua só no servidor.

## Armadilhas

- **A primeira pessoa não tem quem a convide.** Insira o convite direto no
  banco antes do primeiro login (SQL em `db/README.md`). Sem isso, todo login
  novo leva `no-invite` e parece que o app está quebrado.
- **`auth` do socket tem de ser função.** Trocar por objeto faz a reconexão
  levar token vencido e recusar com `invalid-token` no meio da sessão.
- **Mudar `roomNameFor` muda a sala de voz de todo mundo.** Quem está numa sala
  antiga não ouve quem entra depois do deploy. É restart, não migração.
- **Trocar `SUPABASE_ORG_SLUG` troca a empresa e, com ela, os locais** — logo,
  as chaves de mundo e as salas de voz.
- **`capacity` conta o mundo em memória.** Reiniciar o servidor esvazia a
  contagem (correto: ninguém está conectado), mas as `sessions` abertas no banco
  continuam abertas até alguém fechá-las.
- **"Confirm email" TEM de estar desligado no Supabase.** É
  **Authentication → Sign In / Providers → Email → Confirm email**, off. Com ela
  ligada, `signUp` volta sem sessão e o Supabase tenta mandar um e-mail que
  ninguém recebe: a pessoa fica com conta que não dá para usar. O
  `translate()` de `supabase.ts` tem ramo para esse erro e diz onde mexer, mas
  nada no repo detecta a configuração errada antes de alguém tentar.
- **Senha esquecida não tem saída pela tela.** Sem envio de e-mail não há
  recuperação. A saída é o dashboard do Supabase
  (**Authentication → Users → …**) trocando a senha à mão, ou apagar a conta e
  criar de novo — e apagar a conta significa **perder o acesso aos mundos**
  (`memberships` e `place_members` caem por `on delete cascade`), então quem
  administra precisa adicionar a pessoa de novo, pelo ID **novo**.
- **Não religue a confirmação de e-mail junto com convite por e-mail sem
  pensar.** As duas mudanças (confirmação desligada + acesso por ID) se
  sustentam **em par**. Voltar a conceder acesso a partir de e-mail com a
  confirmação desligada é o furo original: cadastro com o endereço de outra
  pessoa herda o acesso dela.
- **O ID muda se a conta for recriada.** Ele é o `profiles.id`, não o e-mail.
  Apagou a conta e criou de novo? É outra pessoa para o sistema, e todo acesso
  precisa ser concedido outra vez.
- **Adicionar o próprio ID ao seu mundo é inofensivo — mas só porque foi
  tratado.** `addMemberToWorld` lê antes de escrever justamente para não
  rebaixar `owner` a `guest`. Se algum dia isso virar um `upsert` "para
  simplificar", o dono perde a empresa.
- **A UI de convite pendente existe e nunca aparece.** `PendingInvite`,
  `SentInvite` e os blocos que os renderizam estão condicionados a lista não
  vazia, e nada cria linha nova. Não é código morto por acidente: é o caminho de
  volta quando houver domínio. Ver "O que ficou dormente".
- **Variável exportada no shell sobrepõe o `.env`, sem avisar.** O
  `--env-file-if-exists` do Node não substitui o que já existe no ambiente. Um
  `SUPABASE_URL` velho no shell faz o servidor falar com outro projeto (ou com um
  site, devolvendo HTML) enquanto o `.env` parece perfeito. O boot avisa quando a
  **forma** da URL está errada, mas não tem como detectar "certa, porém de outro
  projeto".
- **URL apontando para site devolve HTML, e o erro não diz isso.** O supabase-js
  falha com `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`, que não
  menciona configuração em lugar nenhum. O endereço do **painel**
  (`supabase.com/dashboard/…`) não é endpoint de API; o valor certo é
  `https://<ref>.supabase.co`. Num Supabase local, a API é a `54321` — a `54323`
  é o Studio, e serve HTML.
- **Catálogo vazio impede qualquer login.** `profiles.character_id` tem FK para
  `characters` (com default `'adam'`), então sem o `seed.sql` todo insert de
  perfil morre com `23503`. A mensagem fala de constraint e não menciona seed. E
  como o SQL Editor do Supabase roda o script numa transação só, **um** erro em
  qualquer linha do seed desfaz o seed inteiro — o catálogo fica vazio para quem
  jura ter rodado. O boot avisa quando `characters` está vazia.
- **`BYPASSRLS` não é privilégio de tabela.** O `service_role` ignora RLS, e
  ainda assim precisa de `GRANT`. Se o schema for aplicado por um papel diferente
  do `postgres`, as *default privileges* do Supabase não alcançam o
  `service_role` e **tudo** falha com `42501 permission denied for table …`.
  Corrige `0008_grants.sql`. O boot agora sonda isso e avisa.
- **Rode todas as migrações com o mesmo papel.** As *default privileges* da
  `0008` são registradas por quem as executa: aplicadas por um papel e as tabelas
  criadas por outro, o problema volta na próxima tabela.
- **`profiles.id` precisa da migração `0007`.** A coluna nasceu sem default
  porque o id vinha do cliente (o `identity.ts` que foi removido com a chegada do
  Auth). Sem o default, **todo** insert de perfil falha, e como as funções de
  perfil são fail-soft o erro chega à tela como `invalid-token` — "sua sessão
  expirou". Se alguém aplicar só `0001`→`0006` num projeto novo, o app fica
  inteiramente inutilizável com uma mensagem que aponta para o lugar errado.
- **`null` do `ensureProfile` não é problema de sessão.** O `whoAmI` do lobby
  agora devolve o motivo (`auth-required` / `invalid-token` / `error`) em vez de
  `null` para tudo, justamente porque essa confusão custou uma sessão de
  depuração. Se alguém "simplificar" de volta para `LobbyIdentity | null`, o
  sintoma enganoso volta.
- **Deslogar não desconecta o socket na hora**: o `onAuthStateChange` troca a
  fase e o `GameView` desmonta, o que derruba o socket no cleanup. Se algum dia
  a fase deixar de desmontar o `GameView`, o socket ficaria vivo com sessão
  morta.

## Como testar

**Sem Supabase** (verificado): `npm run dev` entra direto, anônimo, como antes.

**Com Supabase:**

1. Aplique `0001`→`0008` e o `seed.sql` (ver `db/README.md`). O boot do servidor
   avisa se faltar schema (`42P01`) ou privilégio (`42501`).
2. `.env` da raiz: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
   `SUPABASE_ORG_SLUG`, e as duas do client (`VITE_SUPABASE_URL`,
   `VITE_SUPABASE_ANON_KEY`, publicável). O boot loga `login obrigatório`. <!-- secret-scan:ignore -->
3. **Dashboard: desligar "Confirm email"** (Authentication → Sign In / Providers
   → Email). É o único passo de dashboard que resta — não há template nem
   redirect nem SMTP para configurar.
4. Criar conta → tem que **entrar direto**, sem pedir confirmação. Recarregar a
   página tem que continuar logado. Se aparecer "este projeto exige confirmação
   por e-mail", o passo 3 não foi feito.
5. No lobby, **o seu ID aparece** e o botão "Copiar" funciona. Criar um mundo
   próprio funciona sem ninguém te adicionar.
6. Sem acesso, entrar num mundo da empresa `demo` → **"sua conta não tem
   convite"** (`no-invite`).
7. **Duas contas.** Crie a segunda num navegador anônimo, copie o ID dela, e no
   primeiro navegador use "Adicionar" no seu mundo. A segunda conta tem que
   passar a ver o mundo no lobby e conseguir entrar. Confira no banco:
   `select * from memberships;` e `select * from place_members;` com uma linha
   nova cada.
8. **ID inválido** ("abc", uuid que não existe): o botão fica desabilitado para
   texto malformado, e um uuid inexistente tem que dar **"não encontrado"** — não
   "erro".
9. **Não se rebaixe:** cole o **seu próprio** ID no seu mundo. Depois confira
   `select role from memberships where profile_id = '<seu id>';` — tem que
   continuar `owner`, não `guest`.
10. Lotação: `update places set capacity = 1 where slug = 'studio';` — a segunda
   aba tem que levar **"este local está cheio"**.
11. Restrito: crie um segundo mundo no lobby e rode
   `update places set visibility = 'restricted' where id = '<id do mundo>';`
   — entrar nele tem que ser recusado até a pessoa ser adicionada. (Não use o
   local do seed: se você restringir o `studio`, perde o caminho de teste dos
   outros passos.)
12. Isolamento: crie uma segunda empresa e um segundo local no mesmo cenário;
   duas pessoas, uma em cada, **não** podem se ver nem se ouvir.
13. Sessão: derrube a sessão no dashboard do Supabase e recarregue — tem que
   voltar para a tela de login.

## Não verificado

Espelhado em `PENDENTES.md`, que tem a lista completa e ordenada.

**O que passou a funcionar** (confirmado no primeiro uso real): boot com a sonda
limpa, criar conta e entrar sem confirmação, `verifyAccessToken` no caminho de
sucesso, `ensureProfile` criando perfil, `lobby:list` inteiro, e o portão do
`join` até `getWorld`. Até esta data, **todo** teste parava em `invalid-token`.

**O que ainda falta**, em ordem:

- **Acesso por ID entre duas contas.** `addMemberToWorld` é a escrita central da
  entrega e não foi confirmada: duas escritas sem transação mais a leitura que
  evita rebaixar o dono. Passo 7 de "Como testar".
- **Não rebaixar o dono** ao colar o próprio ID (passo 9). É a falha mais feia
  possível e o tratamento nunca foi provocado.
- **ID malformado × inexistente** — `not-found`, não `error` (passo 8).
- **`myId` na tela e o botão de copiar.** `navigator.clipboard` falha em HTTP fora
  de localhost; o `catch` existe e não rodou.
- **`capacity`, local restrito e isolamento entre empresas** (passos 10 a 12).
- **Renovação de token em sessão longa (>1h)** e **sessão revogada em outra aba**.
- **`no-invite` é um nome que mente** — não existe mais convite, e o código de
  recusa continua com esse nome.

## Relacionado

- [`docs/features/persistencia-supabase.md`](persistencia-supabase.md) — perfis,
  posição salva e atividade da sessão
- [`db/README.md`](../../db/README.md) — como aplicar o schema e convidar alguém
