"use strict";
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
const isManager = () => ["owner", "organizer"].includes(state.event?.role);
const badge = (v) => `<span class="badge ${esc(v)}">${esc(v)}</span>`;
const err = '<p class="error" role="alert"></p>';
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
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: data === undefined ? undefined : JSON.stringify(data),
  });
  const result = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    if (response.status === 401 && state.session?.user) {
      state.session.user = null;
      render();
    }
    throw new Error(result.error || "Request failed. Please try again.");
  }
  return result;
}
function openModal(heading, content) {
  modalContent.innerHTML = `<div class="modal-head"><h2 id="modal-title">${esc(heading)}</h2><button type="button" data-action="close" aria-label="Close dialog">×</button></div>${content}`;
  if (!modal.open) modal.showModal();
}
function closeModal() {
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
  const signup = state.authMode === "register";
  app.innerHTML = `<div class="auth-wrap"><section class="auth-intro"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><h1>Bring your people<br>into the story.</h1><p>Prepare an event, assemble your crew, and give your next world a place to begin.</p><p class="auth-footer">Green Shoe Garage · v${esc(state.session?.version || "0.1.0")}</p></section><main id="main" class="auth-form"><p class="eyebrow">Your field kit</p><h2>${signup ? "Create your account" : "Welcome back"}</h2><p>${signup ? "One account. A place in every world you join." : "Sign in to open your events."}</p><form id="auth-form">${err}${signup ? '<div><label for="displayName">Display name</label><input id="displayName" name="displayName" minlength="2" maxlength="80" required autocomplete="nickname"><p class="hint">Shown to the people in your events.</p></div>' : ""}<div><label for="email">Email address</label><input id="email" name="email" type="email" maxlength="254" required autocomplete="email"></div><div><label for="password">Password</label><input id="password" name="password" type="password" minlength="12" maxlength="128" required autocomplete="${signup ? "new-password" : "current-password"}">${signup ? '<p class="hint">At least 12 characters. A passphrase works well.</p>' : ""}</div><button class="primary" type="submit">${signup ? "Create account" : "Sign in"}</button></form>${state.session?.registrationEnabled ? `<button class="switch" data-action="auth-switch">${signup ? "Already have an account? Sign in" : "New to ORACLE? Create an account"}</button>` : ""}<p class="auth-footer">${state.session?.environment === "staging" ? "Staging environment — use test accounts and events." : "Your email is kept private. Events are visible to their members."}</p></main></div>`;
}
function shell(content) {
  app.innerHTML = `${!navigator.onLine ? '<div class="offline-banner">You are offline. Changes need a connection in this release.</div>' : ""}<div class="layout"><aside class="sidebar"><div class="brand"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p></div><nav aria-label="Main navigation"><button class="nav-button ${state.view !== "account" ? "active" : ""}" data-action="events">My events</button><button class="nav-button ${state.view === "account" ? "active" : ""}" data-action="account">Account</button></nav><div class="sidebar-footer"><div><p class="account-name">${esc(state.session.user.displayName)}</p><p class="version">ORACLE / v${esc(state.session.version)}</p></div><button class="quiet" data-action="logout">Sign out</button></div></aside><main class="workspace" id="main"><div class="topbar"><span class="eyebrow">Green Shoe Garage / Field instruments</span>${state.session.environment !== "production" ? `<span class="environment">${esc(state.session.environment)}</span>` : ""}</div>${content}</main></div>`;
}
function render() {
  if (!state.session?.user) return auth();
  if (state.view === "account") return account();
  if (state.view === "detail" && state.event) return detail();
  events();
}
function events() {
  const active = state.events.filter((x) =>
    ["live", "paused", "rehearsal"].includes(x.status),
  ).length;
  shell(
    `<header class="page-head"><div><p class="eyebrow">Event workspace</p><h1>Your worlds, ready to begin.</h1><p class="muted">Open an event to prepare your crew and manage the day.</p></div><div class="actions"><button data-action="join">Join an event</button><button class="primary" data-action="create">+ Create event</button></div></header><div class="summary"><div><strong>${state.events.length}</strong><span>events</span></div><div><strong>${active}</strong><span>in rehearsal or running</span></div><div><strong>${state.events.filter((x) => ["owner", "organizer"].includes(x.role)).length}</strong><span>you organize</span></div></div>${state.events.length ? `<div class="cards">${state.events.map((ev) => `<button class="event-card" data-action="open-event" data-id="${esc(ev.id)}"><div class="card-top">${badge(ev.status)}<span class="role">${esc(ev.role)}</span></div><div><h2>${esc(ev.name)}</h2><p class="hint">${esc(ev.location || "Location to be decided")}</p></div><p class="description">${esc(ev.description || "A new event, ready for its story.")}</p><div class="card-bottom"><span>${ev.member_count} ${ev.member_count === 1 ? "member" : "members"}</span><span>${ev.starts_at ? esc(new Date(ev.starts_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })) : "Open event →"}</span></div></button>`).join("")}</div>` : `<section class="empty"><div class="number">01 / Assemble your crew</div><h2>Every world starts somewhere.</h2><p>Create your first event, or enter an invitation code from your organizer. Your events will appear here.</p><div class="actions"><button class="primary" data-action="create">Create your first event</button><button data-action="join">I have an invitation</button></div></section>`}<p class="footer-note">Only events you belong to appear here.</p>`,
  );
}
function detail() {
  const ev = state.event;
  shell(
    `<div class="actions"><button class="quiet" data-action="events">← My events</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(ev.role)} workspace</p><h1>${esc(ev.name)}</h1><p>${badge(ev.status)} <span class="role">${state.members.length} ${state.members.length === 1 ? "member" : "members"}</span></p></div><div class="actions"><button data-action="refresh-event">Refresh</button>${isManager() && !["ended", "archived"].includes(ev.status) ? '<button class="primary" data-action="invite">Invite people</button>' : ""}</div></header><div class="detail-grid"><div class="stack"><section class="panel"><div class="panel-head"><h2>Event briefing</h2>${isManager() && ev.status !== "archived" ? '<button class="quiet" data-action="edit-event">Edit details</button>' : ""}</div><p class="prose">${esc(ev.description || "Your organizer has not added a briefing yet.")}</p><dl class="facts"><div><dt>Location</dt><dd>${esc(ev.location || "To be decided")}</dd></div><div><dt>Starts</dt><dd>${esc(date(ev.starts_at))}</dd></div></dl></section><section class="panel"><div class="panel-head"><h2>People</h2><span class="muted">${state.members.length}</span></div><ul class="member-list">${state.members.map((m) => `<li><div><p>${esc(m.display_name)}${m.user_id === state.session.user.id ? ' <span class="muted">(you)</span>' : ""}</p><span class="role">${esc(m.role)}</span></div><div class="actions">${ev.role === "owner" && m.role !== "owner" ? `<button data-action="role" data-id="${esc(m.user_id)}">Change role</button>` : ""}${m.role !== "owner" && ((isManager() && (m.role !== "organizer" || ev.role === "owner")) || m.user_id === state.session.user.id) ? `<button class="quiet danger" data-action="remove-member" data-id="${esc(m.user_id)}">${m.user_id === state.session.user.id ? "Leave" : "Remove"}</button>` : ""}</div></li>`).join("")}</ul></section></div><div class="stack"><section class="panel"><h2>Event status</h2><div class="lifecycle">${["draft", "rehearsal", "live", "paused", "ended", "archived"].map((x) => `<span class="${x === ev.status ? "current" : ""}">${title(x)}</span>`).join("")}</div><p class="hint">${esc({ draft: "Prepare your event and invite your crew.", rehearsal: "Practice the event flow before opening play.", live: "Your event is running.", paused: "Play is paused. Members can still read the briefing.", ended: "Play has finished. Existing members retain access.", archived: "This event is kept as a read-only record." }[ev.status])}</p>${isManager() ? `<div class="actions mt">${state.transitions.map((s) => `<button class="${s === "live" ? "primary" : ""}" data-action="status" data-status="${s}">${{ rehearsal: "Start rehearsal", draft: "Return to draft", live: ev.status === "paused" ? "Resume event" : "Go live", paused: "Pause event", ended: "End event", archived: "Archive event" }[s]}</button>`).join("")}</div>` : ""}</section>${isManager() ? '<section class="panel"><h2>Organizer tools</h2><p class="hint">Manage access and review changes to this event.</p><div class="actions mt"><button data-action="invitations">Invitation codes</button><button data-action="audit">Activity log</button></div></section>' : '<section class="panel"><h2>Your place in the event</h2><p class="hint">Your organizer controls event details and access. Use your character name as your display name if you prefer.</p></section>'}</div></div>`,
  );
}
function account() {
  shell(
    `<header class="page-head"><div><p class="eyebrow">Your account</p><h1>Keep your access secure.</h1><p class="muted">${esc(state.session.user.email)}</p></div></header><section class="panel narrow"><h2>Change password</h2><p class="hint">Changing your password signs out your other sessions.</p><form id="password-form" class="mt">${err}<div><label for="currentPassword">Current password</label><input type="password" id="currentPassword" name="currentPassword" minlength="12" maxlength="128" autocomplete="current-password" required></div><div><label for="newPassword">New password</label><input type="password" id="newPassword" name="newPassword" minlength="12" maxlength="128" autocomplete="new-password" required></div><button class="primary" type="submit">Update password</button></form></section>`,
  );
}
async function loadEvents() {
  state.events = (await api("/api/events")).events;
  state.view = "events";
  state.event = null;
  render();
}
async function loadEvent(id) {
  const result = await api(`/api/events/${id}`);
  Object.assign(state, { view: "detail", ...result });
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
    `<form id="invite-form">${err}<div><label for="role">Join as</label><select id="role" name="role"><option value="player">Player — view the event</option><option value="staff">Staff — join the event crew</option>${state.event.role === "owner" ? '<option value="organizer">Organizer — manage this event</option>' : ""}</select><p class="hint">Staff tools will expand as event instruments are added. Staff and organizer codes admit one person.</p></div><div class="two-fields"><div><label for="maxUses">Maximum people</label><input id="maxUses" name="maxUses" type="number" min="1" max="1000" value="20" required></div><div><label for="expiresInHours">Expires in hours</label><input id="expiresInHours" name="expiresInHours" type="number" min="1" max="168" value="48" required></div></div><button class="primary" type="submit">Create invitation code</button></form>`,
  );
}
function confirmModal(heading, message, action, attributes, label) {
  openModal(
    heading,
    `<p class="muted">${esc(message)}</p>${err}<div class="actions mt"><button class="primary" data-action="${action}" ${attributes}>${esc(label)}</button><button data-action="close">Cancel</button></div>`,
  );
}
async function action(button) {
  const id = button.dataset.id;
  switch (button.dataset.action) {
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
      state.session.user = null;
      state.events = [];
      state.event = null;
      closeModal();
      render();
      break;
    case "create":
      eventForm();
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
        `<p class="hint">Codes are shown only when created. Revoke access here or create a new code.</p>${err}<ul class="invite-list">${invitations.length ? invitations.map((i) => `<li><div class="card-top"><strong>${esc(title(i.role))}</strong>${!i.revoked_at && new Date(i.expires_at) > new Date() && i.uses < i.max_uses && (state.event.role === "owner" || i.role !== "organizer") ? `<button class="quiet danger" data-action="revoke" data-id="${esc(i.id)}">Revoke</button>` : ""}</div><p class="hint">${i.uses}/${i.max_uses} used · ${i.revoked_at ? "Revoked" : new Date(i.expires_at) <= new Date() ? "Expired" : `Expires ${esc(date(i.expires_at))}`}</p></li>`).join("") : "<li>No invitation codes yet.</li>"}</ul>`,
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
  submit.disabled = true;
  const input = Object.fromEntries(new FormData(form));
  const error = form.querySelector(".error");
  if (error) error.textContent = "";
  try {
    switch (form.id) {
      case "auth-form": {
        const result = await api(`/api/auth/${state.authMode}`, "POST", input);
        state.session.user = result.user;
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
    submit.disabled = false;
  }
});
window.addEventListener("offline", () => {
  render();
  toast("Connection lost. Changes need a connection.");
});
window.addEventListener("online", () => {
  render();
  toast("Connection restored. Refresh the event to see current information.");
});
async function start() {
  try {
    state.session = await api("/api/session");
    if (state.session.user) await loadEvents();
    else render();
  } catch {
    app.innerHTML =
      '<main class="boot" id="main"><div class="wordmark">ORACLE</div><p>LARP Field Kit</p><p class="error">Unable to connect. Check your connection, then reload this page.</p></main>';
  }
}
start();
