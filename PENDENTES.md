# Pendências de verificação

O que **não foi verificado** (ou foi verificado só parcialmente). Atualizado em
2026-08-20.

---

# Chamado de quem está ausente ("toc-toc") — 2026-08-20

Feature nova: `docs/features/chamado-ausente.md`.

## Já verificado

### O servidor, de verdade (headless, modo anônimo em :3099)

Script de quatro sockets no molde do `smoke-test.mts`, contra o servidor rodando
com Supabase e LiveKit desligados. Passou em tudo:

- chamado chega **só no alvo**, com o `socket.id` e o nome de quem chamou;
- **chamar quem está presente é recusado** (o alvo tem de estar ausente);
- **cooldown por par**: o segundo clique dentro de `NUDGE_COOLDOWN_MS` não passa;
- o cooldown **não é global**: outro remetente do mesmo mundo passa na hora;
- **isolamento entre mundos**: quem está em outro cenário não alcança o alvo;
- alvo inexistente, alvo vazio e chamar a si mesmo são ignorados sem derrubar
  socket nenhum;
- quem **voltou** de ausente para de receber chamado.

Também: `npm run typecheck` (server + client) limpo e `npm run build` do client
sem erro. O script de teste ficou fora do repo (rodou da raiz e foi apagado; o
`smoke-test.mts` continua como está).

## Falta verificar (em ordem de importância)

### 1. Nada da interface foi visto num navegador

Tudo abaixo é lógica de client que **não** foi exercitada: o botão **chamar** na
linha de quem está ausente, o aviso `.notice.nudge` na pilha, o texto no plural
("Ana e Bruno estão te chamando"), o "+N" a partir de `NUDGE_MAX_NAMES`, o botão
**Voltar**, o dispensar (`×`) e o estado "chamado" do botão por 15s. O roteiro
está em "Como testar" no doc da feature — `npm run dev`, duas abas.

### 2. O "toc-toc" nunca foi ouvido

`client/src/ui/knock.ts` sintetiza o som em WebAudio (~2,5s: quatro ciclos de
duas batidas) e nunca rodou num navegador. Riscos: (a) o `AudioContext` nascer
suspenso e o `resume()` ser recusado porque o chamado não vem de um gesto do
usuário — nesse caso o aviso visual continua, mas o som não toca, e é justo o
canal que serve para quem está olhando outra janela; (b) volume/timbre errados
na prática (`PEAK` = 0,14); (c) o padrão de 2,5s pode soar insistente demais no
uso real — `REPEATS` e `CYCLE_S` são os dois números para ajustar; (d) a trava
`busyUntil` (chamado novo durante o som não redispara) nunca foi exercitada com
duas pessoas chamando quase junto.

### 3. Reconexão no meio de um chamado

Se o socket do alvo cair e voltar, ele é um `socket.id` novo — o `nudgedAt` do
remetente ainda tem o id antigo, então um chamado novo passa na hora (o que é o
comportamento desejado), mas nada disso foi exercitado com queda real.

### 4. Chamado com o alvo em outra aba congelada

Aba em segundo plano pode ter o timer estrangulado pelo navegador e o socket
caído por `ping timeout` (é o que o log de `disconnect` já mostrava). Se o alvo
tinha caído, o chamado simplesmente não chega e quem chamou não sabe — por
desenho, mas nunca foi observado.

### 5. Não há trilha no banco

`presence:nudge` não grava nada (nem quem chamou, nem quando). As outras
atividades de sessão (visita de sala, tela compartilhada, token de voz) gravam.
Ficou de fora por escolha — chamado é efêmero — mas se um dia isso virar
métrica de "ninguém responde quando chamam", vai faltar dado.

### 6. Ausência é sempre manual

Não existe detecção automática de idle: ficar ausente é só o botão de celular. A
feature entrega a notificação para **quem já está ausente** — se a ideia era
também "entrar em idle sozinho depois de N minutos sem teclado", isso não foi
feito e não estava no pedido.

---

# Deploy no Railway: Node 22 — 2026-08-20

O deploy depois do commit `eec1849` entrou em **loop de restart**. Causa, nos
logs do Railway: `Error: Node.js detected but native WebSocket not found` em
`@supabase/realtime-js`, com `Node.js v20.20.2`. O `createClient` de
`server/src/supabase.ts` roda no import do módulo, então o processo morre antes
de subir o HTTP — o fail-soft do `supabase.ts` cobre "sem variável" e "banco
fora do ar", não "runtime sem `WebSocket`".

