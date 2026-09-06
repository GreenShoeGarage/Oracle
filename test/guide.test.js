import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEventGuide, renderEventGuide, renderWelcomeGuide } from '../public/guide-ui.js';
import { THEMES } from '../public/kit.js';

const event = { id: 'current-event', name: 'Test event', status: 'live', role: 'player', setup: { theme: THEMES[0] } };
const own = (status = 'approved') => ({ eventId: event.id, userId: 'current-account', visibility: 'private', status, profile: { name: 'PRIVATE character name', privateObjectives: 'PRIVATE objective' } });
const options = (characters, extra = {}) => ({ event, accountId: 'current-account', characterSnapshot: { eventId: event.id, accountId: 'current-account', characters, settings: { allowPlayerCreation: true, requireApproval: true } }, ...extra });

test('quick start never treats unknown, cross-event, cross-account, or public character data as approval', () => {
  for (const input of [
    { event, accountId: 'current-account' },
    options([own()], { characterSnapshot: { eventId: 'old-event', accountId: 'current-account', characters: [own()] } }),
    options([own()], { characterSnapshot: { eventId: event.id, accountId: 'old-account', characters: [own()] } }),
  ]) {
    const guide = buildEventGuide(input);
    assert.equal(guide.next.action.action, 'character-open');
    assert.equal(guide.next.title, 'Check your character');
  }
  const guide = buildEventGuide(options([{ ...own(), userId: 'someone-else' }, { ...own(), eventId: 'old-event' }, { ...own(), visibility: 'public' }, own('retired')]));
  assert.equal(guide.next.action.action, 'character-open');
  assert.notEqual(guide.steps[0].state, 'Checked');
  assert.equal(buildEventGuide({ event }), null);
});

test('player guidance follows checked character approval without revealing a private sheet', () => {
  for (const [status, title] of [['draft', 'Finish your character'], ['pending', 'Your character is awaiting approval'], ['changes_requested', 'Review the organizer’s feedback']]) {
    const guide = buildEventGuide(options([own(status)]));
    assert.equal(guide.next.title, title);
    assert.equal(guide.next.action.action, 'character-open');
  }
  const input = options([own(), own('pending')]);
  assert.equal(buildEventGuide(input).next.action.action, 'adv-open');
  assert.equal(buildEventGuide(input).steps[0].state, 'Checked');
  const html = renderEventGuide(input);
  assert.ok(!html.includes('PRIVATE'));
  assert.ok(!html.includes('current-account'));
});

test('manager player preview does not render organizer controls or infer approval from the rest of the roster', () => {
  const input = options([{ ...own(), userId: 'another-player' }], { isManager: true, audience: 'player', members: [{ user_id: 'another-player', display_name: 'PRIVATE roster name' }] });
  const model = buildEventGuide(input), html = renderEventGuide(input);
  assert.equal(model.mode, 'player');
  assert.equal(model.next.action.action, 'character-open');
  assert.ok(!html.includes('PRIVATE'));
  for (const action of ['advedit-open', 'invite', 'invitations', 'status', 'kit-edit']) assert.ok(!html.includes(`data-action="${action}"`));
  assert.equal(buildEventGuide({ ...input, audience: 'organizer', isManager: false }).mode, 'player');
  assert.equal(buildEventGuide({ ...input, audience: 'organizer' }).mode, 'organizer');
});

test('paused and finished events offer reading and review without starting play or issuing invitations', () => {
  for (const status of ['paused', 'ended', 'archived']) {
    const input = options([own()], { event: { ...event, status } });
    assert.equal(buildEventGuide(input).next.action.action, 'adv-open');
    assert.equal(buildEventGuide(input).steps[1].state, 'Read only');
    const html = renderEventGuide(input);
    assert.ok(!html.includes('data-action="status"'));
    if (status !== 'paused') {
      const organizer = renderEventGuide({ ...input, isManager: true, audience: 'organizer' });
      assert.ok(!organizer.includes('data-action="invite"'));
      assert.ok(organizer.includes('data-action="invitations"'));
    }
  }
});

test('guide uses theme terminology as escaped text and retains the same navigation in all three worlds', () => {
  for (const theme of THEMES) {
    const html = renderEventGuide(options([own()], { event: { ...event, setup: { theme } } }));
    assert.ok(html.includes(theme.name));
    assert.ok(html.includes(theme.terms.briefing));
    for (const action of ['character-open', 'adv-open', 'exchange-open', 'field-open']) assert.ok(html.includes(`data-action="${action}"`));
  }
  const hostile = renderEventGuide(options([], { event: { ...event, setup: { theme: { name: '<img onerror="bad">', terms: { briefing: '</p><script>bad</script>' } } } } }));
  assert.ok(!hostile.includes('<img'));
  assert.ok(!hostile.includes('<script>'));
  assert.ok(hostile.includes('&lt;img'));
  const welcome = renderWelcomeGuide();
  for (const action of ['join', 'advedit-starter', 'create', 'kit-import']) assert.ok(welcome.includes(`data-action="${action}"`));
  assert.ok(welcome.includes('<details'));
  assert.ok(!welcome.includes('data-action="status"'));
});
