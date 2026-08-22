import type {
  AssignableWorldRole,
  ChatMessage,
  JoinDeniedReason,
  LobbyResult,
  PeerAudioMap,
  PeerAudioResult,
  SoundboardResult,
  PlayerState,
  VoiceTokenResponse,
  WorldPatch,
} from './types';
import type { Appearance } from './appearance';
import type { CharacterId, EmoteId } from './constants';
import type { FurnitureResult, PlacedFurniture } from './furniture';
import type { ScenarioId } from './scenarios';

export interface ServerToClientEvents {
  'world:snapshot': (players: PlayerState[], chat: ChatMessage[], scenarioId: ScenarioId) => void;
  /** alguém do mundo (inclusive você) disparou um emote — ver `player:emote` */
  'player:emoted': (id: string, emoteId: EmoteId) => void;
  /**
   * A camada de móveis dinâmicos deste mundo, logo após o `world:snapshot`.
   * `canEdit` diz se ESTE socket pode editar (administra o mundo; em modo
   * anônimo, todos podem — não há papel sem banco).
   */
  'furniture:snapshot': (items: PlacedFurniture[], canEdit: boolean) => void;
  /** um móvel entrou ou mudou de lugar (place e move chegam iguais) */
  'furniture:changed': (item: PlacedFurniture) => void;
  'furniture:removed': (id: string) => void;
  'player:joined': (player: PlayerState) => void;
  'player:left': (id: string) => void;
  'player:moved': (id: string, x: number, y: number) => void;
  'player:sat': (id: string, sitting: boolean) => void;
  'player:away': (id: string, away: boolean) => void;
  'chat:message': (msg: ChatMessage) => void;
  /**
   * Alguém te chamou enquanto você está ausente. Vai **só para o alvo** — não é
   * broadcast: chamado é entre duas pessoas, e o mundo inteiro não precisa saber
   * quem cutucou quem.
   *
   * Existe porque ausente desassina o áudio no SFU (`VoiceRoom.applySilence`):
   * quem está ausente não ouve ninguém chamando, nem colado no avatar. Este é o
   * único canal que atravessa esse silêncio.
   */
  'presence:nudged': (fromId: string, fromName: string) => void;
  /**
   * Alguém te **chamou** pelo menu de contexto (botão direito no seu boneco),
   * estando você presente. Vai **só para o alvo**, como o `presence:nudged`.
   *
   * `on` é o que faz o chamado ser um interruptor e não um disparo: `true`
   * acende o alerta e toca o "pin", `false` o apaga porque quem chamou desistiu.
   * Um evento com booleano em vez de dois eventos, seguindo o `away`.
   *
   * Por que não é o `presence:nudged`: aquele existe para atravessar o silêncio
   * de quem está ausente (o SFU nem entrega a voz), e por isso o servidor exige
   * `target.away`. Este é o oposto — a pessoa está na frente da tela, e o que se
   * quer dela é que **venha até aqui**. Mesma palavra em português, dois canais
   * com regra de aceitação inversa.
   */
  'presence:called': (fromId: string, fromName: string, on: boolean) => void;
  /**
   * O alvo **respondeu** ao seu chamado: `accepted` = clicou em "ir até" (e o
   * avatar dela já está vindo), `false` = fechou o alerta.
   *
   * Vai só para quem chamou, e existe por um motivo de honestidade da interface:
   * sem ele o item do menu ficaria "pressionado" apontando para um alerta que a
   * outra pessoa já tirou da tela, e o clique seguinte cancelaria algo que não
   * existe mais. Não é sonda de presença — quem responde escolheu responder.
   */
  'presence:callAnswered': (byId: string, byName: string, accepted: boolean) => void;
  /**
   * A **booble** desta pessoa mudou (`null` = saiu de todas). Vai para o mundo
   * inteiro, incluindo quem mudou: o id da booble é cunhado no servidor, então
   * não há atualização otimista possível no cliente — e como todo mundo desenha
   * a pastilha no avatar e o selo na lista, todo mundo precisa saber.
   *
   * Um evento por player que mudou. Entrar numa booble pode mudar dois (você e
   * quem você chamou, quando ela nasce) ou três (mais quem ficou sozinho na
   * booble que você abandonou, e por isso ela se dissolveu).
   */
  'player:booble': (id: string, boobleId: string | null) => void;
  /**
   * Alguém perto de você tocou um som do soundboard dela.
   *
   * Vai **só para quem pode ouvir** — o servidor filtra pelos destinatários
   * (perto, na mesma zona, ou na mesma booble) em vez de difundir para o mundo
   * e deixar o cliente decidir. Difundir mandaria o evento para gente que não
   * deveria nem saber que aconteceu, e um cliente adulterado ouviria o mapa
   * inteiro.
   *
   * `url` é assinada e temporária; a identidade estável é o `soundId`, que é a
   * chave do cache de áudio do cliente. Quem recebe aplica o volume pela MESMA
   * função da voz (`audioVolumeFor`), então o som respeita parede e booble sem
   * uma segunda regra de audibilidade.
   */
  'soundboard:played': (
    fromId: string,
    fromName: string,
    soundId: string,
    url: string,
  ) => void;
  /**
   * O MEU mapa de volume por pessoa, chaveado por `socket.id`.
   *
   * Sempre **parcial**, e o cliente faz merge: quem não vem no mapa fica no
   * default (cheio). Chega em dois momentos, os dois no join — nunca por
   * difusão, porque este mapa é meu e de mais ninguém:
   *
   * 1. **no meu join**, com todos os presentes que eu já ajustei alguma vez;
   * 2. **quando alguém entra** que eu já tinha ajustado, com uma entrada só —
   *    é o que faz o ajuste sobreviver ao F5 da outra pessoa, já que o
   *    `socket.id` dela mudou e a chave antiga morreu.
   *
   * Sem Supabase este evento simplesmente não vem, e os sliders valem só na
   * sessão. Ver `docs/features/volume-por-pessoa.md`.
   */
  'audio:prefs': (prefs: PeerAudioMap) => void;
  /**
   * A entrada foi recusada e o `world:snapshot` não vem. O cliente volta para a
   * tela de entrada com o motivo — sem isto ele ficaria esperando para sempre.
   */
  'join:denied': (reason: JoinDeniedReason) => void;
}

