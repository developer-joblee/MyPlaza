# Banco de dados (Supabase)

Schema do toGether: empresas, perfis, acesso, locais, sessões, **posição onde a
pessoa parou** e chat. O detalhe de por quê cada decisão está em
[`docs/features/persistencia-supabase.md`](../docs/features/persistencia-supabase.md)
— aqui é só **como aplicar**.

## Aplicando à mão (é o fluxo de hoje)

No dashboard do Supabase → **SQL Editor** → New query, cole e rode **nesta
ordem**:

1. `migrations/0001_init.sql` — tabelas, índices, gatilhos
2. `migrations/0002_rls.sql` — Row Level Security e as funções de política
3. `migrations/0003_activity.sql` — atividade da sessão (zonas, tela, auditoria de token) e as views
4. `migrations/0004_access.sql` — lotação do local, índice de convite e `v_place_occupancy`
5. `migrations/0005_lobby.sql` — mundo com dono, empresa pessoal, convite por mundo
6. `migrations/0006_world_admin.sql` — arquivamento de mundo e views ignorando arquivado
7. `migrations/0007_profile_id_default.sql` — **`profiles.id` ganha default**.
   Sem ela, criar perfil falha e ninguém consegue entrar: a tela diz "sua sessão
   expirou", que não tem nada a ver com a causa. Se você aplicou o schema antes
   desta migração existir, **aplique-a agora**.
8. `migrations/0008_grants.sql` — **privilégios de tabela para o `service_role`**.
   Se o schema foi aplicado por um papel diferente do `postgres`, o `service_role`
   fica sem grant e tudo falha com `42501 permission denied`. `BYPASSRLS` **não**
   dispensa privilégio de tabela. Aplique se você já rodou o schema.

9. `migrations/0009_world_binding.sql` — **o vínculo com o mundo guarda o nome**.
   `presence_state` ganha `display_name` e `avatar_color`, e é isso que faz a
   tela de entrada parar de pedir o nome a cada login. **Obrigatória depois de
   atualizar o código**: o servidor passou a gravar essas colunas no mesmo upsert
   da posição, então sem elas o Postgres recusa a escrita inteira (`42703`) e a
   **posição salva também para de funcionar** — em silêncio, porque `db.ts` é
   fail-soft (o motivo aparece como `[db] savePosition` no log). Ver
   [Vínculo com o mundo](../docs/features/vinculo-com-o-mundo.md).

10. `migrations/0010_soundboard.sql` — **soundboard e tempo acumulado**.
    `profiles` ganha `presence_seconds`, entra a tabela `user_sounds`, a função
    `app_add_presence_seconds` e o **bucket privado `soundboard`** no Storage —
    o primeiro uso de Storage neste projeto. Obrigatória junto com o código do
    soundboard: sem ela o painel abre vazio e todo upload falha em silêncio
    (`db.ts` é fail-soft; o motivo aparece como `[db] insertUserSound` no log).
    Ver [Soundboard](../docs/features/soundboard.md).

    > O `insert into storage.buckets` exige privilégio no schema `storage`. No
    > SQL Editor do dashboard isso funciona; se você aplica migração por outro
    > papel e o insert falhar, crie o bucket **privado** chamado `soundboard` à
    > mão em *Storage → New bucket* — o resto da migração não depende dele.

> As migrações `0007` e `0008` corrigem defeitos que só aparecem contra um
> Supabase real, e **as duas são obrigatórias** para alguém conseguir entrar.
> Rode todas com o **mesmo papel** — as *default privileges* da `0008` valem para
> os objetos criados por quem as executou.

