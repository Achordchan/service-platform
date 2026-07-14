"use client";

let audioContext: AudioContext | null = null;
let lastPlayedAt = 0;
let unlockBound = false;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  const Context =
    window.AudioContext ||
    (window as Window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Context) return null;
  if (!audioContext) {
    audioContext = new Context();
  }
  return audioContext;
}

/** Browsers keep AudioContext suspended until a user gesture. */
export function unlockUiSound() {
  if (typeof window === "undefined") return;
  const context = getAudioContext();
  if (!context) return;
  if (context.state === "suspended") {
    void context.resume();
  }
}

export function bindUiSoundUnlock() {
  if (typeof window === "undefined" || unlockBound) return;
  unlockBound = true;
  const unlock = () => {
    unlockUiSound();
  };
  window.addEventListener("pointerdown", unlock, { capture: true });
  window.addEventListener("keydown", unlock, { capture: true });
  window.addEventListener("touchstart", unlock, { capture: true });
}

function playViaOscillator(context: AudioContext) {
  const start = context.currentTime + 0.01;
  const master = context.createGain();
  // Slightly louder than before so laptop speakers can hear it.
  master.gain.setValueAtTime(0.0001, start);
  master.gain.exponentialRampToValueAtTime(0.09, start + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, start + 0.38);
  master.connect(context.destination);

  for (const [offset, frequency] of [
    [0, 880],
    [0.09, 1318.5],
  ] as const) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(frequency, start + offset);
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(1, start + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.2);
    oscillator.connect(gain);
    gain.connect(master);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.22);
  }
}

/** Soft chime for live request updates. */
export function playRequestUpdateSound() {
  if (typeof window === "undefined") return;

  const now = Date.now();
  if (now - lastPlayedAt < 800) return;
  lastPlayedAt = now;

  const context = getAudioContext();
  if (!context) return;

  const run = () => {
    try {
      playViaOscillator(context);
    } catch {
      // Ignore audio device races.
    }
  };

  if (context.state === "suspended") {
    void context
      .resume()
      .then(() => {
        if (context.state === "running") run();
      })
      .catch(() => undefined);
    return;
  }

  run();
}