export interface ClientToServerEvents {
  /**
   * O access token renovado pelo SDK do Supabase, para um socket que **já está
   * conectado**.
   *
   * Existe porque `socket.handshake.auth` é fotografado na conexão e nunca
   * muda: a função `auth` do cliente é reavaliada a cada tentativa de conexão,
   * e um socket que não cai não tem tentativa nenhuma. O token vence em ~1h e o
   * SDK o renova em background — sem este evento, o servidor seguia validando a
   * cópia velha e recusava toda operação por ack com `invalid-token`, o que a
   * tela mostra como "sua sessão expirou" numa sessão viva.
   *
   * **Sem ack**, e perder o evento não perde nada: com o socket caído o cliente
   * não envia (`fire()` devolve `false`), e a reconexão leva o token novo no
   * handshake. O servidor guarda só o que verifica, e nunca aceita o token de
   * outra conta — um socket não troca de identidade no meio da vida.
   *
   * Não é canal de login: quem autentica a conexão continua sendo o handshake.
   */
  'auth:token': (token: string) => void;

  /**
   * Entra no mundo. `character` é opcional: cliente antigo cai no padrão.
   *
   * A IDENTIDADE não vem por aqui. Quando há banco, ela sai do token de acesso
   * no handshake do socket (`socket.handshake.auth.token`), verificado no
   * servidor — um cliente não pode dizer quem é. Nome, cor e personagem são só
   * a escolha da tela de entrada, e sobrescrevem o perfil.
   *
   * Pode ser recusado: ver `join:denied`.
   */
  join: (
    name: string,
    color: number,
    scenarioId?: ScenarioId,
    /**
     * LEGADO, mantido na posição por compatibilidade de assinatura: cliente
     * antigo (ou payload sem `appearance`) cai em
     * `LEGACY_CHARACTER_APPEARANCE[character]`. Cliente novo manda `undefined`
     * aqui e a aparência real no 6º argumento.
     */
    character?: CharacterId,
    /**
     * Em QUAL mundo entrar (`places.id`), escolhido no lobby.
     *
     * Obrigatório quando o servidor exige login: é o que substitui "derivar o
     * local a partir do cenário dentro de uma empresa fixa". O `scenarioId`
     * acima passa a ser só a aposta do cliente sobre qual mapa carregar — quem
     * decide é o mundo, e o servidor devolve o valor real no `world:snapshot`.
     */
    worldId?: string,
    /** a aparência por camadas; validada por `isAppearance` no servidor */
    appearance?: Appearance,
  ) => void;
  move: (x: number, y: number) => void;
  /**
   * Sentar ou levantar. O servidor confere se o jogador está de fato num tile
   * de cadeira sentável antes de aceitar `true` — um cliente adulterado não
   * senta no meio do corredor.
   */
  sit: (sitting: boolean) => void;
  /** Ficar ausente ou voltar. Sem validação: é só intenção do usuário. */
  away: (away: boolean) => void;
  /**
   * Editor de móveis — só quem pode editar (ver `furniture:snapshot`). Tudo por
   * ack com `FurnitureResult`; o efeito volta como broadcast
   * (`furniture:changed`/`removed`) para o mundo INTEIRO, inclusive quem pediu.
   * O servidor valida footprint contra o mapa estático e os outros móveis.
   */
  'furniture:place': (
    furnitureId: string,
    tileX: number,
    tileY: number,
    rotation: number,
    ack: (res: FurnitureResult) => void,
  ) => void;
  'furniture:move': (
    id: string,
    tileX: number,
    tileY: number,
    rotation: number,
    ack: (res: FurnitureResult) => void,
  ) => void;
  'furniture:remove': (id: string, ack: (res: FurnitureResult) => void) => void;
  /**
   * Dispara um emote (reação sobre a cabeça). O servidor valida o id e impõe
   * `EMOTE_COOLDOWN_MS` por socket, recusando em silêncio — o efeito volta pelo
   * broadcast `player:emoted`, para TODOS do mundo, inclusive quem disparou
   * (caminho único de render: o emissor desenha o mesmo evento que os outros).
   */
  'player:emote': (emoteId: string) => void;
  /**
   * Comecei / parei de compartilhar a tela.
   *
   * O servidor não repassa isto a ninguém: quem descobre a tela de alguém é o
   * LiveKit, pela faixa publicada. Serve para o servidor poder **registrar** o
   * compartilhamento (tabela `screen_shares`) — sem este evento ele não teria
   * como saber, porque a mídia nunca passa por ele.
   */
  share: (sharing: boolean) => void;
  'chat:send': (text: string) => void;
  /**
   * Chama alguém que está ausente ("toc-toc"). Sem ack, como os outros eventos
   * de mundo: o efeito acontece na tela da outra pessoa, não aqui.
   *
   * O servidor recusa em silêncio quando o alvo não está no mesmo mundo, quando
   * ele **não** está ausente, ou quando o cooldown (`NUDGE_COOLDOWN_MS`) ainda
   * corre — recusar calado é de propósito: a resposta a "consegui cutucar?" não
   * deve virar sonda de presença.
   */
  'presence:nudge': (targetId: string) => void;
  /**
   * **Chama** alguém que está presente, pelo menu de contexto do avatar: acende
   * (`on: true`) ou apaga (`on: false`) o alerta na tela dela. Sem ack, como os
   * outros eventos de mundo — o efeito acontece na tela da outra pessoa.
   *
   * Recusas, todas **em silêncio** (a resposta a "consegui chamar?" não deve
   * virar sonda de presença, mesma razão do `presence:nudge`): alvo fora do meu
   * mundo, alvo inexistente ou vazio, alvo sendo eu mesmo, alvo **ausente** (aí
   * o canal é o `presence:nudge`, com o "toc-toc") e, só para `on: true`,
   * cooldown por par ainda correndo (`CALL_COOLDOWN_MS`).
   *
   * `on: false` **não** passa pelo cooldown nem pela guarda de ausência, de
   * propósito: desistir de um chamado é limpeza. Com cooldown, o botão ficaria
   * preso pressionado; barrando por ausência, um alvo que ficasse ausente com o
   * chamado no ar prenderia o alerta na tela dele para sempre.
   */
  'presence:call': (targetId: string, on: boolean) => void;
  /**
   * Responde ao chamado de `fromId`: `accepted` = "ir até", `false` = fechei.
   *
   * O servidor é só relay aqui — ele **não guarda** quem chamou quem, então não
   * tem como conferir se o chamado existia. Mentir custa o quê: fazer o botão
   * de outra pessoa despressionar. É menos dano do que um registro de chamados
   * no servidor precisaria de manutenção para evitar.
   */
  'presence:callAnswer': (fromId: string, accepted: boolean) => void;
  /**
   * Entra na booble desta pessoa, criando uma com vocês dois se ela ainda não
   * tiver nenhuma. Um evento só para os três casos (criar, entrar numa
   * existente, trocar da minha para a dela), porque do ponto de vista de quem
   * clica é sempre a mesma intenção: "quero conversar com essa pessoa".
   *
   * Sem ack, como os outros eventos de mundo: o efeito volta como
   * `player:booble`. As recusas são **em silêncio**, e são estas — alvo fora do
   * mundo, alvo inexistente, alvo sendo eu mesmo, alvo (ou eu) ausente, alvo
   * longe demais (`BOOBLE_JOIN_RADIUS`), alvo em OUTRA zona de áudio, ou booble
   * já cheia (`BOOBLE_MAX_MEMBERS`).
   *
   * Entrar exige mesma zona, mas **permanecer não** — é assimétrico de
   * propósito. Se dava para entrar atravessando a parede, quem está fora de uma
   * sala fechada poderia puxar quem está dentro, e some a promessa "para ouvir,
   * precisa entrar" que é a razão de existir das zonas. Formada a booble, ela
   * atravessa a porta junto com as pessoas.
   */
  'booble:join': (targetId: string) => void;
  /**
   * Sai da minha booble. Sem argumento: só se sai da própria, e o servidor já
   * sabe qual é. Se sobrar uma pessoa só, ela também sai — booble de um não
   * prioriza nada, apenas baixaria a sala inteira para quem ficou.
   */
  'booble:leave': () => void;
  /**
   * Pede credenciais de voz. Só por ack — sem payload, para o cliente não
   * poder influenciar sala nem identidade (ambas vêm do socket no servidor).
   */
  'voice:token': (ack: (res: VoiceTokenResponse) => void) => void;

