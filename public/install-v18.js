import { registerOfflineShell } from './offline.js';

export const SHELL_VERSION = '1.8.0';

export function createInstallUI({ getDirty = () => false, confirmDiscard = () => true, onChange = () => {}, toast = () => {} } = {}) {
  let registration = null, registering = null, promptEvent = null, helpOpen = false, panelOpen = null;
  let applying = false, checking = false, offlineReady = false, availableVersion = null, status = '', installed = Boolean(navigator.standalone || window.matchMedia?.('(display-mode: standalone)').matches);
  const waiting = () => registration?.waiting || null;
  const needsUpdate = () => Boolean(waiting() || availableVersion && availableVersion !== SHELL_VERSION);
  const changed = () => { try { onChange(); } catch {} };
  const escaped = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;' })[c]);
  async function message(worker, data, timeout = 5000) {
    if (!worker || typeof MessageChannel === 'undefined') return { ok:false, reason:'unavailable' };
    return new Promise(resolve => {
      const channel = new MessageChannel(); let done = false;
      const finish = value => { if (done) return; done = true; clearTimeout(timer); channel.port1.close(); resolve(value); };
      const timer = setTimeout(() => finish({ ok:false, reason:'timeout' }), timeout);
      channel.port1.onmessage = event => finish(event.data || { ok:false });
      try { worker.postMessage(data, [channel.port2]); } catch { finish({ ok:false, reason:'unavailable' }); }
    });
  }
  async function bind(worker = navigator.serviceWorker?.controller) {
    const result = await message(worker, { type:'ORACLE_CLIENT_VERSION', version:SHELL_VERSION });
    offlineReady = result.ok === true;
    if (result.ok && result.version !== SHELL_VERSION) availableVersion = result.version;
    changed(); return result;
  }
  function watch(worker) {
    if (!worker) return;
    const inspect = () => {
      if (['installed','activated'].includes(worker.state)) void bind(registration?.waiting || worker).then(result => {
        status = result.ok ? (registration?.waiting ? 'An update is ready. Apply it when your group can pause.' : 'The complete public app is available offline.') : 'Offline opening has not been verified. Keep ORACLE connected and check for updates.';
        changed();
      });
      else if (worker.state === 'redundant') { status = 'The app update did not complete. The current app remains available.'; changed(); }
    };
    worker.addEventListener('statechange', inspect); inspect();
  }
  async function init() {
    if (registering) return registering;
    registering = (async () => {
      registration = await registerOfflineShell();
      if (!registration) { status = 'Use ORACLE in a secure browser tab to enable offline installation.'; changed(); return null; }
      registration.addEventListener('updatefound', () => watch(registration.installing));
      watch(registration.installing);
      if (registration.waiting) await bind(registration.waiting); else if (navigator.serviceWorker.controller) await bind();
      changed(); return registration;
    })();
    const result = await registering; if (!result) registering = null; return result;
  }
  async function verifyOfflineReady() {
    try { if (!registration) await init(); return (await bind(navigator.serviceWorker?.controller || registration?.active || registration?.waiting)).ok === true; }
    catch { offlineReady = false; changed(); return false; }
  }
  async function applyUpdate() {
    if (applying || !needsUpdate()) return;
    if (navigator.onLine === false) return toast('Reconnect before applying an app update.');
    if (!await confirmDiscard()) return;
    if (!window.confirm(`Apply the ready ORACLE update and reload this tab?${getDirty() ? ' Unsaved forms and unsubmitted answers will be lost.' : ''} Saved Field desk notes, prepared materials, connection cards, arcs, and project snapshots remain on this device.`)) return;
    const worker = waiting();
    if (!worker) return window.location.reload();
    applying = true; status = 'Preparing the update for this tab…'; changed();
    const result = await message(worker, { type:'ORACLE_APPLY_UPDATE', clientVersion:SHELL_VERSION }, 10000);
    if (!result.ok) { applying = false; status = result.reason === 'other-tabs' ? 'Close older ORACLE tabs, then apply the update again.' : 'The update could not be confirmed. Reconnect and try again.'; toast(status); changed(); return; }
    availableVersion = result.version; status = 'Update ready. Reloading this tab…'; changed();
    window.location.reload();
  }
  async function action(button) {
    const name = typeof button === 'string' ? button : button?.dataset?.action;
    if (!name?.startsWith('install-')) return false;
    if (name === 'install-open') {
      if (promptEvent) { const event = promptEvent; promptEvent = null; try { await event.prompt(); const choice = await event.userChoice; status = choice?.outcome === 'accepted' ? 'Installation was requested.' : 'You can install later from your browser menu.'; } catch { status = 'Use your browser menu to install ORACLE.'; } }
      else helpOpen = true;
    } else if (name === 'install-help') helpOpen = true;
    else if (name === 'install-close-help') helpOpen = false;
    else if (name === 'install-update') await applyUpdate();
    else if (name === 'install-check') {
      if (checking) return true; if (navigator.onLine === false) { toast('Reconnect to check for an app update.'); return true; }
      checking = true; status = 'Checking for a complete app update…'; changed();
      try { const current = await init(); if (current) await current.update(); status = waiting() ? 'An update is ready.' : 'Update check requested.'; }
      catch (error) { status = error.message || 'The app update could not be checked.'; }
      finally { checking = false; changed(); }
    }
    changed(); return true;
  }
  function render() {
    return `<details class="install-controls" data-oracle-install ${(panelOpen ?? (helpOpen || needsUpdate())) ? 'open' : ''}><summary>${needsUpdate() ? 'App update ready' : installed ? 'ORACLE app' : 'Install ORACLE'}</summary><div class="install-options"><p><strong>ORACLE · LARP Field Kit</strong></p><p class="hint">${offlineReady ? 'Complete public app available offline. Prepared private materials and dated community-project snapshots remain separate from live shared state.' : 'Open ORACLE while connected to prepare the complete offline app. Only explicitly saved device data is available without a connection.'}</p>${!installed ? `<button type="button" data-action="install-open">${promptEvent ? 'Install ORACLE' : 'How to install'}</button>` : ''}${needsUpdate() ? `<button type="button" class="primary" data-action="install-update" ${applying?'disabled':''}>${applying?'Preparing update…':'Apply update and reload this tab'}</button>` : ''}<button type="button" data-action="install-check" ${checking?'disabled':''}>${checking?'Checking…':'Check for app updates'}</button>${helpOpen ? '<p class="hint">On Android or desktop, use the browser Install app command. On iPhone or iPad, open ORACLE in Safari, use Share, then Add to Home Screen.</p><button type="button" class="quiet" data-action="install-close-help">Close install instructions</button>' : '<button type="button" class="quiet" data-action="install-help">Install instructions</button>'}${status ? `<p class="hint" role="status">${escaped(status)}</p>` : ''}</div></details>`;
  }
  function refresh(target) { const previous = target.querySelector('[data-oracle-install]'); if (previous) panelOpen = previous.open; target.innerHTML = render(); }
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); promptEvent = event; changed(); });
  window.addEventListener('appinstalled', () => { installed = true; promptEvent = null; status = 'ORACLE is installed.'; changed(); });
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (applying) window.location.reload(); else void bind(); });
  return { init, render, refresh, action, verifyOfflineReady, reset(){ applying=false; checking=false; helpOpen=false; panelOpen=null; }, get registration(){ return registration; }, get offlineReady(){ return offlineReady; } };
}