Correção aplicada: `engines.node` para `>=22` e **`.nvmrc` com `22`** (o
Nixpacks resolve a versão pelo `.nvmrc`; o range `>=20.12` ele resolvia para o
Node 20). README atualizado nos dois lugares que citavam Node 20.12+.

## Falta verificar

### 1. O deploy em si
Ninguém confirmou que o Railway rebuildou com Node 22 e que o serviço ficou de
pé. Como verificar: novo deploy, e no log de boot esperar o listen do server
sem o `Node.js detected but native WebSocket not found`. Se o log ainda mostrar
`Node.js v20.*`, o Nixpacks ignorou o `.nvmrc` — nesse caso definir
`NIXPACKS_NODE_VERSION=22` nas Variables do serviço.

### 2. Nada foi rodado localmente em Node 22
A máquina de desenvolvimento está em Node 24, então o `>=22` só foi verificado
por `npm run typecheck` (limpo). Se alguém estiver em Node 20, o `npm install`
agora avisa/quebra por `engines` — é o comportamento desejado.

---

# Camada de requisição no client — 2026-08-20

Ver a seção **Arquitetura** do `README.md` e `docs/features/lobby.md`.

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` OK.
- ✅ **Nenhum `socket.emit` fora de `client/src/net/`** — a regra que a camada
  existe para impor.
- ✅ Os quatro defeitos, com teste dirigido contra o servidor real (script
  temporário, sem Supabase):
  - socket caído → `socket-down` em **0ms** (antes: pendurava até o prazo do ack,
    porque o pacote ia para o `sendBuffer` e o ack nunca era limpo);
  - queda **durante** a espera → `socket-down` em 0ms, o que destrava o botão
    (antes o `busy` ficava preso até remontar o componente);
  - dois `create` simultâneos → 1 requisição, o segundo devolve `null`, e a
    chave libera depois (não trava para sempre);
  - `chatSend` devolve `false` sem conexão e `true` com — é o que faz o `Chat`
    não limpar o campo de uma mensagem que não foi.
- ✅ Regressão: `smoke-test.mts` 14/14, e os 12 métodos da api levando
  `invalid-token` com Supabase configurado e fora do ar (portão intacto).

## Corrigido depois do primeiro uso real (2026-08-20)

Três defeitos que só apareceram quando alguém tentou subir o app de verdade, e
que a verificação por script nunca pegaria:

- **O Vite não lia o `.env` da raiz.** `envDir` não estava definido, então ele
  procurava em `client/` e as duas `VITE_*` eram silenciosamente ignoradas — o
  client achava que não havia login enquanto o servidor exigia token. Corrigido
  com `envDir: '..'` em `client/vite.config.ts`.
- **`createClient` no topo do módulo derrubava o app.** URL inválida faz o SDK
  lançar em tempo de import, e a página ficava **em branco**. Agora degrada para
  o modo anônimo com erro no console.
- **A fase `boot` podia ficar presa e era invisível.** `currentSession()` sem
  `.catch` + `boot` renderizando um `<div>` vazio = tela branca sem pista.
  Agora tem `catch` (falha ao ler sessão = tela de login) e o `boot` mostra o
  logo.
- **Beco sem saída em `auth-required`.** A mensagem mandava "entre com sua
  conta" mesmo quando o client não tinha login configurado — ou seja, sem tela
  de login para onde ir. Agora nomeia a causa real (falta `VITE_SUPABASE_*` no
  deploy).

## Falta verificar

### 1. Nada disso foi visto num navegador
Igual ao resto do lobby: a camada foi exercitada por script Node contra o
servidor, não pela UI. Em particular, o comportamento do `busy` na tela (botão
que destrava ao cair a conexão) foi provado na api, não no React.

### 2. `move`/`sit` passaram a atravessar uma função por tick
Rodam a `TICK_RATE` (15/s) e agora vão por `worldApi`. O custo é uma chamada de
função — irrelevante em teoria, não medido em prática. Se algum dia o game loop
aparecer num profile, é um lugar a olhar.

### 3. A api do lobby lê o socket por getter
`createLobbyApi(() => socketRef.current)` resolve o socket no momento do envio,
o que é o certo para reconexão — mas nunca foi testado com o socket sendo
substituído no meio de uma chamada.

---

# Lobby (criar mundos e convidar) — 2026-08-20

Ver [`docs/features/lobby.md`](docs/features/lobby.md).

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo e `npm run build` do client OK.
- ✅ Sem Supabase: os eventos do lobby respondem `not-configured`, e o modo
  anônimo do jogo continua entrando **sem** `worldId` — `smoke-test.mts` 14/14.
- ✅ Com login exigido e banco fora do ar: os **doze** eventos respondem
  `invalid-token`, sem token e com token lixo. Nada é criado, arquivado,
  removido, revogado, promovido nem transferido (o log do servidor não registra
  escrita nenhuma), e o `join` é recusado antes de avaliar o mundo.

## Verificado contra um Supabase real — 2026-08-20

- ✅ **`lobby:list` roda de verdade**: `buildState`, `listWorldsFor`,
  `listPendingInvites` e o `myId` novo. Era o primeiro evento a falhar (perfil não
  criado) e é o que passou a funcionar.
- ✅ A tela do lobby abre com Supabase configurado (antes só compilava).

Ver a seção de autenticação para a cadeia inteira e o que ela prova.

## Falta verificar (em ordem de importância)

### 1. As ESCRITAS do lobby ainda não foram executadas
Criar mundo, criar a empresa pessoal e **adicionar alguém pelo ID** não foram
confirmados. São as sequências mais frágeis: `ensureOrgForNewWorld` faz duas
escritas sem transação (empresa + membership) e `addMemberToWorld` faz duas, mais a
leitura que evita rebaixar o dono. A ordem foi escolhida para falhar de forma
recuperável, e isso não foi observado. (O convite por e-mail virou dormente — ver
a seção de autenticação.)

### 2. A tela do lobby nunca foi aberta
Compila e o bundle constrói; ninguém viu a lista, o formulário de criar, o campo
de convite nem o botão "Cheio" num navegador. Roteiro de 8 passos no doc.

### 3. Nada do gerenciamento foi executado
Renomear, mudar lotação, alternar visibilidade, tirar membro, cancelar convite,
recusar convite, arquivar, **definir papel** e **passar a propriedade** nunca
rodaram contra um Supabase real. Três pontos merecem atenção na primeira
verificação:

- `ejectFrom()` nunca desconectou ninguém — a sequência "perde acesso → é
  desconectado → reconecta → portão recusa com o motivo certo" é raciocínio,
  não observação. É o comportamento mais visível da entrega.
- `transferWorldOwnership()` faz três escritas sem transação. A ordem foi
  escolhida para que nenhuma falha parcial deixe o mundo sem administrador, mas
  isso não foi provado interrompendo no meio.
- **A validação de papel não foi alcançada em teste.** Mandar um papel
  inventado é recusado, mas por `invalid-token` — a autenticação vem antes da
  validação de entrada, então o `check` de `'host' | 'member'` nunca executou.

### 4. Duplo clique em "Criar" — resolvido no client, ainda não no servidor
`once()` em `net/request.ts` deduplica por chave e **não** depende de render do
React (verificado: dois `create` simultâneos = 1 requisição). Mas a proteção de
verdade seria no servidor: dois sockets, ou duas abas, ainda criariam dois
mundos com o mesmo nome. Não há unicidade de `places.name` por empresa.

### 5. Mundo com cenário trocado por baixo
O cliente monta o mapa a partir do cenário que o lobby informou. Se o
`scenario_id` do mundo mudar entre listar e entrar, o mapa carregado divergiria
do que o servidor usa. Não tratado e não medido (janela minúscula, consequência
feia).

### 6. Sem UI para desfazer
**Resolvido para o mundo**: remover membro, cancelar convite, mudar lotação e
visibilidade, renomear, arquivar, definir papel e passar a propriedade agora são
tela. Continua só por SQL: **desarquivar** um mundo e administrar a **empresa**
(convite de empresa, `memberships.role`, suspender membro). `expires_at` de
convite é respeitado na leitura, mas ninguém limpa linhas velhas.

### 6b. Nada audita papel nem propriedade
Não há registro de quem promoveu quem, nem de quando um mundo mudou de dono —
só o `console.log`, que morre no restart. `voice_token_grants` tem trilha; isto
não. Vale uma tabela se mais de uma pessoa administrar o mesmo mundo.

### 7. `listWorldsFor` com volume
Faz 4 consultas e filtra em JS. Nunca foi medido com muitos mundos ou muitas
empresas.

---

# Autenticação e controle de acesso — 2026-08-20

Ver [`docs/features/autenticacao-e-acesso.md`](docs/features/autenticacao-e-acesso.md).

**Estado:** funcionando contra um Supabase real. O login e a entrada num mundo
deixaram de ser teoria; o **acesso por ID entre duas contas** é o que falta
confirmar.

## Já verificado

### Contra um Supabase real — 2026-08-20

Confirmado pelo usuário ("agora está pronto") depois de aplicar `0001`→`0008` e o
`seed.sql`. **Eu não vi a tela** — o que segue é o que essa confirmação
necessariamente exercitou, não o que foi conferido item por item:

- ✅ Boot com Supabase configurado e a sonda limpa: sem `42501` (privilégio), sem
  `42P01` (schema) e com `characters` populada.
- ✅ **Criar conta / entrar com e-mail e senha, sem confirmação.** O `signUp`
  devolvendo sessão na hora é o que tira a tela do login — se "Confirm email"
  estivesse ligado, teria parado aí.
- ✅ **`verifyAccessToken` no caminho de SUCESSO.** Até aqui só o caminho de
  recusa havia rodado (todo teste anterior parava em `invalid-token`).
- ✅ **`ensureProfile` criando perfil de verdade** — era exatamente o que estava
  quebrado, por três causas em série (ver "Corrigido" abaixo).
- ✅ `lobby:list` inteiro: `buildState`, `listWorldsFor`, `listPendingInvites` e o
  `myId` novo.
- ✅ O portão do `join` no caminho de sucesso, até `getWorld`.

### Antes, por lógica e caminho de recusa

- ✅ `npm run typecheck` (server + client) e `npm run build` limpos.
- ✅ Modo anônimo (sem Supabase) intacto: `smoke-test.mts` 14/14 depois de o
  `join` perder a identidade e de o mundo passar a ser por local.
- ✅ **Fail-closed na autenticação**, com Supabase apontando para porta fechada:
  socket sem token leva `auth-required`, token inválido leva `invalid-token`, e o
  recusado **não** anda, **não** fala, **não** obtém token de voz e **não**
  aparece para outros sockets. A recusa não trava o socket.
- ✅ **Isolamento por local**: dois locais no mesmo cenário são mundos distintos,
  o chat é separado, e as salas de LiveKit são distintas e sanitizadas. A chave
  sintética do modo sem banco (`scenario-*`) não colide com uuid de local.
- ✅ `world.size` acompanha entrada e saída (base da lotação).
- ✅ Empiricamente: `node --env-file` **não** sobrepõe variável já exportada no
  shell (o shell ganha) — causa de "está no `.env` e não funciona".

## Corrigido no primeiro uso real (2026-08-20)

**`profiles.id` sem default — ninguém conseguia entrar.** `profiles` era a única
das sete tabelas com `uuid primary key` **sem** `default gen_random_uuid()`. Era
correto quando o id vinha do cliente (o antigo `shared/src/identity.ts`); quando
a identidade passou para o Supabase Auth, esse arquivo foi removido e a coluna
ficou sem ninguém para preenchê-la. Efeito: todo insert de perfil falhava com
`null value in column "id"`, e como `ensureProfile`/`findOrCreateProfile` são
fail-soft, o erro virava `null`. Corrigido por
`db/migrations/0007_profile_id_default.sql`.

**`service_role` sem privilégio de tabela (`42501`).** Nenhuma migração nossa
revoga nada — o grant nunca existiu. O Supabase concede acesso às tabelas de
`public` por *default privileges*, e elas são registradas **por papel que cria o
objeto**: schema aplicado por outro papel que não o `postgres` cria tabela sem
grant para o `service_role`. E `BYPASSRLS` não dispensa privilégio de tabela —
são dois controles distintos. Corrigido por `db/migrations/0008_grants.sql`
(só `service_role`, por menor privilégio: o navegador não fala com o banco).

**Catálogo vazio (`23503`).** `profiles.character_id` referencia `characters`,
populada pelo `seed.sql` — não por migração. Sem ele, criar perfil falha com
foreign key, e a mensagem fala de constraint, não de seed. Agravante descoberto
na prática: o SQL Editor do Supabase roda o script numa **transação única**, então
um erro em qualquer statement do seed desfaz tudo o que já havia passado — o
catálogo fica vazio para quem jura ter rodado o seed.

Dúvida de desenho, registrada: `characters`/`scenarios`/`audio_zones` são
**catálogo obrigatório** (espelho de `shared/`), não dado de demonstração —
provavelmente deveriam ser migração, deixando no `seed.sql` só a empresa e os
locais de demo. Não mexi agora para não trocar a convenção de `db/` no meio de
uma depuração.

**O boot não sondava nada.** Agora faz um HEAD em `profiles` no start e nomeia os
erros que custaram depuração: `42501` (falta a `0008`), `42P01` (schema não
aplicado) e `characters` vazia (falta o `seed.sql`). Fire-and-forget, não bloqueia
o boot.

**A mensagem mentia, e foi isso que custou o tempo.** O `whoAmI` do lobby
devolvia `LobbyIdentity | null`, e **três** causas distintas — sem token, token
recusado e falha do banco no perfil — colapsavam no mesmo `null`, que o `handle`
traduzia para `invalid-token`: *"Sua sessão expirou. Entre de novo."* A sessão
estava perfeita; o problema era schema. Agora `whoAmI` devolve o motivo
(`auth-required` / `invalid-token` / `error`) e loga explicitamente que token
válido + perfil nulo é falha de **banco**, não de sessão. O portão do `join` em
`handlers.ts` já tratava certo (`deny('error')`) — a confusão era só no lobby.

**O boot não conferia a forma do `SUPABASE_URL`.** Uma URL definida mas
apontando para um site devolve HTML, e o erro do supabase-js
(`Unexpected token '<', "<!DOCTYPE "...`) não menciona configuração. Agora o boot
avisa quando a URL não tem forma de endpoint de projeto (host, caminho), sem
imprimir o ref nem a key — e lembra que **variável exportada no shell sobrepõe o
`.env`**, que é a razão de "está no `.env` e não funciona". Verificado
empiricamente: `node --env-file` não substitui o que já está no ambiente.

**`verifyAccessToken` engolia falha de infraestrutura.** Não logava nada por
design (token vencido em reconexão é rotina e viraria ruído). Mas erro que não é
401/403 — URL do projeto errada, projeto diferente do que o navegador usa,
Supabase fora do ar — desaparecia como "token inválido". Agora esse caso loga a
mensagem do erro (nunca o token) e sugere conferir `SUPABASE_URL` contra o
`VITE_SUPABASE_URL` do client.

---

## Falta verificar (em ordem de importância)

### 1. Acesso por ID entre duas contas — o coração da entrega
`addMemberToWorld` **ainda não foi confirmado**. São duas escritas em sequência
sem transação (membership → `place_members`) mais a leitura que evita rebaixar o
dono. Roteiro: segunda conta em janela anônima → copiar o ID dela → "Adicionar" no
seu mundo → o mundo tem que aparecer no lobby dela **sem passo de aceite**.
Conferir no banco uma linha nova em `memberships` e uma em `place_members`.

### 2. Não rebaixar o dono
Colar o **próprio** ID no seu mundo tem de manter `memberships.role = 'owner'`.
`addMemberToWorld` lê antes de escrever exatamente para isso (um `upsert` com
`role: 'guest'` rebaixaria), e o tratamento nunca foi provocado. É a falha mais
feia possível: o dono perde a empresa.

### 3. ID malformado × ID inexistente
Botão desabilitado para texto torto (`isProfileId` no client) e **`not-found`**,
não `error`, para uuid válido que não é de ninguém. A distinção existe no
servidor e não foi exercitada.

### 4. `myId` na tela e o botão de copiar
`navigator.clipboard` falha em contexto não seguro (HTTP fora de localhost). O
`catch` mostra "selecione e copie à mão" e nunca rodou.

### 5. `capacity`, local restrito e isolamento entre empresas
Nada disso foi exercitado com gente de verdade. Roteiro nos passos 10 a 12 do doc
da feature.

### 6. `no-invite` é um nome que mente
Continua sendo o motivo de recusa de quem não tem acesso, embora não exista mais
convite. Trocar o código toca `shared`, server e client por uma mensagem — dívida
pequena, registrada de propósito.

### 7. Renovação de token em sessão longa
O `auth` do socket é função justamente para a reconexão pegar o token renovado.
Não observado em sessão de mais de 1h. Se estiver errado, a falha aparece só
depois de uma hora, como `invalid-token` no meio da sessão.

### 8. Sessão morta em outra aba
`onAuthStateChange` deveria devolver a pessoa para a tela de login quando a sessão
é revogada no dashboard. Não testado.

### 9. Convite por e-mail: dormente, e é dívida
Continua **inteiro** — tabela `invites`, `inviteToWorld`, `acceptInvite`,
`acceptInviteById`, eventos `lobby:accept`/`lobby:decline`/`lobby:revokeInvite`,
tipos `PendingInvite`/`SentInvite` e a UI que os mostra (condicionada a lista não
vazia, então nunca aparece). Nada cria linha nova.

É decisão, não esquecimento: alcançar **quem ainda não tem conta** só é possível
por e-mail, e é o caminho de volta quando houver domínio. Mas é código que
compila, ninguém executa e que vai envelhecer sem ninguém notar — se ficar claro
que o e-mail não volta, tem de ser deletado, não mantido "por garantia".

O que **saiu de verdade** foi o aceite automático no portão (`handlers.ts`): era
ele o furo que a confirmação de e-mail sustentava, não a tabela.

### 10. Catálogo como seed, e não como migração
`characters`/`scenarios`/`audio_zones` são **catálogo obrigatório** (espelho de
`shared/`) e vivem no `seed.sql`. Sem eles nenhum perfil pode existir, e o SQL
Editor do Supabase desfaz o seed inteiro se um statement falhar — foi assim que o
catálogo ficou vazio "tendo rodado o seed". Provavelmente deveriam virar migração,
deixando no seed só a empresa e os locais de demo. Não mexido para não trocar a
convenção de `db/` no meio de uma depuração.

### 11. Tamanho do bundle inicial
~557 kB (176 kB gzip) no chunk principal com o SDK do Supabase importado de forma
estática (o `App` precisa dele no boot para restaurar a sessão). Não medi o
antes/depois. O chunk de 6 MB do Pixi continua dominante.

### 12. `.env.example` — quase-acidente de segredo, e ainda sem as variáveis
**2026-08-20, achado na varredura de fechamento:** o `.env.example` da árvore de
trabalho continha **valores reais**, incluindo uma `SUPABASE_SERVICE_ROLE_KEY`.
O arquivo é versionado, então isso teria virado vazamento no primeiro commit.

Nada vazou: a versão em `HEAD` não tem nenhum JWT, nenhum commit do histórico
introduziu um, e nada estava staged. **A chave não precisou de rotação.** O
`.githooks/pre-commit` (ativo, `core.hooksPath=.githooks`) também teria barrado —
ele isenta `.env.example` **por nome**, o que é correto, mas a regra de conteúdo
para JWT pega o valor. A rede funcionou; o que faltou foi não ter posto o valor
ali.

Pendente, e é o usuário que executa (as regras `deny` do `.claude/settings.json`
impedem a mim ler e escrever esse arquivo): restaurar o `.env.example` para
`HEAD` e acrescentar **só os nomes** das cinco variáveis do Supabase — que
continuam faltando lá (`HEAD` só tem as quatro do LiveKit). Comando no
fechamento da sessão.

Vale decidir se o padrão `deny` abre exceção para `.env.example`, que por
definição não tem valores — a impossibilidade de eu inspecioná-lo é justamente o
que deixou o valor real passar tanto tempo ali.

---

# Persistência (Supabase) — 2026-08-20

Ver [`docs/features/persistencia-supabase.md`](docs/features/persistencia-supabase.md).

## Já verificado

- ✅ `npm run typecheck` (server + client) limpo.
- ✅ `smoke-test.mts`: as 14 checagens do protocolo passam com o `join`
  assíncrono — inclusive `join` sem `profileId` (cliente antigo).
- ✅ Boot sem `SUPABASE_*`: loga `persistência desativada` e o app funciona
  igual (nenhuma chamada ao banco acontece).
- ✅ `join` duplo no mesmo socket recusado (mundo não ganha player extra) —
  teste de socket real. (O `profileId` no `join` foi removido na entrega de
  autenticação; a identidade agora vem da conta.)
- ✅ `World.validResume()` contra o mapa real do Estúdio: chão livre restaura,
  cadeira+sentado restaura sentado, cadeira sem sentar cai no spawn, parede cai
  no spawn, fora do mapa/`NaN` caem no spawn. E `hydrateChat()` é idempotente.
- ✅ `World.zoneKeyAt()` (atividade): bate com `audioZoneAt()` do cliente nos
  864 tiles do Estúdio, acerta as bordas dos dois retângulos e não vaza para
  fora; área aberta devolve `null`.
- ✅ Evento `share` repetido e com payload inválido não derruba o servidor;
  travessia das duas zonas a 15 msg/s seguida de chat mantém o socket saudável.
  Nenhum erro no log do servidor.

## Falta verificar (em ordem de importância)

### 1. O SQL foi executado — e cobrou três correções
**Resolvido em 2026-08-20.** `0001`→`0008` e o `seed.sql` foram aplicados contra um
projeto real. A primeira aplicação cobrou exatamente o que este item previa:
`profiles.id` sem default (corrigido pela `0007`), `service_role` sem privilégio
de tabela (`0008`) e catálogo vazio porque o SQL Editor desfaz o seed inteiro
quando um statement falha. Detalhes na seção de autenticação.

Continua **não** verificado no SQL: as 3 views, o `security_invoker` e as
políticas de RLS — ver os itens 3 e 4.

### 2. O ciclo completo de "voltar onde parou" e a atividade da sessão
Nada do caminho com banco foi exercitado de verdade: upsert de perfil, leitura
de `presence_state`, gravação com throttle, `sessions` abrindo e fechando,
histórico de chat hidratando após restart. E, do bloco de atividade:
`zone_visits` abrindo/fechando (a **corrente de promessas** nunca foi observada
gravando — é o ponto mais delicado: quem atravessa a copa correndo troca de sala
antes de a visita anterior ter gravado), `screen_shares`, `voice_token_grants` e
`sessions.user_agent`. O roteiro está em "Como testar" no doc da feature
(passos 2 a 9).

### 3. RLS e as views
As 3 views (`v_zone_occupancy`, `v_place_activity`, `v_screen_share_summary`)
nunca foram executadas. Atenção ao `security_invoker = true`: sem ele a view
roda com os direitos do dono e **fura o RLS** das tabelas de baixo. Confira com
a query do `db/README.md` depois de aplicar.

Nenhuma política foi exercitada — todas dependem de `auth.uid()`, e não existe
login ainda. Hoje o efeito prático é "navegador não lê nada", que é o desejado,
mas isso não valida as políticas para quando o login chegar. Atenção especial à
recursão em `memberships` (é o motivo do `security definer`).

### 4. `.env.example`
Ver o item correspondente na seção de autenticação — o arquivo segue barrado
pelas regras `deny`, e agora faltam cinco nomes, não três. Vale rever se o
padrão deveria abrir exceção para `.env.example`, que por definição não tem
valores.

### 5. Schema sem uso no código
`invites`, `place_members` e `profiles.auth_user_id` **passaram a ser usados**
na entrega de autenticação. Continua sem leitor: `profiles.last_seen_at` (só
escrita) e `memberships.invited_by`. `places.visibility = 'restricted'` também não é respeitado: o servidor
ainda tem um mundo por cenário, não por local. É esperado no MVP, mas é dívida
registrada, não feature pronta.

### 6. Compartilhamento nos primeiros instantes da sessão
`openSession` é assíncrono, e o evento `share` só é registrado depois que a
linha de sessão existe. Um compartilhamento iniciado nos ~100ms seguintes ao
join não gera linha em `screen_shares`. Aceito (é histórico, não estado), mas
não medido.

### 7. Histórico de chat sai sem cor
`senderId` de mensagem vinda do banco é o `profile_id`, e o roster do cliente é
indexado por `socket.id` — então mensagem antiga aparece na cor padrão.
Consertar exige expor `profileId` no roster.

---

# Pendências do cenário Ruínas

O que **não foi verificado** na montagem do cenário Ruínas, e itens herdados das
mudanças anteriores. Atualizado em 2026-08-18.

## Já verificado (para referência)

- ✅ Typecheck (server + client) limpo.
- ✅ Servidor: join no cenário `ruins` ecoa o id correto, spawn na praça
  central (400, 592), clamp de movimento em 928x1120 (teste de socket real).
- ✅ Grade de colisão: 35 linhas x 29 colunas exatas, flood fill a partir do
  spawn alcança 396/401 células livres — as 5 restantes são bolsões
  decorativos de grama ao redor do altar, inalcançáveis também na cena
  original.
- ✅ Correções já aplicadas após o debug visual: canto sudoeste (cols 1-2,
  linhas 24-30) e célula (22,6) marcados como sólidos (eram fundo cinza);
  tronco da árvore nordeste reduzido a 1 tile para não selar a área atrás dela.
- ✅ Posições dos overlays: 17 de 20 instâncias localizadas por template
  matching (erro médio < 12/canal); estátua, estela RESH e tumba extraídas
  por chroma-key com retângulo conferido visualmente.

## Falta verificar (em ordem de importância)

### 1. Visual in-game do cenário Ruínas
Nunca foi aberto no navegador. Conferir:
- Se o chão (`ground.png`) renderiza nítido (scale mode nearest) e alinhado
  com a grade de colisão.
- Se os 20 props sobrepostos (árvores, estátua, pilares, lanternas, lápides,
  altar, tumba) estão **pixel-perfeitos** sobre a arte do chão — qualquer
  desalinhamento aparece como "fantasma"/borda dupla no sprite.
- Se o y-sort funciona: player deve passar **por trás** de árvores, estátua e
  monumentos e **na frente** deles quando estiver ao sul.

### 2. Colisão fina nas bordas (transcrição manual)
A grade foi transcrita visualmente da imagem — pode haver célula errada em ±1
nas bordas. Conferir andando no jogo, com atenção a:
- **Escadas**: terraço oeste → pátio (cols 3-6, linhas 15-17), plaza da
  estátua (7,11-12), altar (16,4-6), sala leste → cemitério (25-26,16-18),
  corredor sudeste (20-22,20-22), sala sul (5-6,27-30).
- **Lado da árvore nordeste** (21,7): liberado para dar passagem — conferir se
  não permite "pisar" no tronco.
- **Vaso do canto da sala sul** (~4.5, 28.5): pode sobrepor o pé da escada.
- **Coluna vertical (9,4)-(9,8)** entre o terraço nordeste e a plaza da
  estátua: marcada como parede, mas pode ser uma escada na cena original
  (passagem bloqueada que talvez devesse existir).
- **Beiral da fonte/poço** (célula (5,23)): arco noroeste do poço invade um
  pixel a célula livre.
- Usar o mapa de debug: `docs/ruins-colisao-debug.png` (vermelho = sólido,
  verde = livre, azul = spawn).

### 3. Multiplayer no cenário Ruínas
A arquitetura é a mesma dos outros mundos (testada via socket), mas não foi
testado com 2+ navegadores dentro do `ruins`: voz por proximidade, chat,
isolamento em relação a Praça/Escritório.

### 4. Cenário Escritório — visual in-game
Herdado da tarefa anterior: o renderer procedural foi restaurado do git e o
typecheck passou, mas ninguém abriu o Escritório no navegador desde a
restauração (colisão, spawn no lounge, visual).

### 5. Zoom sobre o bitmap grande
O zoom da câmera (0.5x-2.5x) nunca foi testado sobre o chão de imagem única
das Ruínas (928x1120). Conferir nitidez ao aproximar e desempenho ao afastar.

## Observações menores (não bloqueiam)

- `client/public/tiles/paths.png` existe mas nunca é carregado (sobra da
  Praça, pré-existente).
- Os 5 props altos que o matcher não encontrou individualmente (2ª lanterna
  sobre muro, pilares encostados em paredes) ficaram **sem overlay** — o
  player pode cobrir o topo deles ao passar por trás; todos ficam em locais de
  difícil sobreposição (adjacentes a paredes sólidas).
- Licença: Ruínas usa o pack CC0 do Cainos (sem restrição); a Praça continua
  com a restrição **não-comercial** do Sprout Lands (documentado no README).
- ~~As mudanças do cenário Ruínas ainda não foram commitadas~~ — **resolvido**:
  em 2026-08-20 o working tree estava limpo e os 17 arquivos de `ruins` estão
  versionados.
