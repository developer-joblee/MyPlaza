export const SERVER_PORT = 3001;

export const TILE_SIZE = 32;

/** Velocidade do avatar em px/s */
export const MOVE_SPEED = 170;

/** Envios de posição por segundo (client -> server) */
export const TICK_RATE = 15;

/** Raio (px) dentro do qual o áudio conecta */
export const PROXIMITY_RADIUS = TILE_SIZE * 5;

/** Margem extra antes de considerar "fora de alcance" */
export const PROXIMITY_HYSTERESIS = TILE_SIZE * 1.5;

/** Tempo fora de alcance antes de cortar o vídeo de tela */
export const DISCONNECT_GRACE_MS = 2000;

/**
 * Raio de *subscrição* de áudio — bem maior que o audível de propósito.
 * `volumeForDistance()` já devolve 0 além de PROXIMITY_RADIUS, então a faixa
 * entre os dois fica assinada e inaudível: é pré-carregamento. Precisa ser
 * maior que (latência de subscrição × MOVE_SPEED): 240px de folga ÷ 170px/s
 * = 1,4s, contra ~0,8s de pior caso para assinar.
 */
export const AUDIO_SUBSCRIBE_RADIUS = PROXIMITY_RADIUS * 2.5;

/** Tempo fora do raio de subscrição antes de desassinar o áudio */
export const AUDIO_SUBSCRIBE_GRACE_MS = 8000;

/** Teto de streams de áudio assinados ao mesmo tempo (os mais próximos ganham) */
export const MAX_AUDIO_SUBSCRIPTIONS = 16;

/** Intervalo do tick que reconcilia subscrição e volume por distância */
export const VOICE_TICK_MS = 250;

/**
 * Intervalo mínimo entre dois chamados da MESMA pessoa para o MESMO alvo (ms).
 *
 * Chamar quem está ausente é um toque na porta, e porta se bate uma vez. 15s é
 * curto o bastante para o segundo toque ser legítimo ("ainda estou aqui") e
 * longo o bastante para tirar a graça de clicar em sequência. Vive aqui porque
 * os dois lados usam: o servidor **impõe** (esconder o botão não é limite) e o
 * cliente desabilita o botão pelo mesmo tempo, para não parecer que sumiu.
 */
export const NUDGE_COOLDOWN_MS = 15000;

/** Quantos nomes o aviso lista antes de virar "e +N". */
export const NUDGE_MAX_NAMES = 2;

// ------------------------------------------------------------------- booble
//
// Uma "booble" é um grupo ad-hoc que PRIORIZA o áudio de quem está dentro, sem
// isolar ninguém: dentro se ouve 100%, e a sala vira ruído de fundo a 10% — nos
// dois sentidos. É o que dispensa "chamar no particular" para trocar duas
// frases dentro de uma sala grande. Ver `docs/features/booble.md`.
//
// As quatro constantes vivem aqui porque os DOIS lados usam: o servidor impõe
// (é ele que tem as posições) e o cliente decide o que mostrar pelos mesmos
// valores. Mesma razão do `NUDGE_COOLDOWN_MS` acima.

/**
 * Quanto do volume normal se ouve ATRAVÉS da borda da booble.
 *
 * É o número que define a feature: não é 0 (isso já existe, e chama-se sala
 * fechada) nem 1 (isso é não ter booble). A sala continua audível — você
 * percebe que alguém falou com você e sai da booble se quiser — mas ela para de
 * competir com a conversa que você escolheu.
 *
 * Atenção: é ganho **linear** de `HTMLAudioElement.volume`, não perceptual —
 * 0,1 de amplitude soa perto de −20 dB, mais baixo do que "10%" sugere ao
 * ouvido. É literalmente o que foi pedido, e este é o único botão a girar se na
 * prática ficar inaudível demais.
 */
export const BOOBLE_OUTSIDE_VOLUME = 0.1;

/**
 * Distância máxima para ENTRAR numa booble: **2 tiles**.
 *
 * Bem menor que o raio audível (5 tiles) de propósito. A booble é um cochicho —
 * você chega do lado da pessoa para abrir uma, não grita do outro lado da sala.
 * Com o raio igual ao audível a booble virava "conversa com qualquer um que eu
 * escuto", que é a sala inteira, e aí ela não priorizava nada.
 *
 * É este valor, e não o audível, que decide quando o botão aparece na lista do
 * HUD (`store.boobleReachIds`, calculado no `Game`): botão que aparece para
 * quem está longe demais leva a um clique recusado em silêncio.
 */
export const BOOBLE_JOIN_RADIUS = TILE_SIZE * 2;