> **O SQL Editor do Supabase roda o script inteiro numa transação.** Um único
> statement com erro faz **rollback de tudo** — inclusive do que já tinha passado.
> É o jeito mais fácil de terminar com o catálogo vazio "tendo rodado o seed": o
> erro aparece, o resto desaparece. Depois de rodar o `seed.sql`, **confira**:
>
> ```sql
> select count(*) from characters;   -- 4
> select count(*) from scenarios;    -- 4
> select slug  from organizations;   -- inclui o seu SUPABASE_ORG_SLUG
> select count(*) from places;       -- 4 (um por cenário)
> ```
>
> Catálogo vazio faz criar perfil falhar com `23503` (foreign key de
> `profiles.character_id` → `characters`), e ninguém entra. O boot do servidor
> avisa quando `characters` está vazia.
11. `migrations/0011_soundboard_wav.sql` — **o bucket passa a aceitar `audio/wav`**.
    Necessária para quem aplicou a `0010` antes do corte automático de áudio
    existir: o `insert into storage.buckets` da `0010` é `on conflict do nothing`,
    então reaplicá-la **não** atualiza a whitelist de um bucket que já existe. Sem
    esta migração, subir um áudio que precisou ser cortado falha com
    `mime type audio/wav is not supported` no log do servidor. Quem aplica do zero
    roda as duas e fica igual.

12. `migrations/0012_soundboard_volume.sql` — **volume do soundboard no perfil**.
    `profiles` ganha `soundboard_volume` (0..100, default 70). Sem ela o painel
    mostra o slider mas o valor não sobrevive ao recarregar — o `db.ts` é
    fail-soft, então a falha aparece só como `[db] saveSoundboardVolume` no log.

13. `migrations/0013_single_scenario.sql` — **um cenário só: o Estúdio**.
    Os outros três (`office`, `plaza`, `ruins`) saíram do código quando o projeto
    ficou num estilo de arte só, e o banco não acompanha sozinho: `places` tem FK
    para `scenarios (id)`. A migração **repõe todo local para `studio`** (não
    apaga mundo nenhum — nome e membros ficam) e depois limpa o catálogo.
    Sem ela o servidor não quebra, mas avisa
    `[db] getPlaceById: cenário "plaza" não existe mais` a cada entrada nesse
    mundo, e o mapa carregado é o do Estúdio de todo jeito.

14. `migrations/0014_peer_audio_prefs.sql` — **volume por pessoa**. Entra a
    tabela `peer_audio_prefs`: quanto EU ouço a voz e os sons de soundboard de
    CADA pessoa (0..100 nos dois, default 100 = como era antes). Obrigatória
    junto com o código dessa feature: sem ela os sliders do menu de contexto
    funcionam **na sessão** e o valor não sobrevive ao F5 — em silêncio, porque o
    `db.ts` é fail-soft (o motivo aparece como `[db] savePeerAudioPref` no log).
    Ver [Volume por pessoa](../docs/features/volume-por-pessoa.md).

15. `seed.sql` — catálogo (personagens, cenários, zonas) + empresa e locais de demo

O passo 15 **não é opcional**: sem as linhas de `characters`, `scenarios` e
`audio_zones` os FKs de `profiles`, `places`, `sessions`, `presence_state` e
`zone_visits` não fecham, e o servidor falha em toda escrita.

Depois, no `.env` da raiz (nunca commitado):

```
# servidor
SUPABASE_URL=...              # Project Settings > API > Project URL
SUPABASE_SERVICE_ROLE_KEY=... # Project Settings > API > service_role  (SÓ no server)
SUPABASE_ORG_SLUG=demo        # slug da empresa criada no seed.sql

# navegador (login) — publicáveis por design, ver abaixo
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...    # Project Settings > API > anon (secret-scan:ignore — é publicável)
```

> As duas `VITE_*` vão para o bundle do navegador, e isso é correto aqui: a
> `anon key` é **publicável por projeto** e é o RLS que protege o banco (não há
> nenhuma política de escrita — ver `0002_rls.sql`). Definir as duas do servidor
> **sem** as duas do navegador deixa o app pedindo token que ninguém consegue
> obter: todo mundo leva `auth-required`.

> A `service_role` passa por cima do RLS. Ela vive **só** no servidor, do mesmo
> jeito que a `LIVEKIT_API_SECRET` — jamais em variável `VITE_*`, que vai para o
> bundle do navegador. Sem essas variáveis o app roda normalmente, só sem
> persistência (mesmo comportamento de "sem LiveKit, sem voz").

## Conferindo que pegou