  // --------------------------------------------------------------- lobby
  //
  // Tudo por ack, e toda resposta de sucesso traz o estado novo inteiro: são
  // operações raras (uma por clique) e devolver o estado evita a dança de
  // "escreve, depois lista de novo" com uma janela no meio em que a tela mente.
  //
  // Nenhum destes eventos aceita identidade no payload: quem está pedindo sai
  // do token verificado no handshake, igual ao `join`.

  /** Meus mundos e meus convites pendentes. */
  'lobby:list': (ack: (res: LobbyResult) => void) => void;

  /**
   * Cria um mundo. Quem não pertence a nenhuma empresa ganha uma pessoal na
   * primeira vez (ver `0005_lobby.sql`).
   */
  'lobby:create': (
    name: string,
    scenarioId: ScenarioId,
    capacity: number | null,
    ack: (res: LobbyResult) => void,
  ) => void;

  /**
   * Dá acesso a UM mundo para quem já tem conta, pelo **ID** dela. Só quem
   * administra o mundo pode.
   *
   * Por ID e não por e-mail: sem envio de e-mail não há como verificar
   * endereço, e convite indexado por e-mail não verificado é reivindicável por
   * quem se cadastrar com o endereço de outra pessoa. O ID não tem esse
   * problema — ele identifica uma conta que já existe.
   *
   * Não há passo de aceite: ter um ID significa já ter conta, então não há nada
   * para esperar. Quem administra adiciona, e a pessoa já entra.
   */
  'lobby:addMember': (worldId: string, memberId: string, ack: (res: LobbyResult) => void) => void;

