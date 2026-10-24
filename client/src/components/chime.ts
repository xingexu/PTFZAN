/** Two-note "ding" using Web Audio (no audio files). Browsers only allow it after a user interaction. */
export function chime(volume = 0.18) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    [880, 1320].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      const t0 = ctx.currentTime + i * 0.16;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      o.connect(g).connect(ctx.destination);
      o.start(t0);
      o.stop(t0 + 0.32);
    });
    setTimeout(() => ctx.close().catch(() => undefined), 1000);
  } catch {
    /* audio not available */
  }
}
