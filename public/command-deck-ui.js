// Integrated organizer workspace. All mutations remain in their source tools.
// No organizer snapshots, credentials, or task records are persisted here.
export function createCommandDeckUI({state,api,shell,esc,openTool}) {
  let data = null, generation = 0, loading = false, failure = '', category = 'all';
  const current = () => state.view === 'command-deck';
  const manager = () => ['owner','organizer','superuser'].includes(state.event?.role) || state.session?.user?.isSuperuser;
  const date = value => value ? new Date(value).toLocaleString() : 'Not checked';
  const label = value => String(value || '').replaceAll('_',' ').replace(/^./,c => c.toUpperCase());
  const button = (destination,text,id = '',extra = '') => `<button type="button" data-action="command-deck-go" data-destination="${esc(destination)}" data-id="${esc(id)}" ${extra}>${esc(text)}</button>`;
  function navigation() {
    return `<div class="actions"><button type="button" class="quiet" data-action="command-deck-event">← Event briefing</button><button type="button" data-action="command-deck-refresh" ${loading?'aria-busy="true"':''}>Refresh deck</button></div>`;
  }
  function attention() {
    const sections = data.attention.sections.filter(s => category === 'all' || s.key === category);
    return `<section class="panel deck-attention" aria-labelledby="deck-attention-title"><div class="panel-head"><div><h2 id="deck-attention-title">${data.readOnly?'Outstanding records':'Needs attention'}</h2><p class="hint">${data.attention.total} work ${data.attention.total===1?'item':'items'}, not a count or rating of players.</p></div><label for="deck-category">Show<select id="deck-category">${[{key:'all',title:'All tracked work'},...data.attention.sections].map(s => `<option value="${esc(s.key)}" ${category===s.key?'selected':''}>${esc(s.title)}${s.total!==undefined?` (${s.total})`:''}</option>`).join('')}</select></label></div>${sections.some(s => s.total) ? sections.filter(s => s.total).map(s => `<section class="deck-queue" aria-labelledby="deck-${esc(s.key)}"><div class="panel-head"><h3 id="deck-${esc(s.key)}">${esc(s.title)} <span class="badge">${s.total}</span></h3>${button(s.destination,'Open workspace')}</div><ul class="deck-items">${s.items.map(item => `<li><div><strong>${esc(item.title)}</strong><p>${esc(item.detail)}</p>${item.at?`<time class="hint" datetime="${esc(item.at)}">${esc(date(item.at))}</time>`:''}</div>${button(item.destination,data.readOnly?'View record':'Review',item.id,item.projectId?`data-project="${esc(item.projectId)}"`:'')}</li>`).join('')}</ul>${s.truncated?'<p class="hint">Showing the first 25 items. Open the workspace to review the rest.</p>':''}</section>`).join('') : '<div class="deck-empty"><h3>No queued items in this view.</h3><p>This reports tracked work only. It does not certify that the event or venue is ready.</p></div>'}</section>`;
  }
  function projectOverview() {
    return `<details class="panel deck-detail" data-deck-section="projects"><summary>Community projects · ${data.projects.total}</summary><p class="hint">Only accepted work counts. Historical completion receipts stay recorded after corrections.</p>${data.projects.items.length?data.projects.items.map(p => `<article class="deck-project"><div class="panel-head"><h3>${esc(p.title)}</h3><span class="badge">${esc(label(p.status))}</span></div>${p.milestones.map(m => `<div class="deck-milestone"><label for="deck-progress-${esc(m.id)}">${esc(m.title)} · ${m.accepted}/${m.required} ${m.mode==='resource'?'resource units':'accepted contributions'}${m.complete?' · complete':''}</label><progress id="deck-progress-${esc(m.id)}" max="${m.required}" value="${Math.min(m.required,m.accepted)}">${m.accepted}/${m.required}</progress>${m.historicalCompletion?'<p class="hint">Completed previously; later corrections changed the accepted count. The project has not been reopened.</p>':''}</div>`).join('')}${button('project','Open project',p.id,`data-project="${esc(p.id)}"`)}</article>`).join(''):'<p>No community projects have been authored for this event.</p>'}${data.projects.truncated?'<p class="hint">Showing the first 50 projects. Open the project workspace for the full list.</p>':''}${button('projects','All community projects')}</details>`;
  }
  function scenes() {
    return `<details class="panel deck-detail" data-deck-section="scenes"><summary>Scenes and capacity · ${data.scenes.total}</summary><p class="hint">${data.counts.waitingParties} waiting ${data.counts.waitingParties===1?'party':'parties'} · ${data.counts.dispatchedParties} dispatched. These are recorded reservations, not location tracking.</p>${!data.scenes.enabled?'<p class="preview-banner">STAGEHAND is disabled. Review retained records in the source workspace; admission is unavailable.</p>':''}<div class="deck-scenes">${data.scenes.items.map(s => `<article><div class="panel-head"><h3>${esc(s.title)}</h3><span class="badge">${esc(label(s.availability))}</span></div><p>${esc(s.location || 'Location not supplied')} · ${s.occupied}/${s.capacity} occupied or reserved</p><p>${s.ready?'Readiness checks acknowledged.':'Readiness checks need attention.'}</p>${s.reason?`<p class="hint">${esc(s.reason)}</p>`:''}${button('scenes','Open scene operations',s.id)}</article>`).join('') || '<p>No managed encounters have been authored.</p>'}</div>${data.scenes.truncated?'<p class="hint">Showing the first 25 encounters. Open scene operations for the full list.</p>':''}${button('scenes','All scene operations')}</details>`;
  }
  function beats() {
    return `<details class="panel deck-detail" data-deck-section="beats"><summary>Upcoming scenes and suggested story beats</summary><h3>Authored scene schedule</h3><p class="hint">Times below come from authored WAYFINDER scenes, not predictions of what players will do.</p>${data.scenes.upcoming.length?`<ul class="deck-items">${data.scenes.upcoming.map(s => `<li><div><strong>${esc(s.title)}</strong><p><time datetime="${esc(s.startsAt)}">${esc(date(s.startsAt))}</time> · ${esc(label(s.availability))}</p><p class="hint">${esc(s.location || 'Location not supplied')}</p></div>${button('adventure','Review scene')}</li>`).join('')}</ul>`:'<p>No future scene start times have been authored.</p>'}<h3>Starter run-sheet guidance</h3><p class="hint">Optional organizer guidance, not an automated plot or a player-performance assessment.</p>${data.beats.length?data.beats.map(b => `<article class="deck-project"><h4>${esc(b.title)}</h4><p>${esc(b.suggestion)}</p>${b.unfinishedEnding?`<details><summary>Alternate unfinished ending</summary><p>${esc(b.unfinishedEnding)}</p></details>`:''}</article>`).join(''):'<p>No complete starter experience is installed. You can still run a custom event.</p>'}${button('experience','Open starter run sheet')}</details>`;
  }
  function capture() {
    const root = document.querySelector('[data-command-deck]');
    const focused = document.activeElement;
    return { open:[...(root?.querySelectorAll('details[open][data-deck-section]')||[])].map(e=>e.dataset.deckSection),
      focus:root?.contains(focused)?{id:focused.id,action:focused.dataset.action,destination:focused.dataset.destination,record:focused.dataset.id}:null };
  }
  function render() {
    if (!current()) return;
    const previous = capture();
    const header = `<header class="page-head deck-heading"><div><p class="eyebrow">ORACLE · Organizer Command Deck</p><h1>${esc(state.event?.name || 'Organizer workspace')}</h1><p>One place to find work that needs your attention.</p></div>${navigation()}</header>`;
    let content;
    if (!data) content = `<section class="panel deck-empty" role="status"><h2>${loading?'Checking current event state…':'Live deck unavailable'}</h2><p>${esc(failure || 'Refresh while connected to see current organizer work.')}</p><p class="hint">Private organizer queues are not saved offline. Prepared player material remains separate.</p></section>`;
    else {
      const c = data.counts;
      content = `<div class="deck-status" role="status"><span class="badge">${esc(label(data.event.status))}</span><p id="deck-freshness">${loading?'Refreshing… Previous check: ':'Checked: '}<time datetime="${esc(data.checkedAt)}">${esc(date(data.checkedAt))}</time></p></div>${!data.playActive?`<p class="preview-banner">${data.readOnly?'Archived event: this is a read-only review.':data.event.status==='paused'?'Play is paused. Review work here; resume only through the event controls.':data.event.status==='ended'?'Play has ended. Review outstanding records; do not start new play.':'Draft event: prepare and rehearse before going live.'} Source tools enforce the current event state.</p>`:''}<section class="deck-metrics" aria-label="Event summary">${[
        ['Joined players',c.players,'Enabled player memberships, not attendance'],['Awaiting approval',c.approvals,'Character reviews'],['Unassigned',c.unassigned,'Characters without a player'],['Pending contributions',c.contributions,'Not counted as accepted work'],['Open projects',c.openProjects,'Shared goals open for contributions'],['Available scenes',c.openScenes,'Checked by STAGEHAND'],
      ].map(([title,value,note])=>`<article><h2>${esc(title)}</h2><strong>${value}</strong><p class="hint">${esc(note)}</p></article>`).join('')}</section>${attention()}<div class="deck-overviews">${projectOverview()}${scenes()}${beats()}</div>`;
    }
    shell(`<section class="command-deck" data-command-deck>${header}${content}<p class="footer-note">No private arcs, reflections, connection-choice statistics, player rankings, or automatic decisions. ${data?`${data.counts.members} enabled event members in total.`:''}</p></section>`);
    const root = document.querySelector('[data-command-deck]');
    for (const detail of root.querySelectorAll('details[data-deck-section]')) detail.open = previous.open.includes(detail.dataset.deckSection);
    if (previous.focus) {
      const f = previous.focus;
      const target = [...root.querySelectorAll('button,select')].find(e => f.id ? e.id === f.id : e.dataset.action===f.action && e.dataset.destination===f.destination && e.dataset.id===f.record);
      target?.focus({preventScroll:true});
    }
  }
  async function refresh() {
    if (!current() || loading) return;
    const eventId = state.event?.id, accountId = state.session?.user?.id;
    if (!eventId || !accountId || !manager()) { reset(); failure='Organizer access is required.'; render(); return; }
    if (globalThis.navigator?.onLine === false) { disconnect(); return; }
    const token = ++generation;
    const stillCurrent = () => token === generation && current() && state.event?.id===eventId && state.session?.user?.id===accountId;
    loading=true; failure=''; render();
    try {
      const snapshot = await api(`/api/events/${eventId}/command-deck`);
      if (!stillCurrent()) return;
      if (snapshot.event?.id !== eventId || !snapshot.attention || !Array.isArray(snapshot.attention.sections)) throw new Error('The deck response could not be verified. Refresh to try again.');
      data=snapshot;
    } catch(error) {
      if (!stillCurrent()) return;
      data=null;
      failure=[401,403,404,409].includes(error.status) ? 'Organizer access or the signed-in account changed. Return to your events and sign in again if needed.' : 'Unable to refresh live organizer information. Check your connection and try again. No decisions were submitted.';
    } finally { if (stillCurrent()) { loading=false; render(); } }
  }
  async function open() {
    reset(); state.view='command-deck';
    await refresh();
  }
  function reset() { generation++;data=null;loading=false;failure='';category='all'; }
  function disconnect() { generation++;data=null;loading=false;failure='You are offline. Reconnect and refresh before reviewing organizer work.';render(); }
  async function action(buttonElement) {
    const name = buttonElement?.dataset?.action;
    if (!name?.startsWith('command-deck-')) return false;
    if (name==='command-deck-open') await open();
    else if (name==='command-deck-refresh') await refresh();
    else if (name==='command-deck-event') { reset(); await openTool('event'); }
    else if (name==='command-deck-go') {
      if (!data || loading || !manager() || navigator.onLine===false) return true;
      const {destination,id,project} = buttonElement.dataset;
      if (!['character','characters','bulletin','bulletins','project','projects','connections','scenes','adventure','experience'].includes(destination)) return true;
      const eventId=data.event.id;
      reset(); render();
      await openTool(destination,{id,projectId:project,eventId});
    }
    return true;
  }
  function change(target) { if (!current() || target?.id!=='deck-category' || !data) return false; if (target.value==='all' || data.attention.sections.some(s=>s.key===target.value)) {category=target.value;render();}return true; }
  return {open,refresh,render,reset,disconnect,action,change};
}