  /**
   * Aceita um convite pendente — explícito, nunca automático.
   * **Dormente**: nada cria convite pendente hoje (ver `lobby:addMember`). Fica
   * porque é a volta do convite por e-mail quando houver domínio.
   */
  'lobby:accept': (inviteId: string, ack: (res: LobbyResult) => void) => void;

  /** Recusa um convite meu: apaga o convite pendente. **Dormente**, idem. */
  'lobby:decline': (inviteId: string, ack: (res: LobbyResult) => void) => void;

  // ------------------------------------------------- gerenciar um mundo
  //
  // Exigem **dono ou host**, conferido no servidor a cada chamada — esconder o
  // botão não é controle de acesso. As duas exceções, marcadas abaixo, são só
  // do dono: arquivar e passar a propriedade.

  /** Painel do mundo: quem tem acesso e quais convites estão pendentes. */
  'lobby:world': (worldId: string, ack: (res: LobbyResult) => void) => void;

  /** Renomeia, muda a lotação ou a visibilidade. Campo ausente não muda. */
  'lobby:update': (worldId: string, patch: WorldPatch, ack: (res: LobbyResult) => void) => void;

  /**
   * Arquiva o mundo: sai do lobby, ninguém entra mais, e quem está dentro é
   * desconectado. NÃO apaga — ver `0006_world_admin.sql`.
   *
   * **Só o dono.**
   */
  'lobby:archive': (worldId: string, ack: (res: LobbyResult) => void) => void;

