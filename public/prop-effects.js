let owner = null;

/** Presentation only. Every privileged action still requires server authorization. */
export function createPropEffects() {
  let active = false, sound = false, context = null, voice = null, generation = 0;
  function silence() {
    generation++;
    try { voice?.stop(); } catch { /* A completed tone is already silent. */ }
    voice = null;
    const previous = context; context = null;
    if (previous && previous.state !== 'closed') void previous.close().catch(() => {});
  }
  function exit() {
    const wasOwner = owner === controls;
    active = false; sound = false; silence();
    if (wasOwner) {
      owner = null;
      document.body.classList.remove('oracle-prop-focus');
      delete document.body.dataset.oraclePropKind;
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    }
  }
  function enter(kind) {
    if (!['sigil', 'static'].includes(kind)) throw new Error('Unsupported prop presentation.');
    if (owner && owner !== controls) owner.exit();
    if (!active) { sound = false; silence(); }
    owner = controls; active = true;
    document.body.classList.add('oracle-prop-focus');
    document.body.dataset.oraclePropKind = kind;
  }
  async function fullscreen() {
    if (!active) return false;
    if (!document.documentElement.requestFullscreen) return false;
    try { await document.documentElement.requestFullscreen(); return true; } catch { return false; }
  }
  async function toggleSound() {
    if (!active || document.hidden) return false;
    if (sound) { sound = false; silence(); return false; }
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    const token = ++generation;
    try {
      context = new Audio(); const opening = context;
      await opening.resume();
      if (token !== generation || !active || document.hidden) { if (opening.state !== 'closed') void opening.close().catch(() => {}); return false; }
      sound = true; cue('ready'); return true;
    } catch { sound = false; silence(); return false; }
  }
  function cue(kind = 'checkpoint') {
    if (!active || !sound || document.hidden || !context || context.state !== 'running') return;
    try {
      try { voice?.stop(); } catch { /* A prior cue may already have ended. */ }
      const oscillator = context.createOscillator(), gain = context.createGain(), now = context.currentTime;
      voice = oscillator; oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(({ ready: 440, checkpoint: 660, success: 880, failure: 220, alert: 330, reading: 550 })[kind] || 550, now);
      gain.gain.setValueAtTime(0, now); gain.gain.linearRampToValueAtTime(0.06, now + 0.025); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(now); oscillator.stop(now + 0.25);
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); if (voice === oscillator) voice = null; };
    } catch { sound = false; silence(); }
  }
  const onVisibility = () => { if (document.hidden) { sound = false; silence(); } };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', exit);
  const controls = { enter, exit, fullscreen, toggleSound, cue, cleanup: exit, get active() { return active; }, get soundEnabled() { return sound; } };
  return controls;
}
