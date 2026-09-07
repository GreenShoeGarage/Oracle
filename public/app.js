"use strict";
import { createKitUI } from "./builder.js";
import { createCharacterUI } from "./characters-ui.js";
import { createAdminUI } from "./admin-ui.js";
import { createAdventurePlayer } from "./adventure-player.js";
import { createAdventureOrganizer } from "./adventure-organizer.js";
import * as offline from "./offline.js";
import * as fieldStore from "./field-store.js";
import { createFieldSync } from "./field-sync.js";
import { createFieldUI } from "./field-ui.js";
import { createInstallUI } from "./install.js";
import { requestJSON } from "./connection.js";
import { renderWelcomeGuide, renderEventGuide } from "./guide-ui.js";
import { createExchangeUI } from "./exchanges-ui.js";
import { createSharingUI } from "./sharing-ui.js";
import { createStoryUI } from "./story-ui.js";
import { createTraceUI } from "./trace-ui.js";
import { createEconomyUI } from "./economy-ui.js";
import { createOathUI } from "./oath-ui.js";
import { createSigilUI } from "./sigil-ui.js";
import { createStaticUI } from "./static-ui.js";
import { createStagehandUI } from "./stagehand-ui.js";
import { createStartupUI } from "./startup.js";
const app = document.querySelector("#app");
const modal = document.querySelector("#modal");
const modalContent = document.querySelector("#modal-content");
const startup = createStartupUI({ document, window });
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
let operationTimer, modalOpener;
let authEpoch = 0, connectionEpoch = 0;
let pendingApiWrites = 0;
let interactionEpoch = 0;
const writeIdleWaiters = new Set();
const writesIdle = () => pendingApiWrites ? new Promise((resolve) => writeIdleWaiters.add(resolve)) : Promise.resolve();
const eventEpochs = new Map();
let signoutFlight = null;
let connectionState = navigator.onLine === false ? "offline" : "checking";
const LOCAL_SIGNOUT_KEY = "oracle-local-signout";
let memorySignout = null;
function pendingSignout() {
  let value;
  try { value = localStorage.getItem(LOCAL_SIGNOUT_KEY); } catch { return memorySignout; }
  if (!value) return memorySignout;
  try {
    const saved = JSON.parse(value), uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuid.test(saved?.accountId) && uuid.test(saved?.id) ? saved : { invalid: true };
  } catch { return { invalid: true }; }
}
function lockDevice(accountId) {
  memorySignout = { accountId, id: crypto.randomUUID() };
  try { localStorage.setItem(LOCAL_SIGNOUT_KEY, JSON.stringify(memorySignout)); } catch { /* Memory lock and store tombstones still apply. */ }
  authEpoch++;
}
function unlockDevice() {
  memorySignout = null;
  try { localStorage.removeItem(LOCAL_SIGNOUT_KEY); } catch { /* Retained lock fails closed on reload. */ }
}
function connectionBanner() {
  const target = document.querySelector("#connection-status");
  if (!target) return;
  const localLogout = pendingSignout();
  target.hidden = connectionState === "online" && !localLogout;
  target.dataset.state = connectionState;
  const message = localLogout ? "Signed out on this device. Reconnect to finish ending the server session."
    : connectionState === "checking" ? "Checking the connection… Your drafts remain open."
    : connectionState === "offline" ? "Offline or unreachable. Saved readings and Field desk notes are available. Live actions wait for server confirmation."
    : "Connected.";
  target.innerHTML = `<span>${esc(message)}</span><div class="actions"><button class="quiet" data-action="connection-check">Check connection</button><button class="quiet" data-action="field-open">Field desk</button><button class="quiet" data-action="offline-open">Saved readings</button></div>`;
}
function updateInstallUI() {
  for (const target of document.querySelectorAll("[data-install-controls]")) install.refresh(target);
}
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
const exchanges = createExchangeUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, offline, openJournal: (characterId) => adventure.open({ characterId }), queueFieldRequest: (request) => field.queue(request), captureFieldScope: () => field.captureContextScope(), rememberFieldContext: (event, characters, scope) => field.rememberContext(event, characters, scope), openField: () => field.open() });
const sharing = createSharingUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render });
const story = createStoryUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => adventure.open({ characterId }), openExchanges: (characterId) => exchanges.open({ characterId }) });
const trace = createTraceUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => adventure.open({ characterId }), openExchanges: (characterId) => exchanges.open({ characterId }) });
const economy = createEconomyUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openExchanges: (characterId) => exchanges.open({ characterId }) });
const oaths = createOathUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openBazaar: (characterId, agreementId) => economy.open(state.event, true, characterId, agreementId) });
const sigil = createSigilUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => { sigil.reset(); return adventure.open({ characterId }); } });
const signals = createStaticUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openJournal: (characterId) => { signals.reset(); return adventure.open({ characterId }); } });
const stagehand = createStagehandUI({ state, api, shell, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, openStory: () => story.open({ manage: true }), openAdventure: (options) => adventure.open(options) });
const fieldSync = createFieldSync({ api, store: fieldStore });
const field = createFieldUI({ state, api, shell: (html) => {
  publicIntroduction(false);
  if (state.session?.user) shell(html);
  else app.innerHTML = `<main class="workspace" id="main" tabindex="-1">${html}</main>`;
}, esc, openModal, closeModal, loadEvent, toast, isManager, err, render, offline, store: fieldStore, sync: fieldSync, checkOfflineShell: () => install.verifyOfflineReady(), isOfflineShellReady: () => install.offlineReady, openExchanges: (characterId) => exchanges.open({ characterId }) });
const install = createInstallUI({ getDirty: () => true, confirmDiscard: () => {
  if (pendingApiWrites || fieldSync.busy) { toast("Wait for the current server request to finish before applying an app update."); return false; }
  return field.canUpdate ? field.canUpdate() : true;
}, onChange: updateInstallUI, toast });
function resetPrivateViews() {
  field.reset();
  fieldSync.reset();
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
async function api(path, method = "GET", data, options = {}) {
  const requestEpoch = authEpoch;
  const capturedEvents = new Map(eventEpochs);
  const requestedUserId = state.session?.user?.id;
  let response, result;
  if (method !== "GET" && method !== "HEAD") pendingApiWrites++;
  try {
    ({ response, result } = await requestJSON(path, method, data, { ...options, expectedAccount: options.expectedAccount || requestedUserId }));
  } catch (error) {
    if (error.offline) { connectionState = "offline"; connectionBanner(); }
    throw error;
  } finally {
    if (method !== "GET" && method !== "HEAD" && --pendingApiWrites === 0) {
      for (const resolve of writeIdleWaiters) resolve();
      writeIdleWaiters.clear();
    }
  }
  if (requestEpoch !== authEpoch) {
    const error = new Error("This device's account access changed while the request was in progress. Reconnect before continuing.");
    error.status = 401; error.uncertain = method !== "GET";
    throw error;
  }
  const responseEventId = path.match(/^\/api\/events\/([0-9a-f-]{36})(?:[/?]|$)/i)?.[1] || result.event?.id || result.character?.eventId;
  if (responseEventId && (capturedEvents.get(responseEventId) || 0) !== (eventEpochs.get(responseEventId) || 0)) {
    const error = new Error("Access to this event changed while the request was in progress. Open the event again before continuing.");
    error.status = 409; error.uncertain = method !== "GET";
    throw error;
  }
  if (Array.isArray(result.events)) result.events = result.events.filter((event) => (capturedEvents.get(event.id) || 0) === (eventEpochs.get(event.id) || 0));
  connectionState = "online"; connectionBanner();
  if (requestedUserId && requestedUserId !== state.session?.user?.id) {
    const error = new Error("The account changed. Open the event again to continue.");
    error.status = 409;
    throw error;
  }
  const responseAccount = response.headers.get("x-oracle-account");
  if (requestedUserId && responseAccount && responseAccount !== requestedUserId) {
    await forgetLocalAccess();
    const error = new Error("Your account changed in another tab. Sign in again to continue.");
    error.status = 401;
    throw error;
  }
  if (!response.ok) {
    if (response.status === 401 && state.session?.user) {
      await forgetLocalAccess();
    }
    if (response.status === 404 && ["Event not found or access has been removed.", "Character not found or not assigned to you."].includes(result.error)) {
      const eventId = path.match(/^\/api\/events\/([0-9a-f-]{36})(?:[/?]|$)/i)?.[1];
      if (eventId) {
        await forgetEventAccess(eventId, result.error === "Event not found or access has been removed.");
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
  if (!modal.open) modalOpener = document.activeElement;
  modalContent.innerHTML = `<div class="modal-head"><h2 id="modal-title" tabindex="-1">${esc(heading)}</h2><button type="button" data-action="close" aria-label="Close dialog">×</button></div>${content}`;
  if (!modal.open) modal.showModal();
  document.querySelector("#modal-title")?.focus({ preventScroll: true });
}
function closeModal(force = false) {
  if (!force && (!kit.confirmDiscard() || !characters.confirmDiscard() || !adventureOrganizer.confirmDiscard("modal") || !exchanges.confirmDiscard("modal") || !story.confirmDiscard("modal") || !trace.confirmDiscard("modal") || !economy.confirmDiscard("modal") || !oaths.confirmDiscard("modal") || !sigil.confirmDiscard("modal") || !signals.confirmDiscard("modal") || !stagehand.confirmDiscard("modal") || !field.confirmDiscard("modal"))) return;
  const wasOpen = modal.open;
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
  field.cleanupModal?.();
  if (force) kit.resetDraft();
  modal.classList.remove("wide-modal");
  modal.close();
  modalContent.replaceChildren();
  const opener = modalOpener, epoch = authEpoch;
  modalOpener = null;
  window.requestAnimationFrame(() => {
    if (!wasOpen || epoch !== authEpoch || modal.open) return;
    if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
    else if (document.activeElement === document.body) focusMain();
  });
}
function focusMain() {
  const target = document.querySelector("#main h1, #main h2, #main");
  if (target) { target.setAttribute("tabindex", "-1"); target.focus({ preventScroll: true }); }
}
function beginOperation(interaction, button) {
  clearTimeout(operationTimer);
  const status = document.querySelector("#operation-status");
  if (status) status.hidden = true;
  button?.setAttribute("aria-busy", "true");
  operationTimer = setTimeout(() => {
    if (interaction !== interactionEpoch || !status) return;
    status.textContent = "Working…";
    status.hidden = false;
  }, 400);
}
function endOperation(interaction, button) {
  button?.removeAttribute("aria-busy");
  if (interaction !== interactionEpoch) return;
  clearTimeout(operationTimer);
  const status = document.querySelector("#operation-status");
  if (status) { status.hidden = true; status.textContent = ""; }
  if (document.activeElement === document.body && !modal.open) focusMain();
}
function setError(form, error) {
  const el = form.querySelector(".error");
  if (el) {
    el.textContent =
      error.message ||
      "Unable to connect. Check your connection and try again.";
    el.scrollIntoView({ block: "nearest" });
    el.setAttribute("tabindex", "-1");
    el.focus({ preventScroll: true });
  } else toast(error.message || "Unable to connect.");
}
function publicIntroduction(visible) {
  const intro = document.querySelector("#public-intro");
  if (intro) intro.hidden = !visible;
  document.querySelector("#entry-shell")?.classList.toggle("public-entry", visible);
}
function auth() {
  publicIntroduction(true);
  kit.apply();
  const signup = state.authMode === "register";
  app.innerHTML = `<div class="auth-wrap"><section class="auth-intro"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><h1>Bring your people<br>into the story.</h1><p>Join an event, create your character, and carry your discoveries into the story. Organizers can prepare a world for their crew.</p><p class="auth-footer">Green Shoe Garage · v${esc(state.session?.version || "1.2.0")}</p></section><main id="main" class="auth-form" tabindex="-1"><p class="eyebrow">Your field kit</p><h2>${signup ? "Create your account" : "Welcome back"}</h2><p>${signup ? "Create an account, then join with your organizer’s invitation code or start your own event." : "Sign in to open your events."}</p><form id="auth-form">${err}${signup ? '<div><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="80" required autocomplete="nickname"><p class="hint">Shown to the people in your events.</p></div>' : ""}<div><label for="email">Email address</label><input id="email" name="email" type="email" maxlength="254" required autocomplete="email"></div><div><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="${signup ? "new-password" : "current-password"}">${signup ? '<p class="hint">At least 12 characters. A passphrase works well.</p>' : ""}</div>${signup ? '<details><summary>Have an operator setup code?</summary><label for="setupCode">Operator setup code</label><input id="setupCode" name="setupCode" type="password" maxlength="512" autocomplete="off"><p class="hint">Only needed for an account reserved by the project operator.</p></details>' : ""}<button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button></form>${state.session?.registrationEnabled ? `<button class="switch" data-action="auth-switch">${signup ? "Already have an account? Sign in" : "New to ORACLE? Create an account"}</button>` : ""}<p class="auth-footer">${state.session?.environment === "staging" ? "Staging environment — use test accounts and events." : "Your email is kept private. Events are visible to their members."}</p></main></div>`;
}
function shell(content) {
  publicIntroduction(false);
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><nav aria-label="Main navigation"><button class="nav-button ${!["account", "admin"].includes(state.view) ? "active" : ""}" data-action="events">${state.session.user.isSuperuser ? "All events" : "My events"}</button><button class="nav-button ${state.view === "account" ? "active" : ""}" data-action="account">Account</button><button class="nav-button" data-action="offline-open">Saved readings</button><button class="nav-button ${state.view === "field" ? "active" : ""}" data-action="field-open">Field desk</button><a class="nav-link" href="/tour.html" target="_blank" rel="noopener">Explore ORACLE ↗</a><a class="nav-link" href="/help.html" target="_blank" rel="noopener">Help &amp; guides ↗</a>${state.session.user.isSuperuser ? `<button class="nav-button ${state.view === "admin" ? "active" : ""}" data-action="admin-open">Administration</button>` : ""}</nav><div class="sidebar-footer"><div><p class="account-name">${esc(state.session.user.displayName)}</p>${state.session.user.isSuperuser ? '<p class="hint">Project superuser</p>' : ""}<p class="version">ORACLE / v${esc(state.session.version)}</p></div><div data-install-controls>${install.render()}</div><button class="quiet" data-action="logout">Sign out</button></div></aside><main class="workspace" id="main" tabindex="-1"><div class="topbar"><button class="quiet menu-toggle" data-action="kit-collapse" aria-label="Toggle navigation" aria-expanded="true">☰ Menu</button><span class="eyebrow">Green Shoe Garage / Field instruments</span>${kit.controls()}${state.session.environment !== "production" ? `<span class="environment">${esc(state.session.environment)}</span>` : ""}</div>${content}</main></div>`;
  kit.apply();
}
function render() {
  connectionBanner();
  publicIntroduction(!state.session?.user && !["field", "offline"].includes(state.view));
  if (state.view === "field") return field.render();
  if (state.view === "offline") { app.innerHTML = offline.renderArchive({ esc, archive: state.offlineArchive }); document.querySelector(".page-head .actions")?.insertAdjacentHTML("beforeend", '<button data-action="field-open">Field desk</button>'); return; }
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
  const cards = state.events.map((ev) => `<button class="event-card" data-action="open-event" data-id="${esc(ev.id)}"><div class="card-top">${badge(ev.status)}<span class="role">${esc(ev.role)}</span></div><div><h2>${esc(ev.name)}</h2><p class="hint">${esc(ev.location || "Location to be decided")}</p></div><p class="description">${esc(ev.description || "A new event, ready for its story.")}</p><div class="card-bottom"><span>${ev.member_count} ${ev.member_count === 1 ? "member" : "members"}</span><span>${ev.starts_at ? esc(new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "Open event →"}</span></div></button>`).join("");
  shell(`<header class="page-head"><div><p class="eyebrow">ORACLE · LARP Field Kit</p><h1>Your events</h1><p class="muted">Choose an event to open its briefing, characters, and field tools.</p></div></header>${state.events.length ? `<div class="cards">${cards}</div><details class="panel mt"><summary>Join or organize another event</summary>${renderWelcomeGuide({ eventCount: state.events.length })}</details>` : renderWelcomeGuide()}<p class="footer-note">${state.session.user.isSuperuser ? "Your superuser access includes every event." : "Only events you belong to appear here."}</p>`);
}
function detail() {
  const managerView = isManager() && kit.isOrganizerView();
  if (managerView) { organizerDetail(); kit.enhanceOrganizer(); }
  else kit.renderPlayer();
  if (document.documentElement.dataset.prop === "true") return;
  const enabled = state.event.setup.enabledInstruments;
  const tools = [
    ["trace", "trace-open", "Investigations · TRACE"],
    ["bazaar", "bazaar-open", "Shops & balances · BAZAAR"],
    ["oathbook", "oath-open", "Agreements · OATHBOOK"],
    ["sigil", "sigil-open", "Cooperative challenges · SIGIL"],
    ["static", "static-open", "Fictional readings · STATIC"],
    ["stagehand", "stagehand-open", "Parties & scenes · STAGEHAND"],
  ].filter(([id]) => enabled.includes(id)).map(([, action, label]) => `<button data-action="${action}">${label}</button>`).join("");
  const news = enabled.some((id) => ["whisper", "broadside"].includes(id));
  const guidance = renderEventGuide({ event: state.event, accountId: state.session.user.id, isManager: Boolean(isManager()), audience: managerView ? "organizer" : "player", members: state.members, online: connectionState === "online" });
  document.querySelector(".workspace .page-head, .workspace .world-header")?.insertAdjacentHTML("afterend", `${guidance}<section class="panel character-entry"><h2>Your field tools</h2><div class="actions"><button data-action="character-open">Characters</button><button class="primary" data-action="adv-open">Open adventure</button><button data-action="exchange-open">Exchanges</button></div>${tools || news ? `<details class="mt"><summary>More tools for this event</summary><div class="actions mt">${news ? '<button data-action="story-open">Rumors & news</button>' : ""}${tools}</div></details>` : ""}${isManager() || state.event.role === "staff" ? `<details class="mt"><summary>Organizer and staff tools</summary><div class="actions mt">${news ? '<button data-action="story-manage">Prepare rumors & news</button>' : ""}${enabled.includes("sigil") ? '<button data-action="sigil-manage">Prepare cooperative challenges</button>' : ""}${enabled.includes("static") ? '<button data-action="static-manage">Prepare fictional readings</button>' : ""}${enabled.includes("stagehand") ? '<button data-action="stagehand-manage">Run encounters</button>' : ""}${isManager() ? `<button data-action="advedit-open">Prepare adventure</button><button data-action="sharing-open">Sharing rules</button>${enabled.includes("bazaar") ? '<button data-action="bazaar-manage">Manage shops & balances</button>' : ""}${enabled.includes("oathbook") ? '<button data-action="oath-manage">Review agreements</button>' : ""}` : ""}</div></details>` : ""}</section>`);
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
  if (destination === "logout") {
    const accountId = state.session?.user?.id;
    lockDevice(accountId);
    await forgetLocalAccess();
    toast("Signed out on this device. Local readings, drafts, and pending requests were cleared.");
    void finishSignout();
    return;
  }
  if (destination.startsWith("field-") && pendingSignout()) {
    toast("This device is signed out. Reconnect and sign in before opening private Field desk data.");
    return;
  }
  if (["events", "account", "logout", "open-event", "create", "kit-import", "character-open", "adv-open", "advedit-open", "advedit-starter", "offline-open", "admin-open", "exchange-open", "sharing-open", "story-open", "story-manage", "trace-open", "bazaar-open", "bazaar-manage", "oath-open", "oath-manage", "sigil-open", "sigil-manage", "static-open", "static-manage", "stagehand-open", "stagehand-manage", "field-open"].includes(destination)) {
    if (state.view === "field" && !field.confirmDiscard()) return;
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
  if (await install.action(button)) return;
  if (await field.action(button)) return;
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
    case "connection-check":
      await checkConnection();
      break;
    case "offline-open":
      await openOffline();
      break;
    case "offline-refresh":
      await start();
      break;
    case "offline-clear": {
      if (!window.confirm("Delete all prepared event kits, saved readings, Field desk notes, and queued requests on this device? Requests already sent may have reached the server; clearing this device does not cancel them.")) break;
      const epoch = authEpoch, accountId = state.session?.user?.id;
      const archiveClear = offline.clearArchive({ keepAccount: Boolean(accountId) }), fieldClear = fieldStore.clearAll();
      await Promise.all([archiveClear, fieldClear]);
      if (epoch !== authEpoch) return;
      if (accountId) await fieldStore.setAccount(accountId);
      if (epoch !== authEpoch) return;
      await openOffline();
      toast("Prepared kits, saved readings, local drafts, and pending requests cleared from this device.");
      break;
    }
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
      const eventId = state.event.id, accountId = state.session.user.id, epoch = authEpoch;
      await api(`/api/events/${eventId}/members/${id}`, "DELETE");
      if (id === accountId) {
        await forgetEventAccess(eventId);
        if (epoch !== authEpoch) return;
        await loadEvents();
      } else { closeModal(); await loadEvent(eventId); }
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
  if (e.target.closest('a.skip[href="#main"]')) { e.preventDefault(); focusMain(); return; }
  const button = e.target.closest("button[data-action]");
  if (!button || button.disabled || state.busy && button.dataset.action !== "logout") return;
  const interaction = ++interactionEpoch;
  state.busy = true;
  button.disabled = true;
  beginOperation(interaction, button);
  try {
    await action(button);
  } catch (error) {
    const visible = modal.open ? modalContent : app;
    if (interaction === interactionEpoch) setError(visible, error);
  } finally {
    if (interaction === interactionEpoch) state.busy = false;
    button.disabled = false;
    endOperation(interaction, button);
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
  const interaction = ++interactionEpoch;
  state.busy = true;
  const submit = form.querySelector('button[type="submit"]');
  if (submit) submit.disabled = true;
  beginOperation(interaction, submit);
  const input = Object.fromEntries(new FormData(form));
  const error = form.querySelector(".error");
  if (error) error.textContent = "";
  try {
    if (await field.submit(form)) return;
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
        // An older logout response must finish before a new login can set its
        // cookie. Aborted/uncertain logout does not authorize a racing login.
        if (pendingSignout()) {
          const ended = await finishSignout({ forLogin: true });
          if (!ended) throw new Error("The previous sign-out is still unconfirmed. Reconnect and try signing in again after it finishes.");
        }
        const loginEpoch = authEpoch;
        const result = await api(`/api/auth/${state.authMode}`, "POST", input);
        if (loginEpoch !== authEpoch) return;
        unlockDevice();
        state.session ||= { version: "1.0.0", user: null };
        state.session.user = result.user;
        await offline.setAccount(result.user.id).catch(() => {});
        if (loginEpoch !== authEpoch || state.session?.user?.id !== result.user.id || pendingSignout()) return;
        await fieldStore.setAccount(result.user.id).catch(() => {});
        if (loginEpoch !== authEpoch || state.session?.user?.id !== result.user.id || pendingSignout()) return;
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
    if (interaction === interactionEpoch) setError(form, error);
  } finally {
    if (interaction === interactionEpoch) state.busy = false;
    if (submit) submit.disabled = false;
    endOperation(interaction, submit);
  }
});
window.addEventListener("hashchange", async () => {
  try {
    if (["#prop/", "#exchange/", "#badge/", "#sigil/", "#static/"].some((prefix) => location.hash.startsWith(prefix)) && (!field.confirmDiscard() || !kit.confirmDiscard() || !characters.confirmDiscard() || !adventure.confirmDiscard() || !adventureOrganizer.confirmDiscard() || !sharing.confirmDiscard() || !exchanges.confirmDiscard() || !story.confirmDiscard() || !trace.confirmDiscard() || !economy.confirmDiscard() || !oaths.confirmDiscard() || !sigil.confirmDiscard() || !signals.confirmDiscard() || !stagehand.confirmDiscard())) {
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
// Connectivity changes update only the status strip, preserving active forms.
window.addEventListener("offline", () => {
  connectionEpoch++; connectionState = "offline"; connectionBanner();
  toast("Connection lost. Your open drafts remain here. Field desk notes are saved on this device.");
});
window.addEventListener("online", () => { void checkConnection(); });
async function forgetLocalAccess() {
  authEpoch++; connectionEpoch++;
  interactionEpoch++; state.busy = false;
  endOperation(interactionEpoch);
  const archiveClear = offline.clearArchive(), fieldClear = fieldStore.clearAll();
  resetPrivateViews();
  state.session = { ...(state.session || { version: "1.0.0" }), user: null };
  state.event = null; state.events = []; state.members = []; state.transitions = [];
  state.offlineArchive = null; state.view = "events";
  closeModal(true); render();
  await Promise.allSettled([archiveClear, fieldClear]);
}
async function forgetEventAccess(eventId, removeEvent = true) {
  eventEpochs.set(eventId, (eventEpochs.get(eventId) || 0) + 1);
  // Both stores publish their invalidation before either storage operation is awaited.
  const archivePurge = offline.purgeEvent(eventId), fieldPurge = fieldStore.purgeEvent(eventId);
  state.offlineArchive = null;
  if (removeEvent) state.events = state.events.filter((event) => event.id !== eventId);
  if (state.event?.id === eventId || ["offline", "field"].includes(state.view)) {
    resetPrivateViews(); state.event = null; state.members = []; state.transitions = [];
    state.view = "events"; closeModal(true); render();
  }
  await Promise.allSettled([archivePurge, fieldPurge]);
}
async function finishSignout({ forLogin = false } = {}) {
  const pending = pendingSignout();
  if (!pending || navigator.onLine === false) { connectionBanner(); return false; }
  if (pending.invalid) {
    if (forLogin) { unlockDevice(); return true; }
    connectionBanner(); return false;
  }
  try {
    if (!signoutFlight) {
      const flight = (async () => {
        // A pending password change may set a replacement cookie. Let all
        // already-transmitted writes settle before revoking this browser's
        // final cookie; local privacy clearing has already completed.
        await writesIdle();
        return requestJSON("/api/auth/logout", "POST", {}, { expectedAccount: pending.accountId, timeoutMs: 12000 });
      })();
      signoutFlight = flight;
      void flight.finally(() => { if (signoutFlight === flight) signoutFlight = null; }).catch(() => {});
    }
    const { response } = await signoutFlight;
    if ((response.ok || response.status === 401 || forLogin && response.status === 409) && pendingSignout()?.id === pending.id) {
      unlockDevice(); connectionState = "online"; connectionBanner();
      toast(response.status === 409 ? "Local access cleared. Sign in to the account you want to use." : "Signed out. The previous browser session is no longer active.");
      return true;
    }
    if (!pendingSignout()) return true;
  } catch { /* Local sign-out remains effective while server logout is uncertain. */ }
  connectionBanner(); return false;
}
async function checkConnection() {
  const epoch = ++connectionEpoch;
  connectionState = "checking"; connectionBanner();
  if (pendingSignout()) { await finishSignout(); return; }
  try {
    const session = await api("/api/session");
    if (epoch !== connectionEpoch) return;
    if (state.session?.user && session.user?.id !== state.session.user.id) {
      await forgetLocalAccess();
      toast("Your session expired or changed. Sign in again. Local private data has been cleared.");
      return;
    }
    connectionState = "online"; connectionBanner();
    toast("Connected. Review pending information requests in the Field desk before sending.");
  } catch (error) {
    if (epoch === connectionEpoch) { connectionState = "offline"; connectionBanner(); }
  }
}
function externalPrivacyChange(change) {
  if (!change?.external || !["account", "clear", "event"].includes(change.type)) return;
  if (change.type === "event" && change.eventId) {
    eventEpochs.set(change.eventId, (eventEpochs.get(change.eventId) || 0) + 1);
    state.offlineArchive = null;
    state.events = state.events.filter((event) => event.id !== change.eventId);
    if (state.event?.id === change.eventId || ["offline", "field"].includes(state.view)) {
      interactionEpoch++; state.busy = false;
      endOperation(interactionEpoch);
      resetPrivateViews(); state.event = null; state.members = []; state.transitions = [];
      state.view = "events"; closeModal(true); render();
    }
    return;
  }
  authEpoch++; connectionEpoch++;
  interactionEpoch++; state.busy = false;
  endOperation(interactionEpoch);
  resetPrivateViews(); state.offlineArchive = null;
  state.event = null; state.events = []; state.members = []; state.transitions = [];
  state.session = { ...(state.session || { version: "1.0.0" }), user: null };
  state.view = "events"; closeModal(true); render();
  toast("Local account access changed in another tab. Reconnect before continuing.");
}
offline.subscribeArchive?.(externalPrivacyChange);
fieldStore.subscribe?.((change) => {
  if (change?.external && change.type === "invalidate") externalPrivacyChange({ ...change, type: change.eventId ? "event" : "clear" });
});
window.addEventListener("storage", (event) => {
  if (event.key === LOCAL_SIGNOUT_KEY && event.newValue) {
    memorySignout = null;
    externalPrivacyChange({ external: true, type: "clear" });
  }
});
async function openOffline() {
  if (pendingSignout()) { await forgetLocalAccess(); return; }
  const epoch = authEpoch, capturedEvents = new Map(eventEpochs);
  const archive = await offline.loadArchive().catch(() => ({ accountId: null, records: [], lastChecked: null }));
  if (epoch !== authEpoch || pendingSignout()) return;
  archive.records = archive.records.filter((record) => (capturedEvents.get(record.event.id) || 0) === (eventEpochs.get(record.event.id) || 0));
  state.offlineArchive = archive;
  state.view = "offline";
  closeModal(true);
  render();
}
async function start() {
  if (pendingSignout()) {
    await finishSignout();
    if (pendingSignout()) { await forgetLocalAccess(); return; }
  }
  try {
    const epoch = authEpoch;
    const previousUser = state.session?.user?.id;
    const session = await api("/api/session");
    if (epoch !== authEpoch || pendingSignout()) return;
    state.session = session;
    if (previousUser !== state.session.user?.id) resetPrivateViews();
    await offline.setAccount(state.session.user?.id || null).catch(() => {});
    if (epoch !== authEpoch || pendingSignout()) return;
    await fieldStore.setAccount(state.session.user?.id || null).catch(() => {});
    if (epoch !== authEpoch || pendingSignout()) return;
    state.offlineArchive = null;
    state.view = "events";
    if (state.session.user) await loadEvents();
    else render();
  } catch (error) {
    if (error.status === 401 || pendingSignout()) { render(); return; }
    await openOffline();
  }
}
install.init().catch(() => {});
start().then(() => startup.finish({ offline: state.view === "offline", signedIn: Boolean(state.session?.user) })).catch(() => {
  publicIntroduction(true);
  app.innerHTML = '<main id="main" class="auth-form" tabindex="-1"><h1>Unable to open your field kit</h1><p>Check your connection, then reload ORACLE to try again.</p><p><a href="/">Reload ORACLE</a> · <a href="/help.html">Help &amp; guides</a></p></main>';
  startup.finish({ error: true });
});