/**
 * Distância máxima para PERMANECER: **3 tiles**.
 *
 * Um tile a mais que a entrada, e não mais que isso. Sair da booble tem de ser
 * dar dois passos para o lado — se sair exigisse atravessar a sala, o cochicho
 * ficaria pendurado atrás de você e metade do escritório soaria a 10% por causa
 * de uma conversa que já acabou.
 *
 * O tile de folga é histerese, e é obrigatório: com um raio só, quem para
 * exatamente na fronteira entra e sai a cada passo, com um broadcast por vez. É
 * a mesma ideia do `VIDEO_RADIUS` da voz.
 *
 * A conta é contra o membro **mais próximo**, não contra todos: uma roda de
 * quatro pessoas é mais larga que 3 tiles, e exigir proximidade de todo mundo
 * dissolveria a booble por geometria em vez de por intenção. Quem desenha o
 * limite real é o círculo em volta do grupo (`game/BoobleRings.ts`), que envolve
 * as posições de verdade em vez de supor uma forma.
 */
export const BOOBLE_EXIT_RADIUS = TILE_SIZE * 3;

/**
 * Teto de gente numa booble. Existe porque uma booble do tamanho da sala não
 * prioriza nada — ela só deixa a sala 10% mais baixa para quem sobrou fora, o
 * que é o oposto do que a feature promete. Conversa paralela de nove pessoas é
 * uma reunião, e para isso o mapa já tem sala fechada.
 */
export const BOOBLE_MAX_MEMBERS = 8;

/**
 * Quantos nomes o aviso da booble lista antes de virar "e +N". Espelha o
 * `NUDGE_MAX_NAMES` de propósito: os dois avisos moram na mesma pilha, e listas
 * de comprimento diferente lado a lado leem como inconsistência.
 */
export const BOOBLE_MAX_NAMES = 2;

export const CHAT_HISTORY_LIMIT = 100;
export const CHAT_MAX_LENGTH = 500;
export const NAME_MAX_LENGTH = 20;

/** Raio do círculo do avatar (px) */
export const AVATAR_RADIUS = 12;

/** Cores disponíveis para o avatar */
export const AVATAR_COLORS = [
  0xe63946, 0xf4a261, 0xe9c46a, 0x2a9d8f,
  0x457b9d, 0x8e7dbe, 0xef476f, 0x06d6a0,
] as const;

/**
 * Personagens disponíveis. Aqui só moram os ids e os rótulos, porque isto é
 * protocolo: o servidor precisa validar a escolha e os outros clientes precisam
 * saber qual boneco desenhar. Como cada um é desenhado (spritesheet, tamanho do
 * quadro, recorte de cada direção) é assunto do cliente, em
 * `client/src/game/sprites.ts`.
 */
export const CHARACTERS = [
  { id: 'adam', label: 'Adam' },
  { id: 'alex', label: 'Alex' },
  { id: 'amelia', label: 'Amélia' },
  { id: 'bob', label: 'Bob' },
] as const;

export type CharacterId = (typeof CHARACTERS)[number]['id'];

export const DEFAULT_CHARACTER: CharacterId = 'adam';

export function isCharacterId(value: unknown): value is CharacterId {
  return CHARACTERS.some((c) => c.id === value);
}

/**
 * Intervalo mínimo entre gravações da posição no banco (ms).
 *
 * O cliente manda posição a TICK_RATE (15/s); gravar tudo seria ~15 escritas
 * por pessoa por segundo, sem ganho — o que importa é onde a pessoa está se a
 * conexão cair. 3s limita o prejuízo a ~3s de caminhada (≈510px) e mantém a
 * escrita em 1 upsert a cada 45 mensagens de movimento. A saída (`disconnect`)
 * grava a posição final de imediato, então o corte só aparece se o processo
 * morrer de vez.
 */
export const POSITION_SAVE_MS = 3000;

/**
 * O ID de uma pessoa é o uuid do perfil dela (`profiles.id`) — é o que se passa
 * a quem administra um mundo para ganhar acesso (`lobby:addMember`).
 *
 * Mora aqui, e não em cada lado, porque os dois validam: o cliente para não
 * habilitar o botão com texto colado torto, e o servidor porque **esconder o
 * botão não é validação**. Sem a checagem no servidor, texto qualquer chegaria
 * ao banco e voltaria como erro de sintaxe de uuid — que a tela mostraria como
 * "erro" em vez de "esse ID não existe".
 */
export function isProfileId(value: unknown): value is string {
  return isUuid(value);
}