  /**
   * Define o papel de um membro (`host` administra, `member` só entra).
   *
   * Host pode promover e rebaixar `member`; mexer em quem já é `host` é só do
   * dono — senão dois hosts poderiam se rebaixar um ao outro numa corrida.
   */
  'lobby:setMemberRole': (
    worldId: string,
    profileId: string,
    role: AssignableWorldRole,
    ack: (res: LobbyResult) => void,
  ) => void;

  /**
   * Passa a propriedade do mundo para outro membro. **Só o dono.**
   *
   * O dono antigo continua com acesso, como `host` — entregar a chave não
   * devia significar perder o lugar.
   */
  'lobby:transferOwner': (
    worldId: string,
    profileId: string,
    ack: (res: LobbyResult) => void,
  ) => void;

  /**
   * Tira o acesso de alguém. Se a pessoa estiver dentro do mundo neste momento,
   * ela é desconectada e cai na recusa ao tentar voltar.
   */
  'lobby:removeMember': (
    worldId: string,
    profileId: string,
    ack: (res: LobbyResult) => void,
  ) => void;

  /** Cancela um convite que ainda não foi aceito. */
  'lobby:revokeInvite': (inviteId: string, ack: (res: LobbyResult) => void) => void;

  // ---------------------------------------------------------- soundboard
  //
  // Sons curtos que a pessoa sobe e toca para quem está perto. As três
  // operações de biblioteca são por ack (são raras, uma por clique, e a tela
  // precisa saber por que falhou); o disparo é sem ack, como todo evento de
  // mundo. Ver `docs/features/soundboard.md`.
  //
  // Nenhuma aceita identidade no payload: quem está pedindo sai do token
  // verificado no handshake, igual ao `join` e ao lobby.

