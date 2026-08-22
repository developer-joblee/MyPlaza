import type { Server, Socket } from 'socket.io';
import {
  PROXIMITY_RADIUS,
  SOUND_COOLDOWN_MS,
  SOUND_VOLUME_MAX,
  SOUND_LABEL_MAX,
  SOUND_MAX_BYTES,
  SOUND_MAX_SLOTS,
  clampVolume,
  distancePx,
  isSoundMime,
  isUuid,
  levelFor,
  nextLevel,
  secondsToNextLevel,
  slotsFor,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SoundboardErrorReason,
  type SoundboardResult,
  type SoundboardState,
  type SoundMime,
} from '@together/shared';
import { whoIsSocket, type SocketWho } from './socketAuth';
import {
  deleteUserSound,
  getUserSound,
  insertUserSound,
  listUserSounds,
  loadPresenceSeconds,
  loadSoundboardPrefs,
  saveSoundboardVolume,
} from './db';
import type { SocketData } from './handlers';
import { getWorld, type World } from './world';

/**
 * Soundboard: a biblioteca de sons de cada pessoa e o disparo para quem está
 * perto.
 *
 * Arquivo próprio, e não mais um bloco em `handlers.ts`, pelo mesmo motivo que
 * o lobby tem o seu: são operações **por ack** com casca comum (autenticar,
 * responder com o estado novo inteiro), e essa casca não tem nada a ver com o
 * fluxo de posição/chat do mundo. A exceção é `soundboard:play`, que é evento de
 * mundo de verdade — mas ele mora aqui para não separar a regra de "este som é
 * seu e está liberado" em dois arquivos.
 *
 * Ver `docs/features/soundboard.md`.
 */

type IoServer = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;
type IoSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

/** Extensão do arquivo no Storage, derivada do MIME (nunca do nome que o cliente mandou). */
const EXT_BY_MIME: Record<SoundMime, string> = {
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  // o cliente reescreve em wav o que precisou cortar (ver `soundboard/trim.ts`)
  'audio/wav': 'wav',
};

