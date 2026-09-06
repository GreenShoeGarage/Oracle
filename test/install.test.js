import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstallUI, SHELL_VERSION } from '../public/install.js';

function fixture(t, options = {}) {
  const events = new Map(), workerEvents = new Map();
  const calls = { reload: 0, confirm: [], apply: 0, register: 0, prompt: 0, update: 0 };
  let allow = true;
  class LocalChannel {
    constructor() {
      this.port1 = { close() {}, onmessage: null };
      this.port2 = { postMessage: data => queueMicrotask(() => this.port1.onmessage?.({ data })), close() {} };
    }
  }
  const worker = version => ({ state: 'activated', addEventListener() {}, postMessage(data, ports) {
    if (data.type === 'ORACLE_APPLY_UPDATE') calls.apply++;
    ports[0].postMessage({ ok: options.incomplete !== true, version }); ports[0].close();
  } });
  const active = worker(SHELL_VERSION), next = worker('1.2.0');
  const registration = { active, waiting: options.waiting ? next : null, installing: null, addEventListener() {}, update: async () => { calls.update++; await options.update?.(); } };
  const serviceWorker = { controller: active, addEventListener: (name, fn) => workerEvents.set(name, fn), register: async () => { calls.register++; return options.failFirst && calls.register === 1 ? Promise.reject(new Error('Offline')) : registration; } };
  const values = {
    navigator: { onLine: true, serviceWorker }, isSecureContext: true, MessageChannel: LocalChannel,
    window: { matchMedia: () => ({ matches: false }), addEventListener: (name, fn) => events.set(name, fn), location: { reload: () => { calls.reload++; } }, confirm: message => { calls.confirm.push(message); return allow; } },
  };
  for (const [name, value] of Object.entries(values)) {
    const prior = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
    t.after(() => prior ? Object.defineProperty(globalThis, name, prior) : delete globalThis[name]);
  }
  const ui = createInstallUI({ getDirty: () => true, confirmDiscard: options.guard || (() => true) });
  t.after(() => ui.reset());
  return { ui, calls, events, registration, serviceWorker, next, deny: () => { allow = false; }, change: async () => {
    registration.waiting = null; serviceWorker.controller = next; workerEvents.get('controllerchange')();
    await new Promise(resolve => setImmediate(resolve));
  } };
}

test('another tab activating an update never reloads this tab or applies it automatically', async t => {
  const f = fixture(t); await f.ui.init();
  await f.change();
  assert.equal(f.calls.reload, 0); assert.equal(f.calls.apply, 0); assert.equal(f.calls.confirm.length, 0);
  assert.match(f.ui.render(), /App update ready/);
});

test('only explicit confirmed update activation reloads this tab', async t => {
  const f = fixture(t, { waiting: true }); await f.ui.init();
  assert.equal(f.calls.apply, 0);
  await f.ui.action('install-update');
  assert.equal(f.calls.confirm.length, 1);
  assert.match(f.calls.confirm[0], /Unsaved forms/); assert.match(f.calls.confirm[0], /Saved Field desk notes and queued requests stay/);
  assert.equal(f.calls.apply, 1); assert.equal(f.calls.reload, 0);
  await f.change(); assert.equal(f.calls.reload, 1);
});

test('cancelled confirmation and in-flight-save guard prevent update application', async t => {
  const f = fixture(t, { waiting: true }); await f.ui.init(); f.deny();
  await f.ui.action('install-update'); assert.equal(f.calls.apply, 0); assert.equal(f.calls.reload, 0);
  const blocked = createInstallUI({ getDirty: () => true, confirmDiscard: async () => false }); t.after(() => blocked.reset());
  await blocked.init(); await blocked.action('install-update');
  assert.equal(f.calls.confirm.length, 1); assert.equal(f.calls.apply, 0);
});

test('install prompt waits for a user action and failed registration can retry', async t => {
  const f = fixture(t, { failFirst: true });
  assert.equal(await f.ui.init(), null); assert.equal(await f.ui.init(), f.registration); assert.equal(f.calls.register, 2);
  let prevented = false;
  f.events.get('beforeinstallprompt')({ preventDefault: () => { prevented = true; }, prompt: async () => { f.calls.prompt++; }, userChoice: Promise.resolve({ outcome: 'accepted' }) });
  assert.equal(prevented, true); assert.equal(f.calls.prompt, 0);
  await f.ui.action('install-open'); assert.equal(f.calls.prompt, 1);
});

test('an update check keeps its button focusable while ignoring repeated activation', async t => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const f = fixture(t, { update: () => pending });
  await f.ui.init();
  const check = f.ui.action('install-check');
  await new Promise(resolve => setImmediate(resolve));
  const button = f.ui.render().match(/<button[^>]*data-action="install-check"[^>]*>/)[0];
  assert.match(button, /aria-disabled="true"/); assert.match(button, /aria-busy="true"/);
  assert.doesNotMatch(button, /\sdisabled(?:\s|>)/);
  await f.ui.action('install-check');
  assert.equal(f.calls.update, 1);
  finish(); await check;
  assert.match(f.ui.render(), /data-action="install-check" aria-disabled="false" aria-busy="false"/);
  assert.equal(f.calls.apply, 0); assert.equal(f.calls.reload, 0);
});


test('field preparation verifies the running public shell instead of inferring readiness from installation', async t => {
  const f = fixture(t); await f.ui.init();
  assert.equal(await f.ui.verifyOfflineReady(), true);
  assert.equal(f.ui.offlineReady, true);
});

test('an incomplete waiting shell cannot report the device ready for the field', async t => {
  const f = fixture(t, { waiting: true, incomplete: true }); await f.ui.init();
  assert.equal(await f.ui.verifyOfflineReady(), false);
  assert.equal(f.ui.offlineReady, false);
  assert.doesNotMatch(f.ui.render(), /Complete public app available offline/);
});
