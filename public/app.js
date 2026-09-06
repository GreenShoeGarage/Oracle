"use strict";
import { createKitUI } from "./builder.js";
import { createCharacterUI } from "./characters-ui.js";
import { createAdminUI } from "./admin-ui.js";
import { createAdventurePlayer } from "./adventure-player.js";
import { createAdventureOrganizer } from "./adventure-organizer.js";
import * as offline from "./offline.js";
import { createExchangeUI } from "./exchanges-ui.js";
import { createSharingUI } from "./sharing-ui.js";
import { createStoryUI } from "./story-ui.js";
import { createTraceUI } from "./trace-ui.js";
import { createEconomyUI } from "./economy-ui.js";
import { createOathUI } from "./oath-ui.js";
import { createSigilUI } from "./sigil-ui.js";
import { createStaticUI } from "./static-ui.js";
import { createStagehandUI } from "./stagehand-ui.js";
const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
const state = {
  session: null,
  events: [],
  view: "events",
  event: null,
  members: [],
  transitions: [],
  authMode: "login",
  busy: false,
};
let noticeTimer;
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const title = (v) => v.charAt(0).toUpperCase() + v.slice(1);
const date = (v) =>
  v
    ? new Date(v).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Not scheduled";
const isManager = () => state.session?.user?.isSuperuser || ["owner", "organizer", "superuser"].includes(state.event?.role);
const isOwner = () => state.session?.user?.isSuperuser || ["owner", "superuser"].includes(state.event?.role);
const badge = (v) => `<span class="badge ${esc(v)}">${esc(v)}</span>`;
const err = '<p class="error" role="alert"></p>';
const kit = createKitUI({ state, api, shell, esc: (v) => esc(v), openModal, closeModal, loadEvent, toast, isManager, err: '<p class="error" role="alert"></p>', render });
const characters = createCharacterUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, isOwner, err, render });
const admin = createAdminUI({ state, api, shell, esc, openModal, closeModal, toast, err, render });
const adventure = createAdventurePlayer({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, offline, openManager: () => adventureOrganizer.open() });
const adventureOrganizer = createAdventureOrganizer({ state, api, shell, esc, openModal, closeModal, loadEvent, loadEvents, toast, isManager, err, render, openPlayer: async (options) => { if (adventureOrganizer.confirmDiscard()) await adventure.open(options); } });
const exchanges = createExchangeUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, offline, openJournal: (characterId) => adventure.open({ characterId }) });
const sharing = createSharingUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render });
const story = createStoryUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => adventure.open({ characterId }), openExchanges: (characterId) => exchanges.open({ characterId }) });
const trace = createTraceUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => adventure.open({ characterId }), openExchanges: (characterId) => exchanges.open({ characterId }) });
const economy = createEconomyUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openExchanges: (characterId) => exchanges.open({ characterId }) });
const oaths = createOathUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openBazaar: (characterId, agreementId) => economy.open(state.event, true, characterId, agreementId) });
const sigil = createSigilUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => { sigil.reset(); return adventure.open({ characterId }); } });
const signals = createStaticUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => { signals.reset(); return adventure.open({ characterId }); } });
const stagehand = createStagehandUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openStory: () => story.open({ manage: true }), openAdventure: (options) => adventure.open(options) });
function resetPrivateViews() {
  adventure.reset();
  adventureOrganizer.reset();
  exchanges.reset();
  sharing.reset();
  story.reset();
  trace.reset();
  economy.reset();
  oaths.reset();
  sigil.reset();
  signals.reset();
  stagehand.reset();
}
function toast(message) {
  const el = document.querySelector("#notice");
  clearTimeout(noticeTimer);
  el.textContent = message;
  el.hidden = false;
  noticeTimer = setTimeout(() => {
    el.hidden = true;
  }, 5000);
}
async function api(path, method = "GET", data) {
  const requestedUserId = state.session?.user?.id;
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = response.status === 204 ? {} : await response.json();
  if (requestedUserId && requestedUserId !== state.session?.user?.id) {
    const error = new Error("The account changed. Open the event again to continue.");
    error.status = 409;
    throw error;
  }
  const responseAccount = response.headers.get("x-oracle-account");
  if (requestedUserId && responseAccount && responseAccount !== requestedUserId) {
    await offline.clearArchive().catch(() => {});
    resetPrivateViews();
    state.session.user = null;
    state.offlineArchive = null;
    state.event = null;
    state.events = [];
    state.view = "events";
    closeModal(true);
    render();
    const error = new Error("Your account changed in another tab. Sign in again to continue.");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 && state.session?.user) {
      state.session.user = null;
      await offline.clearArchive().catch(() => {});
      resetPrivateViews();
      state.event = null;
      state.events = [];
      state.offlineArchive = null;
      state.view = "events";
      closeModal(true);
      render();
    }
    if (response.status === 404 && ["Event not found or access has been removed.", "Character not found or not assigned to you."].includes(result.error)) {
      const eventId = path.match(/^\/api\/events\/([0-9a-f-]{36})(?:[/?]|$)/i)?.[1];
      if (eventId) {
        await offline.purgeEvent(eventId).catch(() => {});
        state.offlineArchive = null;
        if (result.error === "Event not found or access has been removed.") state.events = state.events.filter((event) => event.id !== eventId);
        if (state.event?.id === eventId) {
          resetPrivateViews();
          state.event = null;
          state.view = "events";
          closeModal(true);
          render();
        }
      }
    }
    const error = new Error(result.error || "Request failed. Please try again.");
    error.status = response.status;
    error.retryAfter = response.headers.get("retry-after");
    throw error;
  }
  return result;
}
function openModal(heading, content) {
  modalContent.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(heading)}</h2><button type="button" data-action="close" aria-label="Close dialog">×</button></div>${content}`;
  if (!modal.open) modal.showModal();
}
function closeModal(force = false) {
  if (!force && (!kit.confirmDiscard() || !characters.confirmDiscard() || !adventureOrganizer.confirmDiscard("modal") || !exchanges.confirmDiscard("modal") || !story.confirmDiscard("modal") || !trace.confirmDiscard("modal") || !economy.confirmDiscard("modal") || !oaths.confirmDiscard("modal") || !sigil.confirmDiscard("modal") || !signals.confirmDiscard("modal") || !stagehand.confirmDiscard("modal"))) return;
  adventure.cleanupModal();
  adventureOrganizer.cleanupModal();
  characters.cleanupModal();
  exchanges.cleanupModal();
  sharing.cleanupModal?.();
  story.cleanupModal?.();
  trace.cleanupModal?.();
  economy.cleanupModal?.();
  oaths.cleanupModal?.();
  sigil.cleanupModal?.();
  signals.cleanupModal?.();
  stagehand.cleanupModal?.();
  if (force) kit.resetDraft();
  modal.classList.remove("wide-modal");
  modal.close();
  modalContent.replaceChildren();
}
function setError(form, error) {
  const el = form.querySelector(".error");
  if (el) {
    el.textContent =
      error.message ||
      "Unable to connect. Check your connection and try again.";
    el.scrollIntoView({ block: "nearest" });
  } else toast(error.message || "Unable to connect.");
}
function auth() {
  kit.apply();
  const signup = state.authMode === "register";
  app.innerHTML = `<div class="auth-wrap"><section class="auth-intro"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><h1>Bring your people<br>into the story.</h1><p>Prepare an event, assemble your crew, and give your next world a place to begin.</p><p class="auth-footer">Green Shoe Garage · v${esc(state.session?.version || "0.9.0")}</p></section><main id="main" class="auth-form"><p class="eyebrow">Your field kit</p><h2>${signup ? "Create your account" : "Welcome back"}</h2><p>${signup ? "One account. A place in every world you join." : "Sign in to open your events."}</p><form id="auth-form">${err}${signup ? '<div><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="80" required autocomplete="nickname"><p class="hint">Shown to the people in your events.</p></div>' : ""}<div><label for="email">Email address</label><input id="email" name="email" type="email" maxlength="254" required autocomplete="email"></div><div><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="${signup ? "new-password" : "current-password"}">${signup ? '<p class="hint">At least 12 characters. A passphrase works well.</p>' : ""}</div>${signup ? '<details><summary>Have an operator setup code?</summary><label for="setupCode">Operator setup code</label><input id="setupCode" name="setupCode" type="password" maxlength="512" autocomplete="off"><p class="hint">Only needed for an account reserved by the project operator.</p></details>' : ""}<button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button></form>${state.session?.registrationEnabled ? `<button class="switch" data-action="auth-switch">${signup ? "Already have an account? Sign in" : "New to ORACLE? Create an account"}</button>` : ""}<p class="auth-footer">${state.session?.environment === "staging" ? "Staging environment — use test accounts and events." : "Your email is kept private. Events are visible to their members."}</p></main></div>`;
}
function shell(content) {
  app.innerHTML = `${!navigator.onLine ? '<div class="offline-banner">You are offline. Changes need a connection in this release.</div>' : ""}<div class="layout"><aside class="sidebar"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><nav aria-label="Main navigation"><button class="nav-button ${!["account", "admin"].includes(state.view) ? "active" : ""}" data-action="events">${state.session.user.isSuperuser ? "All events" : "My events"}</button><button class="nav-button ${state.view === "account" ? "active" : ""}" data-action="account">Account</button><button class="nav-button" data-action="offline-open">Saved readings</button>${state.session.user.isSuperuser ? `<button class="nav-button ${state.view === "admin" ? "active" : ""}" data-action="admin-open">Administration</button>` : ""}</nav><div class="sidebar-footer"><div><p class="account-name">${esc(state.session.user.displayName)}</p>${state.session.user.isSuperuser ? '<p class="hint">Project superuser</p>' : ""}<p class="version">ORACLE / v${esc(state.session.version)}</p></div><button class="quiet" data-action="logout">Sign out</button></div></aside><main class="workspace" id="main"><div class="topbar"><button class="quiet menu-toggle" data-action="kit-collapse" aria-label="Toggle navigation" aria-expanded="true">☰ Menu</button><span class="eyebrow">Green Shoe Garage / Field instruments</span>${kit.controls()}${state.session.environment !== "production" ? `<span class="environment">${esc(state.session.environment)}</span>` : ""}</div>${content}</main></div>`;
  kit.apply();
}
function render() {
  if (state.view === "offline") { app.innerHTML = offline.renderArchive({ esc, archive: state.offlineArchive }); return; }
  if (!state.session?.user) return auth();
  if (state.view === "account") return account();
  if (state.view === "admin") return admin.render();
  if (state.view === "characters" && state.event) return characters.render();
  if (state.view === "adventure" && state.event) return adventure.render();
  if (state.view === "adventure-manage" && state.event) return adventureOrganizer.render();
  if (state.view === "exchanges" && state.event) return exchanges.render();
  if (state.view === "sharing" && state.event) return sharing.render();
  if (state.view === "story" && state.event) return story.render();
  if (state.view === "trace" && state.event) return trace.render();
  if (state.view === "bazaar" && state.event) return economy.render();
  if (state.view === "oaths" && state.event) return oaths.render();
  if (state.view === "sigil" && state.event) return sigil.render();
  if (state.view === "static" && state.event) return signals.render();
  if (state.view === "stagehand" && state.event) return stagehand.render();
  if (state.view === "detail" && state.event) return detail();
  events();
}
function events() {
  const active = state.events.filter((x) =>
    ["live", "paused", "rehearsal"].includes(x.status),
  ).length;
  shell(
    `<header class="page-head"><div><p class="eyebrow">Event workspace</p><h1>Your worlds, ready to begin.</h1><p class="muted">Open an event to prepare your crew and manage the day.</p></div><div class="actions"><button data-action="kit-import">Import briefing pack</button><button data-action="join">Join an event</button><button data-action="create">+ Blank event</button><button class="primary" data-action="advedit-starter">Start an adventure</button></div></header><div class="summary"><div><strong>${state.events.length}</strong><span>events</span></div><div><strong>${active}</strong><span>in rehearsal or running</span></div><div><strong>${state.events.filter((x) => ["owner", "organizer", "superuser"].includes(x.role)).length}</strong><span>you organize</span></div></div>${state.events.length ? `<div class="cards">${state.events.map((ev) => `<button class="event-card" data-action="open-event" data-id="${esc(ev.id)}"><div class="card-top">${badge(ev.status)}<span class="role">${esc(ev.role)}</span></div><div><h2>${esc(ev.name)}</h2><p class="hint">${esc(ev.location || "Location to be decided")}</p></div><p class="description">${esc(ev.description || "A new event, ready for its story.")}</p><div class="card-bottom"><span>${ev.member_count} ${ev.member_count === 1 ? "member" : "members"}</span><span>${ev.starts_at ? esc(new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "Open event →"}</span></div></button>`).join("")}</div>` : `<section class="empty"><div class="number">01 / Assemble your crew</div><h2>Every world starts somewhere.</h2><p>Create your first event, or enter an invitation code from your organizer. Your events will appear here.</p><div class="actions"><button class="primary" data-action="advedit-starter">Start your first adventure</button><button data-action="create">Create a blank event</button><button data-action="join">I have an invitation</button></div></section>`}<p class="footer-note">${state.session.user.isSuperuser ? "Your superuser access includes every event." : "Only events you belong to appear here."}</p>`,
  );
}
function detail() {
  if (isManager() && kit.isOrganizerView()) { organizerDetail(); kit.enhanceOrganizer(); }
  else kit.renderPlayer();
  if (document.documentElement.dataset.prop !== "true") {
    document.querySelector(".workspace .page-head, .workspace .world-header")?.insertAdjacentHTML("afterend", `<section class="panel character-entry"><div class="panel-head"><div><h2>Your field kit</h2><p class="hint">Choose a character, follow discoveries, and find your next scene.</p></div><div class="actions"><button data-action="character-open">Characters</button><button class="primary" data-action="adv-open">Open adventure</button><button data-action="exchange-open">Exchanges</button>${state.event.setup.enabledInstruments.includes("trace") ? '<button data-action="trace-open">TRACE · Investigation</button>' : ""}${state.event.setup.enabledInstruments.some(id => ["whisper", "broadside"].includes(id)) ? '<button data-action="story-open">Rumors & news</button>' : ""}${state.event.setup.enabledInstruments.includes("bazaar") ? '<button data-action="bazaar-open">BAZAAR · Shops & balances</button>' : ""}${state.event.setup.enabledInstruments.includes("oathbook") ? '<button data-action="oath-open">OATHBOOK · Agreements</button>' : ""}${state.event.setup.enabledInstruments.includes("sigil") ? '<button data-action="sigil-open">SIGIL · Cooperative challenges</button>' : ""}${state.event.setup.enabledInstruments.includes("static") ? '<button data-action="static-open">STATIC · Fictional readings</button>' : ""}${state.event.setup.enabledInstruments.includes("stagehand") ? '<button data-action="stagehand-open">STAGEHAND · Parties & scenes</button>' : ""}</div></div>${isManager() || state.event.role === "staff" ? `<details class="mt"><summary>Organizer tools</summary><div class="actions mt"><button data-action="story-manage">Prepare rumors & news</button><button data-action="sigil-manage">Prepare SIGIL</button><button data-action="static-manage">Prepare STATIC</button><button data-action="stagehand-manage">STAGEHAND operations</button>${isManager() ? '<button data-action="advedit-open">Prepare adventure</button><button data-action="sharing-open">Sharing rules</button><button data-action="bazaar-manage">Manage BAZAAR</button><button data-action="oath-manage">Review OATHBOOK</button>' : ""}</div></details>` : ""}</section>`);
  }
}
function organizerDetail() {
  const ev = state.event;
  shell(
    `<div class="actions"><button class="quiet" data-action="events">← My events</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(ev.role)} workspace</p><h1>${esc(ev.name)}</h1><p>${badge(ev.status)} <span class="role">${state.members.length} ${state.members.length === 1 ? "member" : "members"}</span></p></div><div class="actions"><button data-action="refresh-event">Refresh</button>${isManager() && !["ended", "archived"].includes(ev.status) ? '<button class="primary" data-action="invite">Invite people</button>' : ""}</div></header><div class="detail-grid"><div class="stack"><section class="panel"><div class="panel-head"><h2>Event briefing</h2>${isManager() && ev.status !== "archived" ? '<button class="quiet" data-action="edit-event">Edit details</button>' : ""}</div><p class="prose">${esc(ev.description || "Your organizer has not added a briefing yet.")}</p><dl class="facts"><div><dt>Location</dt><dd>${esc(ev.location || "To be decided")}</dd></div><div><dt>Starts</dt><dd>${esc(date(ev.starts_at))}</dd></div></dl></section><section class="panel"><div class="panel-head"><h2>People</h2><span class="muted">${state.members.length}</span></div><ul class="member-list">${state.members.map((m) => `<li><div><p>${esc(m.display_name)}${m.user_id === state.session.user.id ? ' <span class="muted">(you)</span>' : ""}</p><span class="role">${esc(m.role)}</span></div><div class="actions">${isOwner() && m.role !== "owner" ? `<button data-action="role" data-id="${esc(m.user_id)}">Change role</button>` : ""}${m.role !== "owner" && ((isManager() && (m.role !== "organizer" || isOwner())) || m.user_id === state.session.user.id) ? `<button class="quiet danger" data-action="remove-member" data-id="${esc(m.user_id)}">${m.user_id === state.session.user.id ? "Leave" : "Remove"}</button>` : ""}</div></li>`).join("")}</ul></section></div><div class="stack"><section class="panel"><h2>Event status</h2><div class="lifecycle">${["draft", "rehearsal", "live", "paused", "ended", "archived"].map((x) => `<span class="${x === ev.status ? "current" : ""}">${title(x)}</span>`).join("")}</div><p class="hint">${esc({ draft: "Prepare your event and invite your crew.", rehearsal: "Practice the event flow before opening play.", live: "Your event is running.", paused: "Play is paused. Members can still read the briefing.", ended: "Play has finished. Existing members retain access.", archived: "This event is kept as a read-only record." }[ev.status])}</p>${isManager() ? `<div class="actions mt">${state.transitions.map((s) => `<button class="${s === "live" ? "primary" : ""}" data-action="status" data-status="${s}">${{ rehearsal: "Start rehearsal", draft: "Return to draft", live: ev.status === "paused" ? "Resume event" : "Go live", paused: "Pause event", ended: "End event", archived: "Archive event" }[s]}</button>`).join("")}</div>` : ""}</section>${isManager() ? '<section class="panel"><h2>Organizer tools</h2><p class="hint">Manage access and review changes to this event.</p><div class="actions mt"><button data-action="invitations">Invitation codes</button><button data-action="audit">Activity log</button></div></section>' : '<section class="panel"><h2>Your place in the event</h2><p class="hint">Your organizer controls event details and access. Use your character name as your display name if you prefer.</p></section>'}</div></div>`,
  );
}
function account() {
  shell(
    `<header class="page-head"><div><p class="eyebrow">Your account</p><h1>Keep your access secure.</h1><p class="muted">${esc(state.session.user.email)}</p></div></header><section class="panel narrow"><h2>Change password</h2><p class="hint">Changing your password signs out your other sessions.</p><form id="password-form" class="mt">${err}<div><label for="currentPassword">Current password</label><input type="password" id="currentPassword" name="currentPassword" minlength="12" maxlength="128" autocomplete="current-password" required></div><div><label for="newPassword">New password</label><input type="password" id="newPassword" name="newPassword" minlength="12" maxlength="128" autocomplete="new-password" required></div><button class="primary" type="submit">Update password</button></form></section>`,
  );
}
async function loadEvents() {
  sigil.reset();
  signals.reset();
  stagehand.reset();
  state.events = (await api("/api/events")).events;
  state.view = "events";
  state.event = null;
  render();
  await characters.handleHash();
  await adventure.handleHash();
  await exchanges.handleHash();
  await sigil.handleHash();
  await signals.handleHash();
}
async function loadEvent(id) {
  const result = await api(`/api/events/${id}`);
  Object.assign(state, { view: "detail", ...result });
  sigil.reset();
  signals.reset();
  stagehand.reset();
  kit.enterEvent(result.event);
  render();
}
function eventForm(edit = false) {
  const ev = edit ? state.event : {};
  const localDate = ev.starts_at
    ? new Date(
        new Date(ev.starts_at).getTime() -
          new Date(ev.starts_at).getTimezoneOffset() * 60000,
      )
        .toISOString()
        .slice(0, 16)
    : "";
  openModal(
    edit ? "Edit event details" : "Create an event",
    `<form id="event-form" data-edit="${edit}">${err}<div><label for="eventName">Event name</label><input id="eventName" name="name" value="${esc(ev.name || "")}" minlength="2" maxlength="100" required placeholder="The Last Signal"></div><div><label for="description">Briefing <span class="muted">(optional)</span></label><textarea id="description" name="description" maxlength="2000" placeholder="What should your crew know?">${esc(ev.description || "")}</textarea></div><div><label for="location">Location <span class="muted">(optional)</span></label><input id="location" name="location" maxlength="200" value="${esc(ev.location || "")}" placeholder="Venue or meeting point"></div><div><label for="startsAt">Starts <span class="muted">(your local time, optional)</span></label><input id="startsAt" name="startsAt" type="datetime-local" value="${esc(localDate)}"></div><div class="actions"><button class="primary" type="submit">${edit ? "Save changes" : "Create event"}</button><button type="button" class="quiet" data-action="close">Cancel</button></div></form>`,
  );
}
function joinForm() {
  openModal(
    "Join an event",
    `<form id="join-form">${err}<div><label for="code">Invitation code</label><input id="code" name="code" required minlength="16" maxlength="24" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="XXXX-XXXX-XXXX-XXXX"><p class="hint">Ask your organizer for an invitation code.</p></div><button class="primary" type="submit">Join event</button></form>`,
  );
}
function inviteForm() {
  openModal(
    "Invite people",
    `<form id="invite-form">${err}<div><label for="role">Join as</label><select id="role" name="role"><option value="player">Player — view the event</option><option value="staff">Staff — join the event crew</option>${isOwner() ? '<option value="organizer">Organizer — manage this event</option>' : ""}</select><p class="hint">Staff tools will expand as event instruments are added. Staff and organizer codes admit one person.</p></div><div class="two-fields"><div><label for="maxUses">Maximum people</label><input id="maxUses" name="maxUses" type="number" min="1" max="1000" value="20" required></div><div><label for="expiresInHours">Expires in hours</label><input id="expiresInHours" name="expiresInHours" type="number" min="1" max="168" value="48" required></div></div><button class="primary" type="submit">Create invitation code</button></form>`,
  );
}
function confirmModal(heading, message, action, attributes, label) {
  openModal(
    heading,
    `<p class="muted">${esc(message)}</p>${err}<div class="actions mt"><button class="primary" data-action="${action}" ${attributes}>${esc(label)}</button><button data-action="close">Cancel</button></div>`,
  );
}
async function action(button) {
  const destination = button.dataset.action;
  if (["events", "account", "logout", "open-event", "create", "kit-import", "character-open", "adv-open", "advedit-open", "advedit-starter", "offline-open", "admin-open", "exchange-open", "sharing-open", "story-open", "story-manage", "trace-open", "bazaar-open", "bazaar-manage", "oath-open", "oath-manage", "sigil-open", "sigil-manage", "static-open", "static-manage", "stagehand-open", "stagehand-manage"].includes(destination)) {
    if (state.view === "characters" && !characters.confirmDiscard()) return;
    if (state.view === "adventure" && !adventure.confirmDiscard()) return;
    if (state.view === "adventure-manage" && !adventureOrganizer.confirmDiscard()) return;
    if (state.view === "exchanges" && !exchanges.confirmDiscard()) return;
    if (state.view === "sharing" && !sharing.confirmDiscard()) return;
    if (state.view === "story" && !story.confirmDiscard()) return;
    if (state.view === "trace" && !trace.confirmDiscard()) return;
    if (state.view === "bazaar" && !economy.confirmDiscard()) return;
    if (state.view === "oaths" && !oaths.confirmDiscard()) return;
    if (state.view === "sigil" && !sigil.confirmDiscard(destination)) return;
    if (state.view === "static" && !signals.confirmDiscard(destination)) return;
    if (state.view === "stagehand" && !stagehand.confirmDiscard(destination)) return;
    if (state.view === "sigil" && !destination.startsWith("sigil-")) sigil.reset();
    if (state.view === "static" && !destination.startsWith("static-")) signals.reset();
    if (state.view === "stagehand" && !destination.startsWith("stagehand-")) stagehand.reset();
  }
  if (await exchanges.action(button)) return;
  if (await sharing.action(button)) return;
  if (await story.action(button)) return;
  if (await trace.action(button)) return;
  if (await economy.action(button)) return;
  if (await oaths.action(button)) return;
  if (await sigil.action(button)) return;
  if (await signals.action(button)) return;
  if (await stagehand.action(button)) return;
  if (await adventure.action(button)) return;
  if (await adventureOrganizer.action(button)) return;
  if (await characters.action(button)) return;
  if (await admin.action(button)) return;
  if (await kit.action(button)) return;
  const id = button.dataset.id;
  switch (button.dataset.action) {
    case "offline-open":
      await openOffline();
      break;
    case "offline-refresh":
      await start();
      break;
    case "offline-clear":
      await offline.clearArchive({ keepAccount: Boolean(state.session?.user) });
      await openOffline();
      toast("Saved readings cleared from this device.");
      break;
    case "close":
      closeModal();
      break;
    case "auth-switch":
      state.authMode = state.authMode === "login" ? "register" : "login";
      auth();
      break;
    case "events":
      await loadEvents();
      break;
    case "account":
      state.view = "account";
      render();
      break;
    case "logout":
      await api("/api/auth/logout", "POST", {});
      await offline.clearArchive().catch(() => {});
      resetPrivateViews();
      state.session.user = null;
      state.view = "events";
      state.offlineArchive = null;
      state.events = [];
      state.event = null;
      closeModal(true);
      render();
      break;
    case "create":
      kit.startBuilder();
      break;
    case "edit-event":
      eventForm(true);
      break;
    case "join":
      joinForm();
      break;
    case "open-event":
      await loadEvent(id);
      break;
    case "refresh-event":
      await loadEvent(state.event.id);
      toast("Event refreshed.");
      break;
    case "invite":
      inviteForm();
      break;
    case "copy-code":
      try {
        await navigator.clipboard.writeText(
          document.querySelector("#invite-code").textContent,
        );
        toast("Invitation code copied.");
      } catch {
        toast("Select the code and copy it manually.");
      }
      break;
    case "status": {
      const s = button.dataset.status;
      confirmModal(
        `${title(s)} event?`,
        {
          rehearsal: "Move into rehearsal so your crew can prepare.",
          draft: "Return to planning. Existing members and data are preserved.",
          live: "Mark this event as running for everyone in it.",
          paused: "Mark play as paused for everyone in the event.",
          ended:
            "End this event and close new invitations. This cannot be changed back to live in this release.",
          archived:
            "Archive this event. Its briefing and status become read-only.",
        }[s],
        "confirm-status",
        `data-status="${s}"`,
        "Confirm",
      );
      break;
    }
    case "confirm-status":
      await api(`/api/events/${state.event.id}`, "PATCH", {
        version: state.event.version,
        status: button.dataset.status,
      });
      closeModal();
      await loadEvent(state.event.id);
      toast("Event status updated.");
      break;
    case "role": {
      const member = state.members.find((m) => m.user_id === id);
      openModal(
        "Change member role",
        `<form id="role-form" data-id="${esc(id)}">${err}<p>${esc(member.display_name)}</p><div><label for="memberRole">Role</label><select id="memberRole" name="role">${["player", "staff", "organizer"].map((r) => `<option value="${r}" ${member.role === r ? "selected" : ""}>${title(r)}</option>`).join("")}</select><p class="hint">Organizers can edit the event, invite people, and manage players and staff.</p></div><button class="primary" type="submit">Save role</button></form>`,
      );
      break;
    }
    case "remove-member": {
      const self = id === state.session.user.id;
      const m = state.members.find((x) => x.user_id === id);
      confirmModal(
        self ? "Leave this event?" : "Remove this member?",
        self
          ? "You will need a valid invitation to join again."
          : `${m.display_name} will lose access to this event.`,
        "confirm-remove",
        `data-id="${esc(id)}"`,
        self ? "Leave event" : "Remove member",
      );
      break;
    }
    case "confirm-remove": {
      const eventId = state.event.id;
      await api(`/api/events/${eventId}/members/${id}`, "DELETE");
      closeModal();
      if (id === state.session.user.id) await loadEvents();
      else await loadEvent(eventId);
      toast("Membership updated.");
      break;
    }
    case "invitations": {
      const { invitations } = await api(
        `/api/events/${state.event.id}/invites`,
      );
      openModal(
        "Invitation codes",
        `<p class="hint">Codes are shown only when created. Revoke access here or create a new code.</p>${err}<ul class="invite-list">${invitations.length ? invitations.map((i) => `<li><div class="card-top"><strong>${esc(title(i.role))}</strong>${!i.revoked_at && new Date(i.expires_at) > new Date() && i.uses < i.max_uses && (isOwner() || i.role !== "organizer") ? `<button class="quiet danger" data-action="revoke" data-id="${esc(i.id)}">Revoke</button>` : ""}</div><p class="hint">${i.uses}/${i.max_uses} used · ${i.revoked_at ? "Revoked" : new Date(i.expires_at) <= new Date() ? "Expired" : `Expires ${esc(date(i.expires_at))}`}</p></li>`).join("") : "<li>No invitation codes yet.</li>"}</ul>`,
      );
      break;
    }
    case "revoke":
      await api(`/api/events/${state.event.id}/invites/${id}`, "DELETE");
      await action({ dataset: { action: "invitations" } });
      toast("Invitation revoked.");
      break;
    case "audit": {
      const { entries } = await api(`/api/events/${state.event.id}/audit`);
      const names = {
        "event.created": "Created the event",
        "event.updated": "Updated event details",
        "event.setup_updated": "Updated the field kit",
        "event.theme_changed": "Changed event theme",
        "event.imported": "Imported an event pack",
        "event.status_changed": "Changed event status",
        "member.joined": "Joined the event",
        "invitation.created": "Created an invitation",
        "invitation.revoked": "Revoked an invitation",
        "member.role_changed": "Changed a member role",
        "member.removed": "Removed a membership",
      };
      openModal(
        "Event activity",
        `<ul class="log-list">${entries.map((e) => `<li><p><strong>${esc(e.actor)}</strong> · ${esc(names[e.action] || e.action)}</p>${e.details.to ? `<p class="hint">${esc(e.details.from)} → ${esc(e.details.to)}</p>` : ""}<time>${esc(date(e.created_at))}</time></li>`).join("")}</ul>`,
      );
      break;
    }
  }
}
document.addEventListener("click", async (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button || button.disabled || state.busy) return;
  state.busy = true;
  button.disabled = true;
  try {
    await action(button);
  } catch (error) {
    const visible = modal.open ? modalContent : app;
    setError(visible, error);
  } finally {
    state.busy = false;
    button.disabled = false;
  }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "role") {
    const field = document.querySelector("#maxUses");
    const single = e.target.value !== "player";
    field.value = single ? "1" : "20";
    field.readOnly = single;
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  if (state.busy) return;
  state.busy = true;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  const input = Object.fromEntries(new FormData(form));
  const error = form.querySelector(".error");
  if (error) error.textContent = "";
  try {
    if (await exchanges.submit(form)) return;
    if (await sharing.submit(form)) return;
    if (await story.submit(form)) return;
    if (await trace.submit(form)) return;
    if (await economy.submit(form)) return;
    if (await oaths.submit(form)) return;
    if (await sigil.submit(form)) return;
    if (await signals.submit(form)) return;
    if (await stagehand.submit(form)) return;
    if (await adventure.submit(form)) return;
    if (await adventureOrganizer.submit(form)) return;
    if (await characters.submit(form)) return;
    if (await admin.submit(form)) return;
    if (await kit.submit(form)) return;
    switch (form.id) {
      case "auth-form": {
        const result = await api(`/api/auth/${state.authMode}`, "POST", input);
        state.session.user = result.user;
        await offline.setAccount(result.user.id).catch(() => {});
        await loadEvents();
        break;
      }
      case "event-form": {
        input.startsAt = input.startsAt
          ? new Date(input.startsAt).toISOString()
          : null;
        const edit = form.dataset.edit === "true";
        if (edit) input.version = state.event.version;
        const { event } = await api(
          edit ? `/api/events/${state.event.id}` : "/api/events",
          edit ? "PATCH" : "POST",
          input,
        );
        closeModal();
        await loadEvent(event.id);
        toast(
          edit ? "Event details saved." : "Your event is ready to prepare.",
        );
        break;
      }
      case "join-form": {
        const { event } = await api("/api/events/join", "POST", input);
        closeModal();
        await loadEvent(event.id);
        toast("You are part of the event.");
        break;
      }
      case "invite-form": {
        input.maxUses = Number(input.maxUses);
        input.expiresInHours = Number(input.expiresInHours);
        const { invitation } = await api(
          `/api/events/${state.event.id}/invites`,
          "POST",
          input,
        );
        openModal(
          "Your invitation is ready",
          `<p>Share this code with the people joining as <strong>${esc(invitation.role)}</strong>.</p><div class="code" id="invite-code">${invitation.code.match(/.{4}/g).join("-")}</div><p class="hint">Up to ${invitation.maxUses} people · expires in ${invitation.expiresInHours} hours. Save it now; it is only shown once.</p><div class="actions mt"><button class="primary" data-action="copy-code">Copy code</button><button data-action="close">Done</button></div>`,
        );
        break;
      }
      case "role-form":
        await api(
          `/api/events/${state.event.id}/members/${form.dataset.id}`,
          "PATCH",
          input,
        );
        closeModal();
        await loadEvent(state.event.id);
        toast("Member role updated.");
        break;
      case "password-form":
        await api("/api/auth/password", "POST", input);
        form.reset();
        toast("Password updated. Other sessions have been signed out.");
        break;
    }
  } catch (error) {
    setError(form, error);
  } finally {
    state.busy = false;
    if (submit) submit.disabled = false;
  }
});
window.addEventListener("hashchange", async () => {
  try {
    if (["#prop/", "#exchange/", "#badge/", "#sigil/", "#static/"].some((prefix) => location.hash.startsWith(prefix)) && (!kit.confirmDiscard() || !characters.confirmDiscard() || !adventure.confirmDiscard() || !adventureOrganizer.confirmDiscard() || !sharing.confirmDiscard() || !exchanges.confirmDiscard() || !story.confirmDiscard() || !trace.confirmDiscard() || !economy.confirmDiscard() || !oaths.confirmDiscard() || !sigil.confirmDiscard() || !signals.confirmDiscard() || !stagehand.confirmDiscard())) {
      history.replaceState(null, "", `${location.pathname}${location.search}`);
      return;
    }
    await characters.handleHash();
    await adventure.handleHash();
    await exchanges.handleHash();
  await sigil.handleHash();
  await signals.handleHash();
  } catch (error) { toast(error.message); }
});
modal.addEventListener("cancel", (e) => { e.preventDefault(); closeModal(); });
window.addEventListener("offline", () => {
  if (!["sigil", "static", "stagehand"].includes(state.view)) render();
  toast("Connection lost. Changes need a connection.");
});
window.addEventListener("online", () => {
  if (!["sigil", "static", "stagehand"].includes(state.view)) render();
  toast("Connection restored. Refresh the event to see current information.");
});
async function openOffline() {
  state.offlineArchive = await offline.loadArchive().catch(() => ({ accountId: null, records: [], lastChecked: null }));
  state.view = "offline";
  closeModal(true);
  render();
}
async function start() {
  try {
    const previousUser = state.session?.user?.id;
    state.session = await api("/api/session");
    if (previousUser !== state.session.user?.id) {
      resetPrivateViews();
    }
    await offline.setAccount(state.session.user?.id || null).catch(() => {});
    state.offlineArchive = null;
    state.view = "events";
    if (state.session.user) await loadEvents();
    else render();
  } catch {
    await openOffline();
  }
}
offline.registerOfflineShell().catch(() => {});
start();