export function registerSoundboardHandlers(io: IoServer, socket: IoSocket): void {
  const fail = (reason: SoundboardErrorReason): SoundboardResult => ({ ok: false, reason });

  /**
   * Quem está pedindo. O `whoAmI` vive em `socketAuth.ts` porque o
   * `audioPrefs.ts` precisa do mesmo — e ele nasceu como cópia declarada deste,
   * que é o jeito conhecido de duas verificações de identidade divergirem.
   */
  const whoAmI = (): Promise<SocketWho> => whoIsSocket(socket);

  /**
   * O estado inteiro: sons, tempo acumulado e o próximo marco. Vem em toda
   * resposta de sucesso — mesma convenção do lobby, e pela mesma razão: sem
   * isso a tela teria de pedir a lista de novo depois de subir ou remover, com
   * uma janela no meio em que ela mostra o que já não é verdade.
   */
  async function buildState(profileId: string): Promise<SoundboardState> {
    const [sounds, prefs] = await Promise.all([
      listUserSounds(profileId),
      loadSoundboardPrefs(profileId),
    ]);
    const { presenceSeconds } = prefs;
    const level = levelFor(presenceSeconds);
    const next = nextLevel(presenceSeconds);
    return {
      sounds,
      volume: prefs.volume,
      presenceSeconds,
      slots: slotsFor(presenceSeconds),
      level: level?.level ?? null,
      levelLabel: level?.label ?? null,
      secondsToNext: secondsToNextLevel(presenceSeconds),
      nextSlots: next?.slots ?? null,
    };
  }

  /** Casca comum das três operações por ack. Espelha o `handle()` do lobby. */
  function handle(
    label: string,
    op: (profileId: string) => Promise<SoundboardErrorReason | null>,
  ): (ack: unknown) => Promise<void> {
    return async (ack: unknown) => {
      if (typeof ack !== 'function') return;
      const reply = ack as (res: SoundboardResult) => void;
      const who = await whoAmI();
      if (!who.ok) return reply(fail(who.reason));
      try {
        const outcome = await op(who.profileId);
        if (outcome) {
          console.log(`[soundboard] ${label} recusado: ${outcome}`);
          return reply(fail(outcome));
        }
        reply({ ok: true, state: await buildState(who.profileId) });
      } catch (err) {
        console.error(`[soundboard] ${label}:`, err instanceof Error ? err.message : err);
        reply(fail('error'));
      }
    };
  }

  socket.on('soundboard:list', handle('list', async () => null));

  socket.on(
    'soundboard:upload',
    async (rawSlot, rawLabel, rawMime, rawDuration, rawBytes, ack) => {
      await handle('upload', async (profileId) => {
        const slot = Number(rawSlot);
        if (!Number.isInteger(slot) || slot < 1 || slot > SOUND_MAX_SLOTS) return 'invalid-input';

        const label = String(rawLabel ?? '').trim();
        if (!label || label.length > SOUND_LABEL_MAX) return 'invalid-input';

        if (!isSoundMime(rawMime)) return 'bad-format';

        /**
         * A duração vem MEDIDA pelo cliente (`decodeAudioData`), e o servidor
         * não tem como conferir sem decodificar áudio em Node — dependência
         * nova. Então ela é tratada como informação de exibição: um número
         * absurdo é normalizado, não recusado, e o limite de verdade é o de
         * bytes abaixo. Está registrado no doc da feature como limitação
         * consciente, não como esquecimento.
         */
        const durationMs = Number(rawDuration);
        const safeDuration = Number.isFinite(durationMs) && durationMs > 0
          ? Math.min(Math.round(durationMs), 60_000)
          : 0;

        const bytes = toBytes(rawBytes);
        if (!bytes || bytes.byteLength === 0) return 'invalid-input';
        if (bytes.byteLength > SOUND_MAX_BYTES) return 'too-large';

        /**
         * O slot tem de estar liberado pelo tempo acumulado. Conferido aqui, e
         * não só na grade da tela, porque esconder o botão não é limite — um
         * cliente adulterado mandaria `slot: 5` no primeiro minuto de uso.
         */
        const unlocked = slotsFor(await loadPresenceSeconds(profileId));
        if (slot > unlocked) return 'not-unlocked';

        const ok = await insertUserSound(
          profileId,
          slot,
          label,
          rawMime,
          safeDuration,
          bytes,
          EXT_BY_MIME[rawMime],
        );
        return ok ? null : 'error';
      })(ack);
    },
  );

  socket.on('soundboard:setVolume', async (rawVolume, ack) => {
    await handle('setVolume', async (profileId) => {
      /**
       * Recusa o que não é número, em vez de deixar o `clampVolume` salvar o
       * default: pedido malformado é bug de quem chama, e gravar 70 por cima da
       * escolha da pessoa seria pior que não gravar nada.
       */
      // `typeof` antes de converter: `Number(false)` e `Number(null)` são 0, e
      // gravar silêncio a partir de um payload torto seria pior que recusar
      if (typeof rawVolume !== 'number') return 'invalid-input';
      const n = Number(rawVolume);
      if (!Number.isFinite(n) || n < 0 || n > SOUND_VOLUME_MAX) return 'invalid-input';
      return (await saveSoundboardVolume(profileId, clampVolume(n))) ? null : 'error';
    })(ack);
  });

  socket.on('soundboard:remove', async (rawId, ack) => {
    await handle('remove', async (profileId) => {
      const soundId = String(rawId ?? '');
      if (!isUuid(soundId)) return 'invalid-input';
      return (await deleteUserSound(profileId, soundId)) ? null : 'not-found';
    })(ack);
  });

  /**
   * Toca um som para quem está perto.
   *
   * Sem ack, e recusado **em silêncio** — convenção dos eventos de mundo, e aqui
   * ela tem a mesma razão do `presence:nudge`: uma resposta a "consegui tocar?"
   * diria quem está por perto sem precisar estar perto.
   */
  socket.on('soundboard:play', (rawId) => {
    const { scenarioId, worldKey, profileId } = socket.data;
    if (!scenarioId || !worldKey || !profileId) return;

    const soundId = String(rawId ?? '');
    if (!isUuid(soundId)) return;

    const now = Date.now();
    const last = socket.data.soundAt ?? 0;
    if (now - last < SOUND_COOLDOWN_MS) return;
    /**
     * Marca ANTES de ir ao banco, e não depois de dar tudo certo: as duas
     * consultas levam centenas de ms, e sem isto dez cliques nesse intervalo
     * seriam dez idas ao Storage — o cooldown existe justamente para limitar
     * trabalho, não só barulho.
     */
    socket.data.soundAt = now;

    void (async () => {
      const sound = await getUserSound(profileId, soundId);
      if (!sound) return;

      // o slot pode ter deixado de estar liberado desde o upload (nunca
      // acontece hoje, porque tempo não volta — mas a autorização é aqui)
      if (sound.slot > slotsFor(await loadPresenceSeconds(profileId))) return;

      const world = getWorld(worldKey, scenarioId);
      const me = world.getPlayer(socket.id);
      if (!me) return;

      const targets = audienceFor(world, socket.id);
      for (const id of targets) {
        io.to(id).emit('soundboard:played', socket.id, me.name, sound.id, sound.url);
      }
    })();
  });

}