/**
 * Um uuid em forma canônica, sem afirmar nada sobre o que ele identifica.
 *
 * Extraído de `isProfileId` quando o soundboard passou a precisar validar id de
 * som (`isSoundId`): o regex copiado em dois lugares é o começo de duas regras
 * que divergem. Os dois validadores nomeados continuam existindo porque o nome
 * é o que documenta a intenção na chamada — `isUuid(x)` no meio de um handler
 * não diz de qual coisa.
 */
export function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value.trim().toLowerCase())
  );
}

// ---------------------------------------------------------------- soundboard
//
// Sons curtos que a própria pessoa sobe e toca para quem está por perto. A
// quantidade que ela pode ter é conquistada pelo tempo na plataforma — a tabela
// de marcos está em `levels.ts`, separada porque vai crescer para além de tempo.
// Ver `docs/features/soundboard.md`.
//
// Como no bloco da booble e no do nudge, estes valores vivem aqui porque os DOIS
// lados usam: o servidor impõe cada um deles, e o cliente precisa dos mesmos
// números para recusar antes de gastar upload e para desabilitar o botão.

/** Um som do soundboard é sempre efêmero e curto: 5s é o pedido original. */
export const SOUND_MAX_MS = 5000;

/**
 * Teto de bytes de um som.
 *
 * É o **limite duro** da feature, e não o de duração: o arquivo sobe por ack do
 * Socket.IO, e validar 5s no servidor exigiria decodificar áudio em Node (uma
 * dependência nova). O cliente mede a duração de verdade com
 * `decodeAudioData`; aqui o servidor garante que nada absurdo entra no Storage.
 *
 * 512 KB dão folga generosa para 5s (um mp3 de 5s a 128 kbps tem ~80 KB, um wav
 * de 5s a 44,1 kHz estéreo tem ~880 KB e por isso é recusado — de propósito,
 * wav sem compressão não é formato de soundboard). Fica bem abaixo do
 * `maxHttpBufferSize` de 1 MB que o Socket.IO usa por padrão: estourar aquele
 * teto **derruba o socket**, em vez de responder recusa, e é uma falha que
 * pareceria bug de conexão.
 */
export const SOUND_MAX_BYTES = 512 * 1024;

/**
 * Formatos aceitos. Whitelist, não blacklist — o valor chega do cliente e vira
 * `contentType` no Storage, então é ele que decide o que o navegador de outra
 * pessoa vai tentar decodificar.
 *
 * `audio/wav` está aqui por um motivo específico: é o formato em que o **próprio
 * cliente** reescreve um arquivo que passou de `SOUND_MAX_MS` ou de
 * `SOUND_MAX_BYTES` (ver `client/src/soundboard/trim.ts`). Mono, 22,05 kHz e no
 * máximo 5s, ele fica em ~220 KB — dentro do teto. Wav arbitrário de upload
 * (44,1 kHz estéreo) continua barrado, mas pelo teto de bytes, que é o limite
 * duro, e não por MIME.
 */
export const SOUND_MIME = [
  'audio/mpeg',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/wav',
] as const;

export type SoundMime = (typeof SOUND_MIME)[number];

export function isSoundMime(value: unknown): value is SoundMime {
  return typeof value === 'string' && (SOUND_MIME as readonly string[]).includes(value);
}

/** Nome do som na grade. Curto porque é legenda de botão, não descrição. */
export const SOUND_LABEL_MAX = 24;

/**
 * Taxa de amostragem com que o cliente **reescreve** um som que precisou ser
 * cortado (ou que era grande demais). Mono, sempre.
 *
 * 22,05 kHz é metade do CD e cobre até ~11 kHz — acima do que importa num som
 * curto de soundboard, que sai por alto-falante de laptop e ainda leva
 * atenuação por distância. A conta que manda é o tamanho: 5s × 22050 × 2 bytes
 * ≈ 220 KB, com folga sob `SOUND_MAX_BYTES`; a 44,1 kHz estéreo o mesmo trecho
 * daria ~880 KB e seria recusado pelo próprio limite que existe para protegê-lo.
 *
 * Vive em `shared/` porque o teto de bytes do servidor só faz sentido junto com
 * esta conta — quem mexer em um tem de olhar o outro.
 */
export const SOUND_TRIM_RATE = 22050;

/**
 * Fade-out aplicado no fim de um som cortado (ms).
 *
 * Cortar no meio de uma onda deixa uma descontinuidade, e descontinuidade
 * **estala** — é o mesmo motivo pelo qual o `knock.ts` tem envelope explícito em
 * cada batida. 40ms é curto o bastante para não se perceber como
 * desaparecimento e longo o bastante para o clique sumir.
 */
export const SOUND_TRIM_FADE_MS = 40;

