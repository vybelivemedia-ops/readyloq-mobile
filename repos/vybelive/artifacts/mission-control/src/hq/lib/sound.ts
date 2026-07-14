/**
 * Lightweight WebAudio ambience + UI blips for the headquarters. Generated
 * procedurally (no asset files). Muted by default; only starts on explicit
 * user opt-in, satisfying browser autoplay policies.
 */
let ctx: AudioContext | null = null;
let ambientGain: GainNode | null = null;
let started = false;

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function startAmbient() {
  const ac = ensureCtx();
  if (!ac || started) {
    if (ac && ambientGain) ambientGain.gain.setTargetAtTime(0.06, ac.currentTime, 0.5);
    return;
  }
  started = true;
  void ac.resume();

  // Low warm hum (two detuned oscillators through a lowpass).
  const master = ac.createGain();
  master.gain.value = 0.0;
  master.connect(ac.destination);
  ambientGain = master;

  const filter = ac.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 320;
  filter.connect(master);

  [55, 82.4, 110].forEach((freq, i) => {
    const osc = ac.createOscillator();
    osc.type = i === 2 ? "triangle" : "sine";
    osc.frequency.value = freq;
    const g = ac.createGain();
    g.gain.value = i === 2 ? 0.12 : 0.3;
    osc.connect(g);
    g.connect(filter);
    osc.start();
  });

  // Slow shimmer LFO on the filter for a "breathing" energy feel.
  const lfo = ac.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 120;
  lfo.connect(lfoGain);
  lfoGain.connect(filter.frequency);
  lfo.start();

  master.gain.setTargetAtTime(0.06, ac.currentTime, 1.2);
}

export function stopAmbient() {
  const ac = ensureCtx();
  if (ac && ambientGain) ambientGain.gain.setTargetAtTime(0.0, ac.currentTime, 0.4);
}

export function blip(kind: "enter" | "exit" | "select" = "select") {
  const ac = ensureCtx();
  if (!ac || !started) return;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  const base = kind === "enter" ? 660 : kind === "exit" ? 330 : 880;
  osc.type = "sine";
  osc.frequency.setValueAtTime(base, ac.currentTime);
  osc.frequency.exponentialRampToValueAtTime(base * (kind === "exit" ? 0.5 : 1.5), ac.currentTime + 0.12);
  g.gain.setValueAtTime(0.0001, ac.currentTime);
  g.gain.exponentialRampToValueAtTime(0.08, ac.currentTime + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.25);
  osc.connect(g);
  g.connect(ac.destination);
  osc.start();
  osc.stop(ac.currentTime + 0.3);
}
