import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

// Exercise the real main-app dispatcher, not a parallel navigation model.
const source = await readFile('public/app.js', 'utf8');
const dispatcher = source.slice(source.indexOf('async function action(button) {'), source.indexOf('document.addEventListener("click", async (e) => {'));
function harness() {
  const state = { view: 'command-deck', event: { id: 'event' }, session: { user: { id: 'owner' } } };
  const calls = [];
  const context = { state, commandDeck: { reset() { calls.push('clear'); }, async action() { return false; } },
    pendingSignout: () => false, toast() {},
    kit: { async action(button) { if (!button.dataset.action.startsWith('kit-')) return false; calls.push(`kit:${state.view}`); return true; } },
    async loadEvents() { calls.push('events'); state.view = 'events'; },
    async checkConnection() { calls.push('connection'); },
  };
  for (const name of ['install','field','exchanges','sharing','story','trace','economy','oaths','sigil','signals','stagehand','adventure','adventureOrganizer','characters','admin']) context[name] = { async action(button) { return name === 'install' && button.dataset.action.startsWith('install-'); } };
  vm.createContext(context);
  vm.runInContext(`${dispatcher}\nglobalThis.invoke = action;`, context);
  return { state, calls, invoke: name => context.invoke({ dataset: { action: name } }) };
}
test('display and install controls do not discard the checked organizer deck', async () => {
  const h = harness();
  for (const action of ['kit-collapse','kit-fullscreen','install-help','install-check']) await h.invoke(action);
  assert.equal(h.state.view, 'command-deck');
  assert.equal(h.calls.filter(x => x === 'clear').length, 0);
});
test('switching presentation audience closes the private deck before rendering Player or Prop view', async () => {
  const h = harness(); await h.invoke('kit-view');
  assert.deepEqual(h.calls, ['clear','kit:detail']);
  assert.equal(h.state.view, 'detail');
});
test('leaving for the event list clears the deck while connectivity checks retain the workspace', async () => {
  const h = harness(); await h.invoke('connection-check');
  assert.deepEqual(h.calls, ['connection']);
  await h.invoke('events');
  assert.deepEqual(h.calls, ['connection','clear','events']);
  assert.equal(h.state.view, 'events');
});
