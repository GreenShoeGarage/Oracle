const clone = value => structuredClone(value);
const comparable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const amount = value => Number(value || 0).toLocaleString();

export function createEconomyUI(ctx) {
  const { state, api, shell, esc, loadEvent, toast, err } = ctx;
  let dashboard = null, accountId = null, eventId = null, characterId = null, manage = false, epoch = 0;
  let editor = null, savedEditor = null, dirty = false, pending = null, conflict = false, feedback = '', feedbackError = false, loading = false;
  const connected = () => navigator.onLine !== false;
  const base = (id = eventId) => `/api/events/${id}/bazaar`;
  const disabled = value => value ? 'disabled' : '';
  const canManage = () => dashboard?.canManage ?? ['owner', 'organizer', 'superuser'].includes(dashboard?.event?.role);
  const writable = () => connected() && !pending && dashboard && (manage ? canManage() && dashboard.event.status !== 'archived' : Boolean(dashboard.character) && !dashboard.readOnly);
  const date = value => value ? new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const resourceName = id => dashboard?.resources?.find(row => row.id === id)?.name || id;
  const characterName = id => dashboard?.characters?.find(row => row.id === id)?.name || 'Character';
  const scope = () => ({ epoch, accountId, eventId, characterId, manage });
  const current = context => context.epoch === epoch && context.accountId && context.accountId === state.session?.user?.id && context.eventId === state.event?.id && context.characterId === characterId && context.manage === manage && state.view === 'bazaar';
  const field = (name, label, value = '', max = 120, required = true) => `<label>${esc(label)}<input name="${esc(name)}" value="${esc(value)}" maxlength="${max}" ${required ? 'required' : ''}></label>`;
  const number = (name, label, value, max, min = 0) => `<label>${esc(label)}<input name="${esc(name)}" type="number" inputmode="numeric" step="1" min="${min}" max="${max}" value="${esc(value)}" required></label>`;
  const area = (name, label, value = '', required = false) => `<label>${esc(label)}<textarea name="${esc(name)}" maxlength="2000" ${required ? 'required' : ''}>${esc(value)}</textarea></label>`;
  const select = (name, label, selected, rows) => `<label>${esc(label)}<select name="${esc(name)}" required>${rows.map(row => `<option value="${esc(row.id)}" ${row.id === selected ? 'selected' : ''}>${esc(row.name)}</option>`).join('')}</select></label>`;
  function reset() { epoch++; dashboard = null; accountId = null; eventId = null; characterId = null; manage = false; editor = null; savedEditor = null; dirty = false; pending = null; conflict = false; feedback = ''; feedbackError = false; loading = false; }
  function ensureAccount() { const who = state.session?.user?.id || null; if (who !== accountId) { reset(); accountId = who; } return who; }
  function setEditor(value) { editor = value ? clone(value) : null; savedEditor = value ? clone(value) : null; dirty = false; conflict = false; }
  function capture() {
    if (!editor || pending || state.view !== 'bazaar') return;
    const form = document.querySelector('#bazaar-editor-form');
    if (!form || form.dataset.editorKey !== editor.key || form.querySelector('fieldset')?.disabled) return;
    const data = new FormData(form);
    const names = { resource: ['resourceId', 'name'], shop: ['name', 'description'], stock: ['name', 'description', 'quantity', 'resourceId', 'unitPrice', 'reason'], adjust: ['characterId', 'resourceId', 'quantity', 'reason', 'agreementId'], purchase: ['quantity'] }[editor.kind];
    for (const name of names) if (data.has(name)) editor[name] = String(data.get(name));
    if (editor.kind === 'shop') editor.enabled = data.get('enabled') === 'on';
    dirty = comparable(editor) !== comparable(savedEditor);
  }
  function moneyFields() { return `${select('resourceId', 'Resource', editor.resourceId, dashboard.resources || [])}${number('unitPrice', 'Price per item', editor.unitPrice, 1000000000, 1)}`; }
  function balanceFor(charId, resourceId) { return dashboard?.balances?.find(row => row.resourceId === resourceId && (!manage || row.characterId === charId)); }
  function purchaseTotal() {
    if (!editor || editor.kind !== 'purchase') return '';
    const quantity = Number(editor.quantity), total = quantity * editor.unitPrice;
    return Number.isSafeInteger(quantity) && quantity > 0 && quantity <= 9999 && Number.isSafeInteger(total) ? `${amount(total)} ${resourceName(editor.resourceId)}` : 'Enter a whole quantity within the available stock.';
  }
  function editorView() {
    if (!editor) return '';
    const kind = editor.kind, title = { resource: 'Create a resource', shop: editor.id ? 'Edit shop' : 'Create a shop', stock: editor.id ? 'Correct shop stock' : 'Add stock', adjust: 'Grant or correct a balance', purchase: 'Review your purchase' }[kind];
    let fields = '';
    if (kind === 'resource') fields = `${field('resourceId', 'Resource code · lowercase letters, digits and hyphens', editor.resourceId, 40)}${field('name', 'Resource name', editor.name, 80)}<p class="hint">Resource codes and names stay fixed so accepted trade terms and receipts keep their meaning.</p>`;
    if (kind === 'shop') fields = `${field('name', 'Shop name', editor.name, 100)}${area('description', 'Description · optional', editor.description)}<label class="check-line"><input type="checkbox" name="enabled" ${editor.enabled ? 'checked' : ''}><span>Open this shop to players</span></label>`;
    if (kind === 'stock') fields = `${field('name', 'Item name', editor.name, 100)}${area('description', 'Item description · optional', editor.description)}<div class="bazaar-field-grid">${number('quantity', 'Stock quantity', editor.quantity, 9999)}${moneyFields()}</div>${editor.id ? area('reason', 'Reason for this stock or price correction', editor.reason, true) : ''}<p class="hint">This quantity becomes the stock restored when a rehearsal is reset. Earlier purchases keep their original price and item name.</p>`;
    if (kind === 'adjust') fields = `${select('characterId', 'Character', editor.characterId, (dashboard.characters || []).filter(row => row.status !== 'retired'))}${select('resourceId', 'Resource', editor.resourceId, dashboard.resources || [])}<p id="bazaar-current-balance" class="hint">Current balance: ${amount(balanceFor(editor.characterId, editor.resourceId)?.quantity)}</p>${number('quantity', 'New total balance', editor.quantity, 1000000000)}${area('reason', 'Reason for this grant or correction', editor.reason, true)}${field('agreementId', 'Related agreement ID · optional', editor.agreementId, 36, false)}<p class="hint">Enter the resulting total. The receipt records the old balance, new balance and reason.</p>`;
    if (kind === 'purchase') fields = `<h3>${esc(editor.name)}</h3><p class="hint">${esc(editor.shopName)} · ${amount(editor.unitPrice)} ${esc(resourceName(editor.resourceId))} each · ${amount(editor.available)} available</p>${editor.description ? `<p class="bazaar-copy">${esc(editor.description)}</p>` : ''}${number('quantity', 'Quantity to buy', editor.quantity, Math.min(9999, editor.available), 1)}<p class="bazaar-total">Total: <strong id="bazaar-purchase-total">${esc(purchaseTotal())}</strong></p><p class="hint">Your balance: ${amount(balanceFor(characterId, editor.resourceId)?.quantity)} ${esc(resourceName(editor.resourceId))}. Stock, balance and inventory change together after server confirmation.</p>`;
    return `<section class="panel bazaar-editor"><form id="bazaar-editor-form" data-editor-key="${esc(editor.key)}">${err}<div class="panel-head"><h2>${title}</h2><span id="bazaar-save-state" class="save-status" role="status">${pending ? 'Waiting for confirmation' : conflict ? 'Review required' : dirty ? 'Unsaved changes · held in this tab' : kind === 'purchase' ? 'Check the quantity and total' : editor.id ? 'Saved revision loaded' : 'New draft · held in this tab'}</span></div>${conflict ? '<div class="bazaar-banner" role="alert"><p>The saved balance, stock or shop has changed. Your entries are retained. Load and review the latest values before submitting again.</p><button class="mt" type="button" data-action="bazaar-review-latest">Load latest values for review</button></div>' : ''}<fieldset class="bazaar-fields" ${disabled(!writable())}><legend>${title}</legend>${fields}</fieldset><div class="actions mt"><button type="submit" class="primary" ${disabled(!writable() || conflict)}>${kind === 'purchase' ? 'Confirm purchase' : kind === 'adjust' ? 'Confirm balance correction' : 'Save'}</button><button type="button" class="quiet" data-action="bazaar-close-editor" ${disabled(Boolean(pending))}>Close</button></div></form></section>`;
  }
  function pendingBanner() { return pending ? `<section class="bazaar-banner" role="status"><strong>${pending.sending ? 'Waiting for server confirmation…' : 'This action has no confirmed response yet.'}</strong><p>${pending.sending ? 'Your requested action is held in this tab.' : 'Retry sends exactly the same request and recovers the result without charging or transferring twice.'}</p>${!pending.sending ? `<button class="primary mt" data-action="bazaar-retry" ${disabled(!connected())}>Retry pending action</button>` : ''}</section>` : ''; }
  function assetsList(assets) {
    const rows = [...(assets?.items || []).map(row => `${amount(row.quantity)} × ${row.name}`), ...(assets?.resources || []).map(row => `${amount(row.quantity)} ${row.name || resourceName(row.resourceId)}`)];
    return rows.length ? `<ul class="bazaar-receipt-items">${rows.map(row => `<li>${esc(row)}</li>`).join('')}</ul>` : '<p class="hint">No assets.</p>';
  }
  function receiptView(record) {
    const value = record.receipt || record, kind = value.kind || record.kind || 'transaction';
    const title = { purchase: 'Purchase', adjustment: 'Balance correction', adjust: 'Balance correction', exchange: 'Player trade', trade: 'Player trade', oath: 'Agreement settlement', oath_settlement: 'Agreement settlement' }[kind] || 'Transaction';
    const transfers = value.transfers || [], purchase = value.purchase, adjustment = value.correction || value.adjustment || value.balance;
    let body = transfers.map(transfer => `<section class="bazaar-receipt-transfer"><p><strong>${esc(transfer.fromName || characterName(transfer.fromCharacterId))}</strong> → <strong>${esc(transfer.toName || characterName(transfer.toCharacterId))}</strong></p>${assetsList(transfer)}</section>`).join('');
    if (purchase) body += `<p>${amount(purchase.quantity)} × ${esc(purchase.name || purchase.itemName || 'Item')} · ${esc(purchase.shopName || 'Shop')}</p><p>Total: ${amount(purchase.total ?? purchase.quantity * purchase.unitPrice)} ${esc(purchase.resourceName || resourceName(purchase.resourceId))}</p>`;
    if (adjustment) body += `<p>${esc(adjustment.characterName || characterName(adjustment.characterId))}: ${amount(adjustment.before ?? adjustment.previousQuantity)} → ${amount(adjustment.after ?? adjustment.quantity)} ${esc(adjustment.resourceName || adjustment.name || resourceName(adjustment.resourceId))}</p>`;
    if (value.items || value.resources) body += assetsList(value);
    if (value.reason || adjustment?.reason) body += `<p class="bazaar-copy"><strong>Reason:</strong> ${esc(value.reason || adjustment.reason)}</p>`;
    const reference = value.agreementId || adjustment?.agreementId || ((kind === 'oath' || kind === 'oath_settlement') ? value.referenceId : null);
    if (reference) body += `<p class="hint">Agreement: ${esc(reference)}</p>`;
    return `<details class="bazaar-receipt"><summary><span>${title}</span><span class="hint">${esc(date(value.createdAt || record.createdAt))}</span></summary>${body || '<p class="hint">Server-confirmed transaction.</p>'}<p class="hint bazaar-reference">Receipt ${esc(value.id || record.id || '')}</p></details>`;
  }
  function receipts() { const rows = dashboard.receipts || []; return `<details class="panel bazaar-section"><summary>Transaction receipts · ${rows.length}</summary><p class="hint">${manage ? 'Organizer history includes the captured terms and reasons for corrections.' : 'Completed purchases, trades and balance corrections for this character.'}</p>${rows.length ? rows.map(receiptView).join('') : '<p class="hint mt">No transactions yet.</p>'}</details>`; }
  function shopsView() {
    const shops = dashboard.shops || [];
    return `<section class="bazaar-section"><div class="panel-head"><h2>Shops</h2>${manage ? `<button data-action="bazaar-new-shop" ${disabled(!writable() || shops.length >= 30)}>Create shop</button>` : ''}</div>${shops.length ? `<div class="bazaar-shops">${shops.map(shop => `<article class="panel bazaar-shop"><div class="panel-head"><h3>${esc(shop.name)}</h3>${manage ? `<span class="badge">${shop.enabled ? 'Open' : 'Hidden'}</span>` : ''}</div>${shop.description ? `<p class="bazaar-copy">${esc(shop.description)}</p>` : ''}${manage ? `<div class="actions mt"><button class="quiet" data-action="bazaar-edit-shop" data-id="${esc(shop.id)}" ${disabled(!writable())}>Edit shop</button><button data-action="bazaar-new-stock" data-id="${esc(shop.id)}" ${disabled(!writable() || !dashboard.resources?.length || (shop.stock?.length || 0) >= 100)}>Add stock</button></div>` : ''}<div class="bazaar-stock">${shop.stock?.length ? shop.stock.map(stock => `<section class="bazaar-stock-row"><div><h4>${esc(stock.name)}</h4>${stock.description ? `<p class="hint bazaar-copy">${esc(stock.description)}</p>` : ''}<p class="bazaar-price">${amount(stock.unitPrice)} ${esc(resourceName(stock.resourceId))}<span class="hint"> each · ${amount(stock.quantity)} in stock</span></p></div><button ${manage ? 'class="quiet"' : ''} data-action="${manage ? 'bazaar-edit-stock' : 'bazaar-buy'}" data-shop-id="${esc(shop.id)}" data-id="${esc(stock.id)}" ${disabled(!writable() || (!manage && (!shop.enabled || stock.quantity < 1)))}>${manage ? 'Correct stock' : stock.quantity < 1 ? 'Sold out' : 'Buy'}</button></section>`).join('') : '<p class="hint mt">No stock has been prepared.</p>'}</div></article>`).join('')}</div>` : '<section class="panel mt"><p class="hint">No shops are open yet. Organizers can prepare resources, shops and stock.</p></section>'}</section>`;
  }
  function managerView() {
    return `<section class="panel bazaar-section"><div class="panel-head"><h2>Resources and balances</h2><div class="actions"><button data-action="bazaar-new-resource" ${disabled(!writable() || dashboard.resources.length >= 20)}>Create resource</button><button data-action="bazaar-adjust" ${disabled(!writable() || !dashboard.resources.length || !dashboard.characters.some(row => row.status !== 'retired'))}>Grant or correct balance</button></div></div>${dashboard.resources.length ? `<div class="bazaar-resources mt">${dashboard.resources.map(resource => `<span class="badge">${esc(resource.name)}</span>`).join('')}</div>` : '<p class="hint mt">Create a whole-unit resource, such as Crowns, Credits or Scrap, before stocking shops or granting balances.</p>'}<details class="mt"><summary>Recorded character balances · ${dashboard.balances.length}</summary><div class="bazaar-balance-list">${dashboard.balances.map(balance => `<div class="bazaar-balance-row"><span><strong>${esc(characterName(balance.characterId))}</strong><span class="hint">${esc(balance.name || resourceName(balance.resourceId))}</span></span><strong>${amount(balance.quantity)}</strong><button class="quiet" data-action="bazaar-adjust" data-character-id="${esc(balance.characterId)}" data-resource-id="${esc(balance.resourceId)}" ${disabled(!writable())}>Correct</button></div>`).join('') || '<p class="hint">Unrecorded balances start at zero.</p>'}</div></details></section>${shopsView()}${receipts()}`;
  }
  function playerView() {
    const chars = dashboard.characters || [], choices = [...chars];
    if (dashboard.character && !choices.some(row => row.id === dashboard.character.id)) choices.push(dashboard.character);
    const picker = choices.length ? `<form id="bazaar-character-form" class="bazaar-character-picker">${err}${select('characterId', 'Shopping as', characterId, choices)}<button type="submit" ${disabled(Boolean(pending))}>Use character</button></form>` : '<section class="empty"><h2>Choose your character first.</h2><p>You need an approved character assigned to you to buy items or trade.</p><button class="primary" data-action="character-open">Open characters</button></section>';
    const assets = dashboard.character ? `<div class="bazaar-assets"><section class="panel"><h2>Your balances</h2>${dashboard.resources.length ? `<dl class="bazaar-wallet">${dashboard.resources.map(resource => `<div><dt>${esc(resource.name)}</dt><dd>${amount(balanceFor(characterId, resource.id)?.quantity)}</dd></div>`).join('')}</dl>` : '<p class="hint mt">Organizers have not defined any spendable resources yet.</p>'}</section><section class="panel"><div class="panel-head"><h2>Your inventory</h2>${typeof ctx.openExchanges === 'function' ? '<button class="quiet" data-action="bazaar-exchanges">Trade with a player</button>' : ''}</div>${dashboard.inventory?.length ? `<ul class="bazaar-inventory">${dashboard.inventory.map(item => `<li><span>${esc(item.name)}</span><strong>${amount(item.quantity)}</strong></li>`).join('')}</ul>` : '<p class="hint mt">Your inventory is empty.</p>'}<p class="hint mt">Inventory and balances are private. QR exchanges reveal only the items and resources you offer.</p></section></div>` : '';
    return `${picker}${dashboard.readOnly ? `<p class="bazaar-banner">${esc(dashboard.message || 'Purchases are available during live play or rehearsal with BAZAAR enabled and an approved character.')}</p>` : ''}${assets}${shopsView()}${dashboard.character ? receipts() : ''}`;
  }
  function render() {
    ensureAccount(); if (state.view !== 'bazaar') return;
    const content = !connected() ? '<section class="empty"><h2>Reconnect to use BAZAAR.</h2><p>Balances, purchases and trades need a current server response. Pending actions stay in this tab for retry.</p></section>' : !dashboard ? `<p role="status">${loading ? 'Loading BAZAAR…' : 'Open an event to see its shops and resources.'}</p>` : `${editorView()}${manage ? managerView() : playerView()}`;
    shell(`<section class="bazaar-workspace"><div class="actions"><button class="quiet" data-action="bazaar-event">← Event briefing</button></div><header class="page-head mt"><div><p class="eyebrow">${esc(dashboard?.event?.name || state.event?.name || '')}</p><h1>BAZAAR</h1><p class="muted">${manage ? 'Prepare shops, manage fictional resources and record corrections.' : 'Spend fictional resources, equip your character and trade.'}</p></div><div class="actions">${canManage() ? `<button data-action="bazaar-toggle" ${disabled(Boolean(pending))}>${manage ? 'Player view' : 'Manage economy'}</button>` : ''}<button data-action="bazaar-refresh" ${disabled(!connected() || Boolean(pending) || loading)}>Refresh</button></div></header>${pendingBanner()}${feedback ? `<p class="bazaar-feedback ${feedbackError ? 'error' : ''}" role="${feedbackError ? 'alert' : 'status'}">${esc(feedback)}</p>` : ''}${content}</section>`);
  }
  async function readDashboard() { return api(`${base()}${manage ? '/manage' : characterId ? `?${new URLSearchParams({ characterId })}` : ''}`); }
  async function open(event = state.event, manager = false, selected = null, agreementId = null) {
    ensureAccount(); if (!event?.id) throw new Error('Open an event before using BAZAAR.');
    if (state.view === 'bazaar' && !confirmDiscard()) return;
    eventId = event.id; manage = Boolean(manager); characterId = selected; dashboard = null; setEditor(null); feedback = ''; feedbackError = false; loading = true; epoch++; state.view = 'bazaar'; const context = scope(); render();
    try { const result = await readDashboard(); if (!current(context)) return; dashboard = result; characterId = manage ? null : result.character?.id || null; state.event.status = result.event.status; if (manage && agreementId && selected && result.resources.length && result.characters.some(row => row.id === selected && row.status !== 'retired')) { const resourceId = result.resources[0].id, balance = balanceFor(selected, resourceId); setEditor({ key: crypto.randomUUID(), kind: 'adjust', characterId: selected, resourceId, quantity: String(balance?.quantity || 0), version: balance?.version || 0, reason: '', agreementId }); } }
    catch (error) { if (!current(context)) return; dashboard = null; feedback = error.message; feedbackError = true; }
    finally { if (context.epoch === epoch && context.accountId === state.session?.user?.id && state.view === 'bazaar') { loading = false; render(); } }
  }
  async function refresh({ review = false } = {}) {
    capture(); if (!dashboard || !connected() || pending) return;
    if (!review && !confirmDiscard()) return;
    const retained = review && editor ? clone(editor) : null;
    epoch++; const context = scope(); loading = true;
    try {
      const result = await readDashboard(); if (!current(context)) return; dashboard = result; state.event.status = result.event.status;
      if (retained) {
        if (retained.kind === 'purchase' || retained.kind === 'stock') {
          const shop = result.shops.find(row => row.id === retained.shopId), stock = shop?.stock.find(row => row.id === retained.id);
          if (!stock) { setEditor(null); feedback = 'This shop item is no longer available.'; feedbackError = true; }
          else if (retained.kind === 'purchase') { setEditor({ ...purchaseDraft(shop, stock), quantity: retained.quantity }); feedback = 'Latest price and stock loaded. Review the total before confirming.'; }
          else { setEditor({ ...retained, version: stock.version }); dirty = true; feedback = `Latest listing: ${stock.name}; ${amount(stock.quantity)} in stock at ${amount(stock.unitPrice)} ${resourceName(stock.resourceId)} each. Description: ${stock.description || 'None'}. Your correction is retained; review it before saving.`; }
        } else if (retained.kind === 'shop') {
          const shop = result.shops.find(row => row.id === retained.id); if (!shop) { setEditor(null); feedback = 'This shop is no longer available.'; } else { setEditor({ ...retained, version: shop.version }); dirty = true; feedback = `Latest shop: ${shop.name}, ${shop.enabled ? 'open' : 'hidden'}. Description: ${shop.description || 'None'}. Your changes are retained for review.`; }
        } else if (retained.kind === 'adjust') { const balance = balanceFor(retained.characterId, retained.resourceId); setEditor({ ...retained, version: balance?.version || 0 }); dirty = true; feedback = `Current balance is ${amount(balance?.quantity)} ${resourceName(retained.resourceId)}. Review your new total before confirming.`; }
        else { editor = retained; conflict = false; feedback = 'Latest values loaded. Review your entries before saving.'; }
      } else { setEditor(null); feedback = 'Balances, stock and receipts refreshed.'; feedbackError = false; }
    } catch (error) { if (!current(context)) return; if ([401, 403, 404].includes(error.status)) { dashboard = null; setEditor(null); } feedback = error.message; feedbackError = true; }
    finally { if (current(context)) { loading = false; render(); } }
  }
  async function mutate(path, method, body, retry = false) {
    ensureAccount(); capture(); if (!connected()) throw new Error('Reconnect before changing BAZAAR.');
    if (pending && !retry) throw new Error('Retry the pending action before making another change.');
    const record = retry ? pending : { path, method, body: { ...clone(body), requestId: crypto.randomUUID() }, sending: false };
    if (!record || record.sending) return;
    epoch++; const context = scope(); pending = record; record.sending = true; feedback = ''; render();
    try {
      const result = await api(record.path, record.method, record.body); if (!current(context)) return;
      pending = null; setEditor(null); feedback = result.outcome?.replayed ? 'Earlier transaction recovered. No second transfer was made.' : 'Server confirmed your action.'; feedbackError = false;
      try { const fresh = await readDashboard(); if (!current(context)) return; dashboard = fresh; state.event.status = fresh.event.status; }
      catch { if (current(context)) { if (result.receipt && dashboard) dashboard.receipts = [result.receipt, ...(dashboard.receipts || []).filter(row => row.id !== result.receipt.id)]; feedback = 'Your action was confirmed. Refresh to see current balances and stock.'; } }
    } catch (error) {
      if (!current(context)) return; record.sending = false;
      if (error.status >= 400 && error.status < 500) { pending = null; conflict = error.status === 409 && Boolean(editor?.id || editor?.kind === 'adjust'); if ([401, 403, 404].includes(error.status)) { dashboard = null; setEditor(null); } feedback = error.message; }
      else feedback = 'The connection did not confirm this action. Retry pending action to recover its result.';
      feedbackError = true;
    } finally { if (current(context)) { if (pending === record) record.sending = false; render(); } }
  }
  function purchaseDraft(shop, stock) { return { key: crypto.randomUUID(), kind: 'purchase', id: stock.id, shopId: shop.id, shopName: shop.name, name: stock.name, description: stock.description, resourceId: stock.resourceId, unitPrice: stock.unitPrice, available: stock.quantity, version: stock.version, quantity: '1' }; }
  function startEditor(value) { if (!confirmDiscard()) return; setEditor({ key: crypto.randomUUID(), ...value }); feedback = ''; feedbackError = false; render(); document.querySelector('#bazaar-editor-form input, #bazaar-editor-form select')?.focus(); }
  function confirmDiscard(destination) {
    if (destination === 'modal') return true;
    capture(); if (pending?.sending) { toast('Wait for the current BAZAAR request before leaving.'); return false; }
    if (pending && !window.confirm('This action has no confirmed response. Retry can recover it without a second transfer. Leave and discard this tab’s retry information? A completed transaction will still appear in receipts.')) return false;
    if (dirty && !window.confirm('Discard your unsaved BAZAAR entries?')) return false;
    if (pending) pending = null;
    if (dirty) { editor = savedEditor ? clone(savedEditor) : null; dirty = false; conflict = false; }
    return true;
  }
  async function action(button) {
    const name = button.dataset.action; if (!name?.startsWith('bazaar-')) return false;
    ensureAccount(); capture();
    if (name === 'bazaar-event') { if (confirmDiscard()) { epoch++; setEditor(null); await loadEvent(eventId); } return true; }
    if (name === 'bazaar-open') { await open(state.event); return true; }
    if (name === 'bazaar-manage') { await open(state.event, true); return true; }
    if (name === 'bazaar-refresh') { await refresh(); return true; }
    if (name === 'bazaar-toggle') { await open(state.event, !manage, characterId); return true; }
    if (name === 'bazaar-retry') { await mutate(null, null, null, true); return true; }
    if (name === 'bazaar-review-latest') { await refresh({ review: true }); return true; }
    if (name === 'bazaar-close-editor') { if (confirmDiscard()) { setEditor(null); render(); } return true; }
    if (name === 'bazaar-exchanges') { if (confirmDiscard() && typeof ctx.openExchanges === 'function') { epoch++; await ctx.openExchanges(characterId); } return true; }
    if (!writable()) throw new Error('Reconnect and choose an available character or organizer view before making changes.');
    const shop = dashboard.shops.find(row => row.id === (button.dataset.shopId || button.dataset.id)), stock = shop?.stock.find(row => row.id === button.dataset.id);
    if (name === 'bazaar-new-resource') startEditor({ kind: 'resource', resourceId: '', name: '' });
    if (name === 'bazaar-new-shop') startEditor({ kind: 'shop', name: '', description: '', enabled: false });
    if (name === 'bazaar-edit-shop' && shop) startEditor({ kind: 'shop', id: shop.id, version: shop.version, name: shop.name, description: shop.description, enabled: shop.enabled });
    if (name === 'bazaar-new-stock' && shop) startEditor({ kind: 'stock', shopId: shop.id, name: '', description: '', quantity: '0', resourceId: dashboard.resources[0]?.id || '', unitPrice: '1', reason: '' });
    if (name === 'bazaar-edit-stock' && stock) startEditor({ kind: 'stock', id: stock.id, shopId: shop.id, version: stock.version, name: stock.name, description: stock.description, quantity: String(stock.quantity), resourceId: stock.resourceId, unitPrice: String(stock.unitPrice), reason: '' });
    if (name === 'bazaar-buy' && stock) startEditor(purchaseDraft(shop, stock));
    if (name === 'bazaar-adjust') { const charId = button.dataset.characterId || dashboard.characters.find(row => row.status !== 'retired')?.id, resourceId = button.dataset.resourceId || dashboard.resources[0]?.id, balance = balanceFor(charId, resourceId); startEditor({ kind: 'adjust', characterId: charId, resourceId, quantity: String(balance?.quantity || 0), version: balance?.version || 0, reason: '', agreementId: '' }); }
    return true;
  }
  async function submit(form) {
    if (!form.id.startsWith('bazaar-')) return false;
    if (form.id === 'bazaar-character-form') { const data = new FormData(form); await open(state.event, false, String(data.get('characterId'))); return true; }
    if (form.id !== 'bazaar-editor-form' || !editor) return true;
    capture(); if (!writable() || conflict) throw new Error('Review the current values before confirming.');
    const e = editor;
    const whole = (value, minimum, maximum) => { if (!/^\d+$/.test(String(value))) throw new Error('Enter whole, nonnegative quantities.'); const result = Number(value); if (!Number.isSafeInteger(result) || result < minimum || result > maximum) throw new Error(`Enter a whole quantity from ${minimum} to ${maximum}.`); return result; };
    if (e.kind === 'resource') await mutate(`${base()}/resources`, 'POST', { id: e.resourceId.trim(), name: e.name.trim() });
    if (e.kind === 'shop') await mutate(`${base()}/shops${e.id ? `/${e.id}` : ''}`, e.id ? 'PATCH' : 'POST', { name: e.name.trim(), description: e.description.trim(), enabled: e.enabled, ...(e.id ? { version: e.version } : {}) });
    if (e.kind === 'stock') await mutate(`${base()}/shops/${e.shopId}/stock${e.id ? `/${e.id}` : ''}`, e.id ? 'PATCH' : 'POST', { name: e.name.trim(), description: e.description.trim(), quantity: whole(e.quantity, 0, 9999), resourceId: e.resourceId, unitPrice: whole(e.unitPrice, 1, 1000000000), ...(e.id ? { version: e.version, reason: e.reason.trim() } : {}) });
    if (e.kind === 'adjust') await mutate(`${base()}/adjust`, 'POST', { characterId: e.characterId, resourceId: e.resourceId, quantity: whole(e.quantity, 0, 1000000000), version: e.version, reason: e.reason.trim(), ...(e.agreementId.trim() ? { agreementId: e.agreementId.trim() } : {}) });
    if (e.kind === 'purchase') await mutate(`${base()}/purchase`, 'POST', { characterId, shopId: e.shopId, stockId: e.id, version: e.version, quantity: whole(e.quantity, 1, 9999) });
    return true;
  }
  document.addEventListener('input', event => {
    if (!event.target.closest('#bazaar-editor-form') || state.view !== 'bazaar') return;
    capture(); const indicator = document.querySelector('#bazaar-save-state'); if (indicator) indicator.textContent = conflict ? 'Review required' : dirty ? 'Unsaved changes · held in this tab' : 'Saved revision loaded';
    const total = document.querySelector('#bazaar-purchase-total'); if (total) total.textContent = purchaseTotal();
  });
  document.addEventListener('change', event => {
    if (!event.target.closest('#bazaar-editor-form') || state.view !== 'bazaar') return;
    capture(); if (editor?.kind === 'adjust' && ['characterId', 'resourceId'].includes(event.target.name)) { const balance = balanceFor(editor.characterId, editor.resourceId); editor.version = balance?.version || 0; editor.quantity = String(balance?.quantity || 0); conflict = false; dirty = comparable(editor) !== comparable(savedEditor); render(); }
  });
  window.addEventListener('beforeunload', event => { capture(); if (dirty || pending) { event.preventDefault(); event.returnValue = ''; } });
  return { open, render, action, submit, confirmDiscard, isDirty: () => { capture(); return dirty || Boolean(pending); }, reset, cleanupModal: () => {} };
}
