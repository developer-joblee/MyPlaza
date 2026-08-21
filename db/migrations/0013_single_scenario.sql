-- =============================================================================
-- toGether / MyPlaza — 0013_single_scenario
-- Um estilo de arte só: fica o **Estúdio** (Modern Interiors, by LimeZu).
--
-- Aplicação manual, depois de 0012 (ver `db/README.md`).
--
-- POR QUE: o projeto nasceu com quatro cenários de três packs diferentes
-- (`studio`, `office` procedural, `plaza`/Sprout Lands e `ruins`/Cainos). A
-- decisão foi ficar num estilo só, e os três saíram de `shared/src/scenarios.ts`
-- no mesmo commit desta migração. O banco NÃO acompanha sozinho: `places` tem FK
-- para `scenarios (id)`, e um mundo criado na Praça continuaria apontando para um
-- cenário que o código não conhece mais.
--
-- O QUE ISTO FAZ, E O QUE DELIBERADAMENTE NÃO FAZ:
--
-- 1. Repõe todo `place` para `studio`. **Não apaga mundo nenhum.** Apagar um
--    local levaria com ele sessões, chat, posições salvas e acessos (cascatas da
--    0001/0003) — destruição que uma migração não deve decidir no lugar de quem
--    usa. O mundo continua existindo, com o mesmo nome e os mesmos membros; só o
--    mapa passa a ser o do Estúdio.
--
--    Consequência de posição salva: o Estúdio (36x24) é MENOR que a Praça
--    (40x26) e que as Ruínas (58x70), então quem tinha parado fora dessa área,
--    ou em cima do que agora é parede, nasce no spawn. É o `validResume` de
--    `server/src/world.ts` fazendo o trabalho dele — a mesma proteção que existe
--    para quando se edita o ASCII de um mapa.
--
--    O NOME não é tocado: um mundo chamado "Praça" continua chamado "Praça". É
--    dado que a pessoa escreveu (ou que o seed escreveu por ela), e renomeá-lo
--    seria a migração inventando texto de interface. Renomeie pelo lobby se
--    incomodar; se o mundo era um dos locais de demonstração do seed e ninguém
--    usou, arquive-o (`archived_at`) em vez de apagar.
--
-- 2. Remove `office`, `plaza` e `ruins` do catálogo `scenarios`. As
--    `audio_zones` desses cenários vão junto pela cascata da 0003 — na prática
--    não havia nenhuma, porque só o Estúdio tem zonas.
--
-- Idempotente: rodar de novo não muda nada.
-- =============================================================================

-- 1. Nenhum local pode ficar apontando para cenário que vai sair.
update places
   set scenario_id = 'studio'
 where scenario_id <> 'studio';

-- 2. E agora o catálogo pode encolher. Sem `where` amarrado à lista de ids que
--    saíram: qualquer coisa que não seja `studio` é resíduo, inclusive de um
--    banco onde alguém inseriu um cenário à mão.
--
--    Se este delete falhar por FK, é sinal de que sobrou linha apontando para o
--    cenário antigo em alguma tabela nova — não force: descubra qual, porque o
--    passo 1 acima deixou de cobrir uma referência.
delete from scenarios where id <> 'studio';