```sql
-- 17 tabelas, todas com RLS ligada (a 16ª é `user_sounds`, da 0010; a 17ª é
-- `peer_audio_prefs`, da 0014)
select tablename, rowsecurity from pg_tables
where schemaname = 'public' order by tablename;

-- as 4 views precisam estar com security_invoker (senão furam o RLS)
select c.relname, c.reloptions from pg_class c
where c.relkind = 'v' and c.relnamespace = 'public'::regnamespace;

-- 4 locais, Estúdio como padrão
select p.slug, p.scenario_id, p.is_default
from places p join organizations o on o.id = p.organization_id
where o.slug = 'demo';
```

## Convenção de arquivos

Numerados (`0001_`, `0002_`, …) **desde já**, no formato que o Supabase CLI
espera. Quando o fluxo virar `supabase db push`, isto passa a ser
`supabase/migrations/` — é um `mv` mais o prefixo de timestamp, não um rewrite.

Regras enquanto é manual:

- **Nunca edite um arquivo já aplicado em produção.** Crie o próximo número.
  Um arquivo aplicado é história; editá-lo faz o banco divergir do repo sem
  ninguém perceber.
- Um assunto por arquivo, e o arquivo diz no topo o que faz e o que exige.
- Sem `down`: reverter no MVP é `drop` manual e reaplicar. Assumido de
  propósito — escrever `down` que ninguém testa dá falsa segurança.
- Migration e o código que depende dela vão **no mesmo commit** (por que não
  ficam em repo separado: ver "Decisões e por quê" no doc da feature).

## Pela UI, em vez de SQL

Com o [lobby](../docs/features/lobby.md), **criar mundo, convidar, remover
membro, cancelar convite, mudar lotação/visibilidade e arquivar mundo não
precisam mais de SQL** — tudo pela tela, para quem é dono do mundo.

O SQL abaixo continua valendo para o que ainda não tem UI: dar acesso à empresa
de demonstração do `seed.sql`, administrar a empresa (papéis, suspender membro),
**desarquivar** um mundo e inspecionar.

## Convidando a primeira pessoa

Com Supabase configurado, **login é obrigatório e convite é o único caminho de
entrada** — inclusive para você. Ninguém tem quem o convide, então o primeiro
convite entra pelo SQL Editor, **antes** do primeiro login:

```sql
insert into invites (organization_id, email, role)
select id, 'voce@empresa.com', 'owner'
from organizations where slug = 'demo';
```

Depois crie a conta na tela de login com esse mesmo e-mail: no primeiro `join` o
servidor acha o convite, cria a membership e marca o convite como aceito.

Convidar mais gente é a mesma linha com `'member'`. Conferir:

```sql
select o.slug, p.display_name, m.role, m.status, m.joined_at
from memberships m
join organizations o on o.id = m.organization_id
join profiles p on p.id = m.profile_id;

-- convites ainda não aceitos
select email, role, expires_at from invites where accepted_at is null;
```

> Nunca leia nem copie a coluna `token` de `invites`: ela é o segredo do link de
> convite. A busca no login é por e-mail, justamente para não precisar dela.

## Controlando o acesso a um local

```sql
-- no máximo 8 pessoas ao mesmo tempo neste local (null = sem limite)
update places set capacity = 8 where slug = 'studio';

-- passa a ser restrito: só quem estiver na lista entra
update places set visibility = 'restricted' where slug = 'studio';

-- ... e a lista
insert into place_members (place_id, profile_id, role)
select pl.id, p.id, 'host'
from places pl, profiles p
where pl.slug = 'studio' and p.display_name = 'Iago';

-- quem está dentro agora, e quantas vagas sobram
select * from v_place_occupancy;
```

O servidor recusa com `place-full` / `place-restricted`, e a tela de entrada
mostra o motivo. A lotação é contada **em memória** (quem está conectado
agora), não por `sessions` abertas — sessão que não fechou por queda de conexão
contaria gente que já saiu.

## Desarquivando um mundo

"Remover" no lobby é arquivar (`places.archived_at`), nunca `delete` — cinco
tabelas cascateiam de `places` e levariam o chat e a presença junto. Para voltar:

```sql
-- o que está arquivado
select name, scenario_id, archived_at from places where archived_at is not null;

-- desarquiva
update places set archived_at = null where id = '<uuid>';
```

Para apagar **de verdade**, ciente de que vão junto todas as mensagens, sessões,
posições salvas, visitas de sala e convites daquele mundo:

```sql
delete from places where id = '<uuid>';
```