/**
 * Quem pode ouvir um som de `selfId`: quem está no raio audível **e** na mesma
 * zona, mais quem está na mesma booble.
 *
 * Função de módulo, e não método do handler, para poder ser exercitada com um
 * `World` de verdade sem socket nem banco — é a regra mais fácil de errar da
 * feature e a mais difícil de ver errada no navegador (som que "não toca" parece
 * problema de áudio, não de geometria).
 *
 * O servidor escolhe os destinatários em vez de difundir para o mundo porque ele
 * é quem tem as posições — o mesmo argumento que fez `zoneKeyAt` existir no
 * `World`. Difundir e deixar o cliente filtrar entregaria o evento a quem não
 * deveria nem saber que aconteceu.
 *
 * O filtro é **grosso de propósito**: quem decide o volume é cada cliente, com a
 * MESMA função da voz (`audioVolumeFor`), que atenua a travessia de borda de
 * booble e zera zona diferente. Por isso a booble entra na lista mesmo
 * atravessando parede: é ela que aquela função sabe tratar, e replicar a regra
 * aqui seria a segunda cópia de uma audibilidade que já divergiu uma vez.
 */
export function audienceFor(world: World, selfId: string): string[] {
  const me = world.getPlayer(selfId);
  if (!me) return [];
  const myZone = world.zoneKeyAt(me.x, me.y);

  const out: string[] = [];
  for (const other of world.getPlayers()) {
    if (other.id === selfId) continue;
    if (me.boobleId !== null && other.boobleId === me.boobleId) {
      out.push(other.id);
      continue;
    }
    if (world.zoneKeyAt(other.x, other.y) !== myZone) continue;
    /**
     * Dentro de uma sala fechada o volume é plano (é o que `audioVolumeFor`
     * faz), então distância não filtra: quem está na sala ouve. Na área aberta
     * vale o raio audível — além dele a função devolveria 0, e baixar o arquivo
     * para tocar a zero seria desperdício de rede.
     */
    if (myZone === null && distancePx(me.x, me.y, other.x, other.y) > PROXIMITY_RADIUS) continue;
    out.push(other.id);
  }
  return out;
}

/**
 * Normaliza o que chegou pelo socket em bytes.
 *
 * O Socket.IO entrega `ArrayBuffer` no Node, mas um cliente pode mandar
 * `Buffer`, `Uint8Array` ou qualquer coisa — e `new Uint8Array(lixo)` não lança,
 * devolve vazio. Por isso a checagem é explícita: o que não for binário
 * reconhecível volta como `null` e o handler responde `invalid-input`.
 */
function toBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (raw instanceof Uint8Array) return raw;
  if (ArrayBuffer.isView(raw)) {
    return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  }
  return null;
}
