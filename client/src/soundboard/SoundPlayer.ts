import { SOUND_MAX_CONCURRENT, SOUND_PEAK, SOUND_VOLUME_DEFAULT, SOUND_VOLUME_MAX } from '@together/shared';

/**
 * Toca os sons do soundboard no navegador.
 *
 * **Não passa pelo LiveKit.** O arquivo é baixado por HTTP (URL assinada pelo
 * servidor) e tocado em WebAudio local, em cada máquina que deve ouvi-lo. A
 * alternativa era publicar uma faixa de áudio na sala e deixar o SFU distribuir,
 * e ela foi descartada por três razões: `voice.ts` assina o token com
 * `canPublishData: false` e uma faixa a mais por pessoa mexeria na conta de
 * subscrições do `VoiceRoom` (que já tem teto); o soundboard tem de funcionar em
 * ambiente **sem** LiveKit configurado, como o resto do app; e o volume por
 * distância é local por natureza — mandar o mesmo áudio para todo mundo e
 * atenuar em cada ponta é exatamente o que o SFU faria, sem o desvio.
 *
 * A herança direta é o `ui/knock.ts`: um `AudioContext` só, criado no primeiro
 * uso, `resume()` fire-and-forget, e falha em silêncio (`catch` + `warn`) porque
 * som é reforço, não o canal principal.
 */
export class SoundPlayer {
  private ctx: AudioContext | null = null;

  /**
   * Gain mestre: **todo** som passa por aqui antes do destino.
   *
   * É o que faz mudar o volume valer para o som que já está tocando, e não só
   * para o próximo — arrastar um slider e não ouvir diferença até o próximo
   * disparo lê como controle quebrado. Também deixa a atenuação por distância
   * ser o gain *por som*, independente da preferência da pessoa: são dois
   * estágios, não um número misturado.
   */
  private master: GainNode | null = null;

  /** Preferência da pessoa, 0..`SOUND_VOLUME_MAX`. Persistida no perfil. */
  private volume = SOUND_VOLUME_DEFAULT;

  /**
   * Áudio já decodificado, por `soundId`.
   *
   * Decodificar é caro e baixar é rede: o mesmo som toca muitas vezes por
   * sessão, e a mesma pessoa costuma repetir o dela. A chave é o `soundId` e
   * **não** a URL, porque a URL é assinada e muda a cada reassinatura — cachear
   * por URL baixaria tudo de novo a cada quatro horas.
   */
  private buffers = new Map<string, AudioBuffer>();

  /** Downloads em andamento, para dois disparos juntos não baixarem duas vezes. */
  private loading = new Map<string, Promise<AudioBuffer | null>>();

  /** Fontes tocando agora, para impor `SOUND_MAX_CONCURRENT` e parar tudo. */
  private playing = new Set<AudioBufferSourceNode>();

  /**
   * Ajusta o volume da preferência (0..`SOUND_VOLUME_MAX`).
   *
   * A rampa curta em vez de atribuição direta existe porque mexer no gain de um
   * som que está tocando produz **clique** se o valor salta — o mesmo motivo dos
   * envelopes no `knock.ts` e no recorte. 30ms é imperceptível como transição e
   * suficiente para o salto virar rampa.
   */
  setVolume(volume: number): void {
    this.volume = Math.min(SOUND_VOLUME_MAX, Math.max(0, Math.round(volume)));
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;
    const target = this.volume / SOUND_VOLUME_MAX;
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
    master.gain.linearRampToValueAtTime(target, ctx.currentTime + 0.03);
  }

  /**
   * Toca um som já autorizado pelo servidor, com o ganho pedido.
   *
   * `gain` é o que a regra de audibilidade da voz devolveu (`audioVolumeFor`),
   * de 0 a 1 — quem chama é que sabe de parede, distância e booble. Ganho 0 nem
   * inicia o download: som inaudível não vale rede.
   */
  play(soundId: string, url: string, gain: number): void {
    if (gain <= 0) return;
    void this.load(soundId, url).then((buffer) => {
      if (buffer) this.start(buffer, gain);
    });
  }

  /**
   * Pré-carrega um som sem tocar (usado ao abrir o painel: o primeiro clique no
   * próprio som não deve esperar download).
   */
  preload(soundId: string, url: string): void {
    void this.load(soundId, url);
  }

  /** Esquece um som removido — senão o buffer fica preso até a aba fechar. */
  forget(soundId: string): void {
    this.buffers.delete(soundId);
    this.loading.delete(soundId);
  }

  /** Corta o que está tocando. Chamado ao ficar surdo, ausente, ou sair do mundo. */
  stopAll(): void {
    for (const source of this.playing) {
      try {
        source.stop();
      } catch {
        // já parou por conta própria; `stop()` duas vezes lança
      }
    }
    this.playing.clear();
  }

  destroy(): void {
    this.stopAll();
    this.buffers.clear();
    this.loading.clear();
    this.master?.disconnect();
    this.master = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
  }

  private context(): AudioContext | null {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume / SOUND_VOLUME_MAX;
        this.master.connect(this.ctx.destination);
      }
      // um contexto criado fora de gesto do usuário nasce suspenso; retomar é
      // barato, e se o navegador recusar o som simplesmente não sai — o mesmo
      // contrato do `knock.ts`
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch (err) {
      console.warn('[soundboard] sem AudioContext:', err);
      return null;
    }
  }

  private load(soundId: string, url: string): Promise<AudioBuffer | null> {
    const cached = this.buffers.get(soundId);
    if (cached) return Promise.resolve(cached);
    const running = this.loading.get(soundId);
    if (running) return running;

    const job = (async (): Promise<AudioBuffer | null> => {
      const ctx = this.context();
      if (!ctx) return null;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const bytes = await res.arrayBuffer();
        const buffer = await ctx.decodeAudioData(bytes);
        this.buffers.set(soundId, buffer);
        return buffer;
      } catch (err) {
        // URL vencida, arquivo apagado, formato que este navegador não
        // decodifica: nada disso pode virar exceção não tratada
        console.warn('[soundboard] não foi possível carregar o som:', err);
        return null;
      } finally {
        this.loading.delete(soundId);
      }
    })();

    this.loading.set(soundId, job);
    return job;
  }

  private start(buffer: AudioBuffer, gain: number): void {
    const ctx = this.context();
    if (!ctx || !this.master) return;
    // volume 0 é silêncio: não vale ocupar uma das vagas de simultâneos nem
    // agendar nós para tocar nada
    if (this.volume === 0) return;
    /**
     * Teto de sons simultâneos: não é limite de rede, é de ouvido. Descarta o
     * NOVO em vez de cortar o que já está tocando — cortar no meio soa como
     * falha, e o som mais antigo é o que a pessoa já começou a interpretar.
     */
    if (this.playing.size >= SOUND_MAX_CONCURRENT) return;

    try {
      const source = ctx.createBufferSource();
      const volume = ctx.createGain();
      source.buffer = buffer;
      volume.gain.value = Math.max(0, Math.min(1, gain)) * SOUND_PEAK;
      source.connect(volume).connect(this.master);
      source.onended = () => {
        this.playing.delete(source);
        source.disconnect();
        volume.disconnect();
      };
      this.playing.add(source);
      source.start();
    } catch (err) {
      console.warn('[soundboard] não foi possível tocar o som:', err);
    }
  }
}
