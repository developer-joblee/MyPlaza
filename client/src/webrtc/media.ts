let micStream: MediaStream | null = null;

export async function initMic(): Promise<MediaStream | null> {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    return micStream;
  } catch (err) {
    console.warn('Microfone indisponível:', err);
    return null;
  }
}

export function getMicStream(): MediaStream | null {
  return micStream;
}

export function setMicEnabled(enabled: boolean): void {
  micStream?.getAudioTracks().forEach((t) => (t.enabled = enabled));
}

export function stopMic(): void {
  micStream?.getTracks().forEach((t) => t.stop());
  micStream = null;
}
