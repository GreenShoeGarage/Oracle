// Keep the announcement outside the replaced app and move focus only once,
// after startup and any deep-link dialog have finished opening.
export function createStartupUI({ document, window }) {
  const app = document.querySelector('#app');
  const status = document.querySelector('#startup-status');
  let finished = false;
  let interacted = false;
  const meaningfulFocus = () => {
    const active = document.activeElement;
    return active && active !== document.body && active !== document.documentElement && active.isConnected;
  };
  interacted = Boolean(meaningfulFocus());
  const onInteraction = () => { interacted = true; };
  const onFocus = () => { if (meaningfulFocus()) interacted = true; };
  document.addEventListener('pointerdown', onInteraction, true);
  document.addEventListener('keydown', onInteraction, true);
  document.addEventListener('focusin', onFocus, true);
  app?.setAttribute('aria-busy', 'true');

  function finish({ offline = false, error = false, signedIn = false } = {}) {
    if (finished) return;
    finished = true;
    app?.setAttribute('aria-busy', 'false');
    if (status) {
      status.dataset.state = error ? 'error' : offline ? 'offline' : 'ready';
      status.textContent = error ? 'ORACLE could not finish opening. Reload to try again.'
        : offline ? 'Saved readings are open. Live actions require a connection.'
          : signedIn ? 'Your field kit is ready.' : 'Sign-in is ready.';
    }
    window.requestAnimationFrame(() => {
      const mayFocus = !interacted && !meaningfulFocus() && !document.querySelector('dialog[open]')
        && (typeof document.hasFocus !== 'function' || document.hasFocus());
      document.removeEventListener('pointerdown', onInteraction, true);
      document.removeEventListener('keydown', onInteraction, true);
      document.removeEventListener('focusin', onFocus, true);
      if (!mayFocus) return;
      const target = document.querySelector('#main h1, #main h2, #main');
      if (target) {
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }
  return { finish };
}
