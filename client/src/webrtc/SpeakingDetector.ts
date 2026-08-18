const POLL_MS = 150;
const RMS_THRESHOLD = 0.02;

interface Entry {
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  data: Float32Array<ArrayBuffer>;
  speaking: boolean;
}

/** Mede o nível de áudio de streams (local e remotos) para o indicador "falando". */
export class SpeakingDetector {
  private ctx = new AudioContext();
  private entries = new Map<string, Entry>();
  private interval: ReturnType<typeof setInterval>;

  constructor(private onChange: (id: string, speaking: boolean) => void) {
    this.interval = setInterval(() => this.poll(), POLL_MS);
  }

  add(id: string, stream: MediaStream): void {
    if (this.entries.has(id) || stream.getAudioTracks().length === 0) return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    const source = this.ctx.createMediaStreamSource(stream);
    const analyser = this.ctx.createAnalyser();
    analyser.fftSize = 512;
    source.connect(analyser);
    this.entries.set(id, {
      analyser,
      source,
      data: new Float32Array(analyser.fftSize),
      speaking: false,
    });
  }

  remove(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    entry.source.disconnect();
    this.entries.delete(id);
    if (entry.speaking) this.onChange(id, false);
  }

  private poll(): void {
    for (const [id, entry] of this.entries) {
      entry.analyser.getFloatTimeDomainData(entry.data);
      let sum = 0;
      for (let i = 0; i < entry.data.length; i++) sum += entry.data[i] * entry.data[i];
      const rms = Math.sqrt(sum / entry.data.length);
      const speaking = rms > RMS_THRESHOLD;
      if (speaking !== entry.speaking) {
        entry.speaking = speaking;
        this.onChange(id, speaking);
      }
    }
  }

  destroy(): void {
    clearInterval(this.interval);
    for (const id of [...this.entries.keys()]) this.remove(id);
    void this.ctx.close();
  }
}