/**
 * Intervalo mínimo entre dois sons da MESMA pessoa (ms).
 *
 * Por emissor, e não por par como o `NUDGE_COOLDOWN_MS`: o alvo aqui é todo
 * mundo que está perto, então "um cooldown por alvo" seria nenhum cooldown. 6s é
 * o tempo de um som acabar e a conversa retomar — curto o bastante para uma
 * resposta em sequência ser possível, longo o bastante para não dar para
 * metralhar.
 *
 * Imposto no servidor. O botão desabilitado é conforto; esconder o botão não é
 * limite.
 */
export const SOUND_COOLDOWN_MS = 6000;

/**
 * Quantos sons podem tocar ao mesmo tempo na MINHA tela.
 *
 * Não é limite de rede, é limite de ouvido: três pessoas disparando junto já é
 * ruído, e a quarta camada só piora. O `knock.ts` resolve o mesmo problema
 * descartando o segundo som (`busyUntil`); aqui descartar tudo depois do
 * primeiro seria pior, porque sons diferentes de pessoas diferentes são
 * informação, não repetição.
 */
export const SOUND_MAX_CONCURRENT = 3;

/**
 * Ganho aplicado ao som antes da atenuação por distância.
 *
 * Um pouco abaixo de 1 porque o arquivo é de terceiro (a pessoa que subiu) e
 * pode estar normalizado no talo, enquanto a voz do LiveKit passa por AGC. Sem
 * essa margem o soundboard entra sempre mais alto que a conversa, e a primeira
 * reação de quem ouve é baixar o volume do sistema — o que estraga a voz.
 */
export const SOUND_PEAK = 0.7;

/**
 * Volume do soundboard, em passos de 0 a 100.
 *
 * Escala inteira, e não 0..1, porque este número **viaja pelo banco** e é o que
 * a tela mostra: `smallint` não acumula erro de ponto flutuante em ida e volta, e
 * "70" é o que o slider precisa. A conversão para ganho (÷100) acontece num lugar
 * só, no `SoundPlayer`.
 */
export const SOUND_VOLUME_MAX = 100;

/**
 * Volume inicial de quem nunca mexeu no controle.
 *
 * Abaixo do máximo de propósito: som de soundboard é interrupção, e o arquivo é
 * de terceiro (pode estar normalizado no talo), enquanto a voz do LiveKit passa
 * por AGC. Nascer em 70 deixa margem para **subir** quem quer mais, em vez de
 * fazer a primeira experiência de todo mundo ser um susto seguido de baixar o
 * volume do sistema — que estragaria a voz junto.
 *
 * Multiplica `SOUND_PEAK`, não o substitui: aquele é o teto técnico da feature,
 * este é a preferência da pessoa.
 */
export const SOUND_VOLUME_DEFAULT = 70;

/**
 * Normaliza um volume vindo de fora (slider, banco, cliente adulterado).
 *
 * Vive aqui porque os dois lados precisam da MESMA conta: o servidor para não
 * gravar lixo na coluna, e o cliente para não pedir ganho negativo ao WebAudio
 * (que lança). Valor inválido cai no default, e não em 0 — perder a preferência
 * é ruim, mas silenciar alguém que não pediu silêncio é pior.
 */
export function clampVolume(value: unknown): number {
  /**
   * Só número e string numérica entram na conversão.
   *
   * Não é purismo: `Number(null)`, `Number('')` e `Number(false)` valem todos
   * **0**, então sem esta guarda um valor ausente (ou um payload torto)
   * silenciaria a pessoa em vez de cair no default — o oposto do que o parágrafo
   * acima promete. Foi um teste que pegou a divergência entre o comentário e o
   * código.
   */
  if (typeof value !== 'number' && typeof value !== 'string') return SOUND_VOLUME_DEFAULT;
  if (value === '') return SOUND_VOLUME_DEFAULT;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SOUND_VOLUME_DEFAULT;
  return Math.min(SOUND_VOLUME_MAX, Math.max(0, n));
}

/**
 * De quanto em quanto tempo o servidor credita presença (ms).
 *
 * O tempo acumulado (`profiles.presence_seconds`) é creditado em fatias, e não
 * calculado somando `sessions` na leitura, por uma razão concreta: sessão que
 * morre com o processo fica com `left_at is null` para sempre, e a soma com
 * `now()` — o que a view `v_place_activity` faz — contaria dias de alguém que
 * saiu. Creditar em fatias limita o erro a uma fatia por queda.
 *
 * 60s é o meio: uma escrita por pessoa por minuto (irrelevante ao lado das 15
 * mensagens de posição por segundo) e um prejuízo máximo de um minuto para quem
 * cai. A saída normal (`disconnect`) credita o resto na hora.
 */
export const PRESENCE_CREDIT_MS = 60_000;
