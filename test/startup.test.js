import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createStartupUI } from '../public/startup.js';
import { createKitUI } from '../public/builder.js';
import { THEMES } from '../public/kit.js';

const displaySource = await readFile(new URL('../public/display.js', import.meta.url), 'utf8');

function displayFixture(values = {}, denied = false) {
  const events = new Map();
  const root = { dataset: {}, style: { setProperty() {} } };
  const chrome = { content: '#0d1211' };
  const localStorage = {
    getItem: key => { if (denied) throw new Error('Storage denied'); return values[key] || null; },
    setItem: (key, value) => { values[key] = value; },
  };
  const document = { documentElement: root, querySelector: selector => selector.startsWith('meta[') ? chrome : null, addEventListener: (type, callback) => events.set(type, callback) };
  const window = { addEventListener() {} };
  return { document, window, localStorage, root, chrome, events, values };
}

test('early display script applies saved reading settings without waiting for app initialization', () => {
  const f = displayFixture({ 'oracle-display': 'outdoor', 'oracle-motion': 'reduce', 'oracle-controls': 'closed' });
  vm.runInNewContext(displaySource, f);
  assert.equal(f.root.dataset.display, 'outdoor');
  assert.equal(f.root.dataset.motion, 'reduce');
  assert.equal(f.root.dataset.controls, 'closed');
  assert.equal(f.chrome.content, '#ffffff');
  for (const fixture of [displayFixture(), displayFixture({ 'oracle-display': 'system', 'oracle-motion': 'wrong', 'oracle-controls': 'wrong' }), displayFixture({}, true)]) {
    vm.runInNewContext(displaySource, fixture);
    assert.deepEqual(fixture.root.dataset, { display: 'dark', motion: 'system', controls: 'open' });
    assert.equal(fixture.chrome.content, '#0d1211');
  }
});

test('runtime genre changes preserve Outdoor chrome and switching back to Dark restores the current genre', async t => {
  const f = displayFixture({ 'oracle-display': 'outdoor' });
  for (const key of ['document', 'window', 'localStorage']) {
    const before = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value: f[key] });
    t.after(() => before ? Object.defineProperty(globalThis, key, before) : delete globalThis[key]);
  }
  vm.runInNewContext(displaySource, f);
  const state = { view: 'detail', event: { setup: { theme: THEMES[0] } } };
  const kit = createKitUI({ state });
  for (const theme of THEMES) {
    state.event.setup.theme = theme;
    kit.apply();
    assert.equal(f.root.dataset.display, 'outdoor');
    assert.equal(f.chrome.content, '#ffffff');
    await f.events.get('change')({ target: { dataset: { preference: 'display' }, value: 'dark' } });
    assert.equal(f.chrome.content, theme.tokens.background);
    assert.equal(f.values['oracle-display'], 'dark');
    await f.events.get('change')({ target: { dataset: { preference: 'display' }, value: 'outdoor' } });
    assert.equal(f.chrome.content, '#ffffff');
  }
});

function startupFixture() {
  const listeners = new Map();
  const attributes = {};
  let frame, focused = 0, dialog = null, hasFocus = true;
  const body = {}, root = {};
  const app = { setAttribute: (name, value) => { attributes[name] = value; } };
  const status = { dataset: { state: 'opening' }, textContent: 'Opening your field kit…' };
  const target = { isConnected: true, setAttribute: (name, value) => { attributes[`heading-${name}`] = value; }, focus: options => { focused++; document.activeElement = target; assert.equal(options.preventScroll, true); } };
  const document = {
    body, documentElement: root, activeElement: body,
    hasFocus: () => hasFocus,
    querySelector: selector => ({ '#app': app, '#startup-status': status, 'dialog[open]': dialog, '#main h1, #main h2, #main': target })[selector] || null,
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type, callback) => { assert.equal(listeners.get(type), callback); listeners.delete(type); },
  };
  const window = { requestAnimationFrame: callback => { frame = callback; } };
  return {
    document, window, status, attributes, listeners,
    start: () => createStartupUI({ document, window }),
    flush: () => { const callback = frame; frame = null; callback?.(); },
    dispatch: type => listeners.get(type)?.(),
    focused: () => focused,
    setDialog: () => { dialog = { open: true }; },
    setBackground: () => { hasFocus = false; },
  };
}

test('startup announces completion outside the app and focuses the mounted heading once', () => {
  const f = startupFixture(), ui = f.start();
  assert.equal(f.attributes['aria-busy'], 'true');
  ui.finish({ signedIn: true });
  assert.equal(f.attributes['aria-busy'], 'false');
  assert.equal(f.status.textContent, 'Your field kit is ready.');
  assert.equal(f.focused(), 0);
  f.flush();
  assert.equal(f.focused(), 1);
  assert.equal(f.attributes['heading-tabindex'], '-1');
  assert.equal(f.listeners.size, 0);
  ui.finish({ error: true }); f.flush();
  assert.equal(f.focused(), 1);
  assert.equal(f.status.dataset.state, 'ready');
});

test('signed-out, offline, and failed startup release busy state and announce the available destination', () => {
  for (const [options, state, message] of [[{}, 'ready', /Sign-in/], [{ offline: true }, 'offline', /Saved readings.*require a connection/], [{ error: true }, 'error', /could not finish opening.*Reload/]]) {
    const f = startupFixture(), ui = f.start();
    ui.finish(options); f.flush();
    assert.equal(f.attributes['aria-busy'], 'false');
    assert.equal(f.status.dataset.state, state);
    assert.match(f.status.textContent, message);
    assert.equal(f.focused(), 1);
  }
});

test('startup preserves deliberate interaction before initialization, while loading, and before the next frame', () => {
  for (const timing of ['before', 'during', 'frame']) {
    for (const type of ['pointerdown', 'keydown', 'focusin']) {
      const f = startupFixture();
      if (timing === 'before') f.document.activeElement = { isConnected: true };
      const ui = f.start();
      if (timing === 'during') {
        if (type === 'focusin') f.document.activeElement = { isConnected: true };
        f.dispatch(type);
        f.document.activeElement = f.document.body;
      }
      ui.finish();
      if (timing === 'frame') {
        if (type === 'focusin') f.document.activeElement = { isConnected: true };
        f.dispatch(type);
        f.document.activeElement = f.document.body;
      }
      f.flush();
      assert.equal(f.focused(), 0, `${timing}: ${type}`);
      assert.equal(f.listeners.size, 0);
    }
  }
});

test('startup does not move focus out of a deep-link dialog, form field, or background tab', () => {
  for (const destination of ['dialog', 'form', 'background']) {
    const f = startupFixture(), ui = f.start();
    if (destination === 'dialog') f.setDialog();
    if (destination === 'form') f.document.activeElement = { isConnected: true };
    if (destination === 'background') f.setBackground();
    ui.finish(); f.flush();
    assert.equal(f.focused(), 0, destination);
    assert.equal(f.status.dataset.state, 'ready');
  }
});
