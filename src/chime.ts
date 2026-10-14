const NOTES_HZ = [660, 880, 1320];
const NOTE_S = 0.16;
const DECAY_S = NOTE_S * 1.8;

/** A short rising three-note chime, synthesised so there is no file to load. */
export async function playChime(): Promise<void> {
  const context = new AudioContext();
  await context.resume();
  const start = context.currentTime + 0.05;
  NOTES_HZ.forEach((hz, i) => {
    const t0 = start + i * NOTE_S;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = hz;
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(0.4, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + DECAY_S);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(t0);
    oscillator.stop(t0 + DECAY_S);
  });
  const totalMs = (0.05 + (NOTES_HZ.length - 1) * NOTE_S + DECAY_S) * 1000 + 100;
  await new Promise((resolve) => setTimeout(resolve, totalMs));
  await context.close();
}
