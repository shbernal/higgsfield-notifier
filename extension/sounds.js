// sounds.js — the shared sound bank. Loaded by BOTH the content watcher and the popup
// (as the first content script, and via <script> in popup.html), so a preview in the
// popup is byte-for-byte the same tone you'll hear when a real generation lands.
//
// Each generation type gets its own short, recognizable "complete" motif. Failure has
// one universal buzz on purpose — a fail should always sound like a fail, whatever type
// it was. Everything is synthesized with Web Audio (no audio files to ship or decode).

(function () {
  // one note: exponential attack/decay envelope on a single oscillator
  function beep(ctx, freq, start, dur, vol, wave) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = wave || "sine";
    o.frequency.value = freq;
    o.connect(g);
    g.connect(ctx.destination);
    const t = ctx.currentTime + start;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.04);
  }

  // COMPLETE motifs — chosen to be easy to tell apart by ear:
  const COMPLETE = {
    // video  — rising cinematic triad (C–E–G), warm triangle: "reveal / roll film"
    video: (c) => {
      beep(c, 523.25, 0.0, 0.12, 0.1, "triangle");
      beep(c, 659.25, 0.1, 0.12, 0.1, "triangle");
      beep(c, 783.99, 0.2, 0.22, 0.11, "triangle");
    },
    // image  — crisp high double-blip, snappy like a shutter confirm
    image: (c) => {
      beep(c, 1046.5, 0.0, 0.07, 0.09, "triangle");
      beep(c, 1396.91, 0.08, 0.13, 0.1, "triangle");
    },
    // audio  — mellow perfect fifth (D–A), rounded sine: musical / "sound"
    audio: (c) => {
      beep(c, 587.33, 0.0, 0.16, 0.1, "sine");
      beep(c, 880.0, 0.14, 0.26, 0.1, "sine");
    },
    // 3d     — low-rooted climb (E–B–E), starts deep to feel solid / dimensional
    "3d": (c) => {
      beep(c, 329.63, 0.0, 0.14, 0.11, "sine");
      beep(c, 493.88, 0.12, 0.12, 0.1, "sine");
      beep(c, 659.25, 0.22, 0.22, 0.1, "triangle");
    },
    // other  — the classic neutral two-note rise
    other: (c) => {
      beep(c, 660.0, 0.0, 0.13, 0.1, "sine");
      beep(c, 988.0, 0.12, 0.2, 0.1, "sine");
    },
  };

  // FAIL — one unmistakable descending buzz, harsher sawtooth timbre
  function fail(c) {
    beep(c, 300, 0.0, 0.17, 0.13, "sawtooth");
    beep(c, 225, 0.15, 0.26, 0.13, "sawtooth");
  }

  function play(ctx, kind, type) {
    if (!ctx) return;
    if (kind === "fail") {
      fail(ctx);
      return;
    }
    (COMPLETE[type] || COMPLETE.other)(ctx);
  }

  window.HFSounds = { play, beep, COMPLETE, fail };
})();
