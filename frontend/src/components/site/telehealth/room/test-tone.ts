/** Hoparlör testi için kısa (0.6 sn) 440 Hz sinüs sesi — 16-bit mono PCM WAV (kütüphanesiz, kısık ses, yumuşak giriş/çıkış). */
export function buildToneWav(durationSec = 0.6, frequency = 440, sampleRate = 22_050): Uint8Array<ArrayBuffer> {
  const samples = Math.floor(durationSec * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const write = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, samples * 2, true);
  const fade = Math.floor(sampleRate * 0.05);
  for (let i = 0; i < samples; i += 1) {
    const envelope = Math.min(1, i / fade, (samples - i) / fade);
    const value = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.25 * envelope;
    view.setInt16(44 + i * 2, Math.round(value * 32767), true);
  }
  return new Uint8Array(buffer);
}

/** Test sesini (varsa) seçili çıkış cihazından çalar. */
export async function playTestTone(sinkId?: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([buildToneWav()], { type: "audio/wav" }));
  const audio = new Audio(url);
  const cleanup = () => URL.revokeObjectURL(url);
  audio.addEventListener("ended", cleanup, { once: true });
  try {
    const withSink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && typeof withSink.setSinkId === "function") await withSink.setSinkId(sinkId);
    await audio.play();
  } catch (error) {
    cleanup();
    throw error;
  }
}
