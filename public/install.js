import { registerOfflineShell } from './offline.js';

export const SHELL_VERSION = '1.0.0';

/** Public install/update controls. They never reload another tab or transmit game actions. */
export function createInstallUI({ getDirty = () => false, confirmDiscard = () => true, onChange = () => {}, toast = () => {} } = {}) {
  let registration = null, registering = null, promptEvent = null, helpOpen = false, panelOpen = null, applying = false, checking = false, applyTimer = null;
  let offlineReady = false, availableVersion = null, reloadDeadline = 0, status = '', installed = Boolean(navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches);
  const supported = () => Boolean(navigator.serviceWorker && typeof isSecureContext !== 'undefined' && isSecureContext);
  const waiting = () => registration?.waiting || null;
  const needsUpdate = () => Boolean(waiting() || availableVersion && availableVersion !== SHELL_VERSION);
  const changed = () => { try { onChange(); } catch { /* The controls may not be mounted during startup. */ } };
  const escaped = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
  async function message(worker, data, timeout = 5000) {
    if (!worker || typeof MessageChannel === 'undefined') return { ok: false, reason: 'unavailable' };
    return new Promise(resolve => {
      const channel = new MessageChannel(); let finished = false;
      const finish = value => { if (finished) return; finished = true; clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), timeout);
      channel.port1.onmessage = event => finish(event.data || { ok: false });
      try { worker.postMessage(data, [channel.port2]); } catch { finish({ ok: false, reason: 'unavailable' }); }
    });
  }
  async function bind(worker = navigator.serviceWorker?.controller) {
    const result = await message(worker, { type: 'ORACLE_CLIENT_VERSION', version: SHELL_VERSION });
    if (result.ok) { offlineReady = true; if (result.version !== SHELL_VERSION) availableVersion = result.version; }
    changed(); return result;
  }
  function watch(worker) {
    if (!worker) return;
    const inspect = () => {
      if (['installed', 'activated'].includes(worker.state)) {
        offlineReady = true;
        if (registration?.waiting) void bind(registration.waiting);
        status = registration?.waiting ? 'An update is ready. Apply it when your group can pause.' : 'The complete public app is available offline.';
        changed();
      } else if (worker.state === 'redundant') { status = 'The app update did not complete. Reconnect and check again; the current app stays in place.'; changed(); }
    };
    worker.addEventListener('statechange', inspect); inspect();
  }
  async function init() {
    if (registering) return registering;
    registering = (async () => {
      registration = await registerOfflineShell();
      if (!registration) { status = 'Use this site in a secure browser tab. Saved device data depends on available browser storage.'; changed(); return null; }
      registration.addEventListener('updatefound', () => watch(registration.installing));
      watch(registration.installing); if (registration.waiting) { offlineReady = true; await bind(registration.waiting); }
      else if (navigator.serviceWorker.controller) await bind();
      changed(); return registration;
    })();
    const result = await registering;
    if (!result) registering = null;
    return result;
  }
  async function applyUpdate() {
    if (applying || !needsUpdate()) return;
    if (navigator.onLine === false) { toast('Reconnect before applying an app update.'); return; }
    const hasDraft = Boolean(getDirty());
    if (!await confirmDiscard()) return;
    if (!window.confirm(`Apply the ready app update and reload this tab?${hasDraft ? ' Unsaved forms and unsubmitted answers will be lost.' : ''} Saved Field desk notes and queued requests stay on this device. Finish any active camera scan or group procedure first. Other ORACLE tabs will keep their current app version.`)) return;
    const worker = waiting();
    if (!worker) { window.location.reload(); return; }
    applying = true; reloadDeadline = Date.now() + 10000; status = 'Preparing the update for this tab…'; changed();
    const result = await message(worker, { type: 'ORACLE_APPLY_UPDATE', clientVersion: SHELL_VERSION });
    if (!result.ok) {
      applying = false; reloadDeadline = 0;
      status = result.reason === 'other-tabs' ? 'Close older ORACLE tabs, then apply this update again. Their unsaved work has not been reloaded.' : 'The complete update could not be confirmed. Reconnect and check again.';
      toast(status); changed(); return;
    }
    availableVersion = result.version;
    clearTimeout(applyTimer);
    applyTimer = setTimeout(() => { if (applying) { applying = false; reloadDeadline = 0; status = 'The update is ready. Apply it again when you are ready to reload this tab.'; changed(); } }, 11000);
  }
  async function action(button) {
    const name = typeof button === 'string' ? button : button?.dataset?.action;
    if (!name?.startsWith('install-')) return false;
    if (name === 'install-open') {
      if (promptEvent) {
        const event = promptEvent; promptEvent = null; changed();
        try { await event.prompt(); const choice = await event.userChoice; status = choice?.outcome === 'accepted' ? 'Installation was requested. Look for ORACLE in your apps.' : 'You can install later from your browser menu.'; } catch { status = 'Use your browser menu to install ORACLE or add it to your home screen.'; }
      } else helpOpen = true;
      changed();
    } else if (name === 'install-help') { helpOpen = true; changed(); }
    else if (name === 'install-close-help') { helpOpen = false; changed(); }
    else if (name === 'install-update') await applyUpdate();
    else if (name === 'install-check') {
      if (checking) return true;
      if (navigator.onLine === false) { toast('Reconnect to check for an app update.'); return true; }
      checking = true; status = 'Checking for a complete app update…'; changed();
      let timer;
      try { const current = await init(); if (current) await Promise.race([current.update(), new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('The update check timed out. Try again on a stronger connection.')), 10000); })]); status = waiting() ? 'An update is ready. Apply it when your group can pause.' : 'Update check requested. ORACLE will show a ready update after all public assets are downloaded.'; }
      catch (error) { status = error.message || 'The app update could not be checked.'; }
      finally { clearTimeout(timer); checking = false; changed(); }
    }
    return true;
  }
  function render() {
    return `<details class="install-controls" data-oracle-install ${(panelOpen ?? (helpOpen || needsUpdate())) ? 'open' : ''}><summary>${needsUpdate() ? 'App update ready' : installed ? 'ORACLE app' : 'Install ORACLE'}</summary><div class="install-options" aria-label="Install and update ORACLE"><p><strong>ORACLE · LARP Field Kit</strong></p><p class="hint">${offlineReady ? 'Complete public app available offline. Live actions still need a connection; only saved readings, Field desk notes, and explicitly queued information requests are kept.' : 'Open ORACLE while connected to prepare the complete offline app. Only explicitly saved device data is available without a connection.'}</p>${!installed ? `<button type="button" data-action="install-open">${promptEvent ? 'Install ORACLE' : 'How to install'}</button>` : ''}${needsUpdate() ? `<button type="button" class="primary" data-action="install-update" aria-disabled="${applying}" aria-busy="${applying}">${applying ? 'Preparing update…' : 'Apply update and reload this tab'}</button>` : ''}<button type="button" data-action="install-check" aria-disabled="${checking}" aria-busy="${checking}" ${!supported() ? 'disabled' : ''}>Check for app updates</button>${helpOpen ? '<p class="hint">On Android or desktop, use the browser’s Install app command. On iPhone or iPad, open ORACLE in Safari, use Share, then Add to Home Screen. Browser wording and support may vary.</p><button type="button" class="quiet" data-action="install-close-help">Close install instructions</button>' : '<button type="button" class="quiet" data-action="install-help">Install instructions</button>'}${status ? `<p class="hint" role="status">${escaped(status)}</p>` : ''}</div></details>`;
  }
  function refresh(target) {
    const previous = target.querySelector('[data-oracle-install]');
    if (previous) panelOpen = previous.open;
    const active = target.ownerDocument?.activeElement;
    const restoreFocus = Boolean(active && target.contains(active));
    const actionName = restoreFocus ? active.dataset?.action : null;
    const scrollTop = target.querySelector('.install-options')?.scrollTop || 0;
    target.innerHTML = render();
    if (restoreFocus) {
      // Keep keyboard position when a button's label changes or instructions close.
      const replacementAction = actionName === 'install-help' && helpOpen ? 'install-close-help' : actionName === 'install-close-help' && !helpOpen ? 'install-help' : actionName;
      const button = [...target.querySelectorAll('button[data-action]')].find(item => item.dataset.action === replacementAction && !item.disabled);
      (button || target.querySelector('summary'))?.focus({ preventScroll: true });
    }
    const options = target.querySelector('.install-options');
    if (options) options.scrollTop = scrollTop;
  }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; changed(); });
  window.addEventListener('appinstalled', () => { installed = true; promptEvent = null; status = 'ORACLE is installed.'; changed(); });
  navigator.serviceWorker?.addEventListener('controllerchange', () => {
    const requested = applying && Date.now() <= reloadDeadline;
    void bind().then(async () => {
      if (requested && applying && Date.now() <= reloadDeadline && await confirmDiscard()) { clearTimeout(applyTimer); applying = false; reloadDeadline = 0; window.location.reload(); }
      else { clearTimeout(applyTimer); applying = false; reloadDeadline = 0; status = 'A complete app update is available. Apply it when you are ready; this tab has kept its current version.'; changed(); }
    });
  });
  return { init, render, refresh, action, reset() { clearTimeout(applyTimer); applying = false; reloadDeadline = 0; helpOpen = false; panelOpen = null; }, get registration() { return registration; } };
}
