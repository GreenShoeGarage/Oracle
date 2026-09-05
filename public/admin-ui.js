export function createAdminUI(ctx) {
  const { state, api, shell, esc, openModal, closeModal, toast, err } = ctx;
  const limit = 25;
  let users = [], entries = [], total = 0, page = 1, auditPage = 1;
  let query = "", loading = false, errorMessage = "", viewerId = null;
  const when = (value) => value ? new Date(value).toLocaleString() : "—";
  const disabled = (value) => value ? "disabled" : "";
  const auditNames = {
    "superuser.provisioned": "Superuser provisioned",
    "superuser.claimed": "Superuser account created",
    "user.disabled": "Account disabled",
    "user.enabled": "Account enabled",
    "user.sessions_revoked": "Sessions signed out",
  };

  function render() {
    if (!state.session?.user?.isSuperuser) {
      state.view = "events";
      return ctx.render();
    }
    const pages = Math.max(1, Math.ceil(total / limit));
    shell(`<header class="page-head"><div><p class="eyebrow">Project administration</p><h1>People and access.</h1><p class="muted">Manage accounts across ORACLE. Event tools are available from All events.</p></div><button data-action="admin-refresh" ${disabled(loading)}>Refresh</button></header>${errorMessage ? `<p class="error" role="alert">${esc(errorMessage)}</p>` : ""}${loading ? '<p class="hint" role="status">Loading project accounts…</p>' : ""}<div class="stack"><section class="panel"><div class="panel-head"><h2>Accounts</h2><span class="muted">${total} ${total === 1 ? "account" : "accounts"}</span></div><form id="admin-search-form"><label for="admin-search">Search name or email</label><div class="actions"><input id="admin-search" name="q" type="search" maxlength="80" value="${esc(query)}" placeholder="Name or email" autocomplete="off"><button type="submit" ${disabled(loading)}>Search</button>${query ? `<button type="button" class="quiet" data-action="admin-clear-search" ${disabled(loading)}>Clear</button>` : ""}</div>${err}</form><ul class="member-list">${users.map((user) => {
      const self = user.id === state.session.user.id;
      return `<li><div><p>${esc(user.display_name)}${self ? ' <span class="muted">(you)</span>' : ""}</p><p class="hint">${esc(user.email)}</p><span class="badge ${user.is_disabled ? "paused" : "live"}">${user.is_disabled ? "Disabled" : "Enabled"}</span>${user.is_superuser ? ' <span class="role">Project superuser</span>' : ""}<p class="hint">Joined ${esc(when(user.created_at))}</p></div><div class="actions"><button data-action="admin-revoke" data-id="${esc(user.id)}" ${disabled(loading)}>Sign out sessions</button>${!self && !user.is_superuser ? `<button class="quiet ${user.is_disabled ? "" : "danger"}" data-action="admin-${user.is_disabled ? "enable" : "disable"}" data-id="${esc(user.id)}" ${disabled(loading)}>${user.is_disabled ? "Enable account" : "Disable account"}</button>` : ""}</div></li>`;
    }).join("")}</ul>${!users.length && !loading ? '<p class="hint">No accounts match this search.</p>' : ""}<div class="actions mt"><button data-action="admin-users-previous" ${disabled(loading || page <= 1)}>Previous</button><span class="hint" role="status">Page ${page} of ${pages}</span><button data-action="admin-users-next" ${disabled(loading || page >= pages)}>Next</button></div></section><section class="panel"><div class="panel-head"><h2>Project activity</h2><span class="hint">Latest first</span></div><ul class="member-list">${entries.map((entry) => `<li><div><p>${esc(auditNames[entry.action] || entry.action)}</p><p class="hint">${esc(entry.actor_name || "Deployment")}${entry.target_name ? ` → ${esc(entry.target_name)}` : ""}${entry.action === "user.sessions_revoked" ? ` · ${Number(entry.details?.count) || 0} sessions` : ""}</p></div><time class="hint" datetime="${esc(entry.created_at)}">${esc(when(entry.created_at))}</time></li>`).join("")}</ul>${!entries.length && !loading ? '<p class="hint">No project activity on this page.</p>' : ""}<div class="actions mt"><button data-action="admin-audit-previous" ${disabled(loading || auditPage <= 1)}>Previous</button><span class="hint">Page ${auditPage}</span><button data-action="admin-audit-next" ${disabled(loading || entries.length < limit || auditPage >= 10000)}>Next</button></div></section></div>`);
  }

  async function load() {
    loading = true;
    errorMessage = "";
    if (state.view === "admin") render();
    try {
      const [accounts, audit] = await Promise.all([
        api(`/api/admin/users?q=${encodeURIComponent(query)}&page=${page}&limit=${limit}`),
        api(`/api/admin/audit?page=${auditPage}&limit=${limit}`),
      ]);
      users = accounts.users;
      total = accounts.total;
      entries = audit.entries;
    } catch (error) {
      users = []; entries = []; total = 0;
      errorMessage = error.message || "Unable to load project accounts. Try Refresh.";
    } finally {
      loading = false;
      if (state.view === "admin") {
        if (state.session?.user?.isSuperuser) render();
        else ctx.render();
      }
    }
  }

  async function open() {
    if (!state.session?.user?.isSuperuser) throw new Error("Project superuser access is required.");
    if (viewerId !== state.session.user.id) {
      users = []; entries = []; total = 0; page = 1; auditPage = 1; query = "";
      viewerId = state.session.user.id;
    }
    state.view = "admin";
    state.event = null;
    await load();
  }

  function confirm(operation, id) {
    const user = users.find((entry) => entry.id === id);
    if (!user) throw new Error("Refresh the account list and try again.");
    if (operation === "disable" && (user.is_superuser || user.id === state.session.user.id))
      throw new Error("Superuser accounts cannot be disabled here.");
    const labels = { disable: "Disable account", enable: "Enable account", revoke: "Sign out sessions" };
    const explanations = {
      disable: "This person will be signed out and unable to sign in. Their events and characters will be retained. You can enable the account again later.",
      enable: "This person will be able to sign in again with their existing password.",
      revoke: user.id === state.session.user.id ? "This signs you out on every device, including this one. You can sign in again with your existing password." : "This signs this person out on every device. They can sign in again with their existing password.",
    };
    openModal(labels[operation], `<p><strong>${esc(user.display_name)}</strong><br><span class="hint">${esc(user.email)}</span></p><p class="muted">${esc(explanations[operation])}</p><form id="admin-confirm-form" data-operation="${operation}" data-id="${esc(id)}">${err}<div class="actions"><button type="submit" class="${operation === "disable" ? "danger" : "primary"}">${labels[operation]}</button><button type="button" class="quiet" data-action="close">Cancel</button></div></form>`);
  }

  async function action(button) {
    const name = button.dataset.action;
    if (name === "admin" || name === "admin-open") { await open(); return true; }
    if (!name?.startsWith("admin-")) return false;
    if (loading) return true;
    if (name === "admin-refresh") await load();
    else if (name === "admin-clear-search") { query = ""; page = 1; await load(); }
    else if (name === "admin-users-previous" && page > 1) { page--; await load(); }
    else if (name === "admin-users-next" && page < Math.ceil(total / limit)) { page++; await load(); }
    else if (name === "admin-audit-previous" && auditPage > 1) { auditPage--; await load(); }
    else if (name === "admin-audit-next" && entries.length === limit && auditPage < 10000) { auditPage++; await load(); }
    else if (["admin-disable", "admin-enable", "admin-revoke"].includes(name)) confirm(name.slice(6), button.dataset.id);
    else return false;
    return true;
  }

  async function submit(form) {
    if (form.id === "admin-search-form") {
      query = String(new FormData(form).get("q") || "").trim();
      page = 1;
      await load();
      return true;
    }
    if (form.id !== "admin-confirm-form") return false;
    const { operation, id } = form.dataset;
    if (!["disable", "enable", "revoke"].includes(operation)) throw new Error("Unknown account action.");
    if (operation === "revoke") {
      const result = await api(`/api/admin/users/${encodeURIComponent(id)}/sessions`, "DELETE");
      closeModal();
      toast(`${result.revoked} ${result.revoked === 1 ? "session signed" : "sessions signed"} out.`);
      if (id === state.session.user.id) {
        state.session = await api("/api/session");
        users = []; entries = []; viewerId = null;
        ctx.render();
        return true;
      }
    } else {
      await api(`/api/admin/users/${encodeURIComponent(id)}`, "PATCH", { disabled: operation === "disable" });
      closeModal();
      toast(operation === "disable" ? "Account disabled and sessions signed out." : "Account enabled.");
    }
    await load();
    return true;
  }

  return { render, open, action, submit };
}