  /** Meus sons, meu tempo acumulado e o que falta para o próximo slot. */
  'soundboard:list': (ack: (res: SoundboardResult) => void) => void;

  /**
   * Sobe um som para um slot.
   *
   * Os bytes vêm por aqui, e não por uma rota HTTP, porque o servidor não tem
   * roteador: o `index.ts` é `node:http` cru servindo `client/dist`, com
   * fallback de SPA que responderia `200 index.html` a um endpoint mal roteado.
   * E não vão direto do navegador para o Storage porque o invariante do banco é
   * "só o servidor escreve" (`0002_rls.sql`): upload direto exigiria abrir
   * política de INSERT em `storage.objects`.
   *
   * O servidor confere MIME, bytes (`SOUND_MAX_BYTES`) e se o slot está
   * liberado pelo tempo acumulado. **A duração é conferida no cliente** — medir
   * 5s no servidor exigiria decodificar áudio em Node, ou seja, dependência
   * nova; o teto de bytes é o limite duro deste lado.
   */
  'soundboard:upload': (
    slot: number,
    label: string,
    mime: string,
    durationMs: number,
    bytes: ArrayBuffer,
    ack: (res: SoundboardResult) => void,
  ) => void;

  /**
   * Muda o volume com que eu ouço o soundboard (0..`SOUND_VOLUME_MAX`).
   *
   * Por ack como as outras operações de biblioteca, e não como evento de mundo:
   * é escrita no perfil, e a tela precisa saber se pegou. O cliente aplica o
   * volume **na hora** e manda depois (com debounce, senão arrastar o slider
   * seria uma escrita por pixel) — o ack só confirma a persistência.
   */
  'soundboard:setVolume': (volume: number, ack: (res: SoundboardResult) => void) => void;

  /** Apaga um som meu (o arquivo sai do Storage junto). Libera o slot. */
  'soundboard:remove': (soundId: string, ack: (res: SoundboardResult) => void) => void;

  /**
   * Toca um som meu para quem está perto. Sem ack, como os outros eventos de
   * mundo: o efeito acontece na tela das outras pessoas, não aqui.
   *
   * Recusado **em silêncio** quando o som não é meu, quando o slot deixou de
   * estar liberado, ou quando o cooldown (`SOUND_COOLDOWN_MS`) ainda corre —
   * recusa calada é a convenção do `presence:nudge`, pelo mesmo motivo: a
   * resposta a "consegui?" não deve virar sonda de quem está onde.
   */
  'soundboard:play': (soundId: string) => void;

  // ----------------------------------------------- volume por pessoa
  //
  // O quanto EU ouço UMA pessoa (voz e sons, separados). Ver
  // `docs/features/volume-por-pessoa.md`.

  /**
   * Grava o meu ajuste para esta pessoa. `targetId` é o `socket.id` dela; o
   * servidor traduz para o perfil, que é o que persiste.
   *
   * **Por ack**, e não como evento de mundo, pelo mesmo motivo do
   * `soundboard:setVolume`: é escrita no meu perfil, e a tela precisa poder
   * dizer "aplicado, mas não salvo". O cliente aplica na hora e manda depois,
   * com debounce — senão arrastar o slider seria uma escrita por pixel.
   *
   * Os dois volumes vão **juntos** mesmo quando só um mudou: a linha do banco é
   * um upsert do par, e mandar um campo só exigiria ler-modificar-escrever no
   * servidor para não zerar o outro.
   */
  'audio:setPeer': (
    targetId: string,
    voice: number,
    sound: number,
    ack: (res: PeerAudioResult) => void,
  ) => void;
}
