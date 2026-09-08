import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { createCommandDeckUI } from '../public/command-deck-ui.js';

const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const E='51000000-0000-4000-8000-000000000002', U='51000000-0000-4000-8000-000000000001';
export function exampleDeck() { return {
  event:{id:E,name:'The Lantern Gathering',status:'live',role:'owner'},checkedAt:'2026-09-08T12:00:00Z',readOnly:false,playActive:true,
  counts:{members:7,players:5,approvals:1,unassigned:1,contributions:1,openProjects:1,openScenes:1,waitingParties:1,dispatchedParties:1},
  attention:{total:3,sections:[{key:'approvals',title:'Character approvals',destination:'characters',total:1,items:[{id:'c1',title:'Mara <script>alert(1)</script>',detail:'Awaiting approval.',destination:'character'}]},{key:'contributions',title:'Project contributions',destination:'projects',total:1,items:[{id:'sub1',projectId:'p1',title:'Restore the Border Lantern',detail:'Submitted, not accepted.',destination:'project'}]},{key:'bulletins',title:'BROADSIDE drafts and submissions',destination:'bulletins',total:1,items:[{id:'b1',title:'Lantern watch assembled',detail:'Draft needs review.',destination:'bulletin'}]}]},
  projects:{total:1,truncated:false,items:[{id:'p1',title:'Restore the Border Lantern',status:'open',milestones:[{id:'m1',title:'Agree on a watch',mode:'reviewed',accepted:1,required:2,complete:false}]}]},
  scenes:{enabled:true,total:1,truncated:false,items:[{id:'s1',title:'At the old tower',location:'Tower steps',availability:'open',occupied:2,capacity:6,ready:true}],upcoming:[]},
  beats:[{key:'lantern',title:'The Lantern Gathering',suggestion:'Leave space for conversation.',unfinishedEnding:'The group agrees to return at first light.'}],
}; }
function harness(t,{api,role='owner'}={}) {
  const dom=new JSDOM('<!doctype html><html><body><main id="screen"></main></body></html>',{url:'https://oracle.test/',pretendToBeVisual:true});
  const old={};for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator})) {old[key]=Object.getOwnPropertyDescriptor(globalThis,key);Object.defineProperty(globalThis,key,{configurable:true,value});}
  t.after(()=>{dom.window.close();for(const [key,descriptor] of Object.entries(old)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}});
  const state={view:'detail',event:{id:E,name:'The Lantern Gathering',role},session:{user:{id:U}}},calls=[],destinations=[];
  const ui=createCommandDeckUI({state,esc,shell:html=>{dom.window.document.querySelector('#screen').innerHTML=html;},api:async(...args)=>{calls.push(args);return api?api(...args):exampleDeck();},openTool:async(...args)=>destinations.push(args)});
  return {dom,state,ui,calls,destinations,document:dom.window.document};
}

test('integrated deck renders safe current queues and all requests are read-only',async t=>{
  const h=harness(t);await h.ui.open();assert.equal(h.state.view,'command-deck');assert.match(h.document.body.textContent,/Needs attention/);assert.match(h.document.body.textContent,/Joined players/);assert.match(h.document.body.textContent,/3 work items/);assert.equal(h.document.querySelector('script'),null);assert.match(h.document.body.textContent,/<script>alert\(1\)<\/script>/);assert.deepEqual(h.calls,[[`/api/events/${E}/command-deck`]]);
});

test('review navigation opens the existing exact character and project workflows without a mutation',async t=>{
  const h=harness(t);await h.ui.open();await h.ui.action(h.document.querySelector('[data-destination="character"]'));assert.deepEqual(h.destinations[0],['character',{id:'c1',projectId:undefined,eventId:E}]);
  await h.ui.open();await h.ui.action(h.document.querySelector('[data-destination="project"][data-id="sub1"]'));assert.deepEqual(h.destinations[1],['project',{id:'sub1',projectId:'p1',eventId:E}]);assert.ok(h.calls.every(c=>c.length===1));
});

test('filters and open overview panels survive a refresh with keyboard focus retained',async t=>{
  const h=harness(t);await h.ui.open();const select=h.document.querySelector('#deck-category');select.focus();select.value='contributions';h.ui.change(select);assert.equal(h.document.querySelectorAll('.deck-queue').length,1);assert.equal(h.document.activeElement.id,'deck-category');h.document.querySelector('[data-deck-section="projects"]').open=true;
  await h.ui.refresh();assert.equal(h.document.querySelector('#deck-category').value,'contributions');assert.equal(h.document.querySelector('[data-deck-section="projects"]').open,true);assert.equal(h.document.activeElement.id,'deck-category');
});

test('offline transition clears private queues immediately and refuses cached decisions',async t=>{
  const h=harness(t);await h.ui.open();Object.defineProperty(h.dom.window.navigator,'onLine',{value:false,configurable:true});h.ui.disconnect();assert.ok(!h.document.body.textContent.includes('Mara'));assert.match(h.document.body.textContent,/offline/);assert.equal(h.document.querySelectorAll('[data-destination]').length,0);await h.ui.refresh();assert.equal(h.calls.length,1);assert.equal(h.dom.window.localStorage.length,0);
});

test('late response cannot restore a deck after account change or explicit reset',async t=>{
  let resolve;const h=harness(t,{api:()=>new Promise(r=>{resolve=r;})});const opening=h.ui.open();h.state.session.user.id='another-account';h.ui.reset();resolve(exampleDeck());await opening;h.ui.render();assert.ok(!h.document.body.textContent.includes('Mara'));
});

test('late response cannot replace another event or workspace',async t=>{
  let resolve;const h=harness(t,{api:()=>new Promise(r=>{resolve=r;})});const opening=h.ui.open();h.state.event.id='another-event';h.state.view='characters';h.document.querySelector('#screen').textContent='Different event';resolve(exampleDeck());await opening;assert.equal(h.document.body.textContent,'Different event');
});

test('role or session errors clear previously checked counts instead of showing a false zero',async t=>{
  let fail=false;const h=harness(t,{api:async()=>{if(fail){const e=new Error('revoked');e.status=403;throw e;}return exampleDeck();}});await h.ui.open();fail=true;await h.ui.refresh();assert.ok(!h.document.body.textContent.includes('Mara'));assert.equal(h.document.querySelector('.deck-metrics'),null);assert.match(h.document.body.textContent,/access or the signed-in account changed/);
});

test('ordinary staff cannot open the organizer-wide deck even through the UI',async t=>{
  const h=harness(t,{role:'staff'});await h.ui.open();assert.equal(h.calls.length,0);assert.match(h.document.body.textContent,/Organizer access is required/);
});

test('mobile and accessible presentation retains solid theme tokens and native progress elements',async t=>{
  const h=harness(t);await h.ui.open();assert.equal(h.document.querySelector('progress').max,2);assert.equal(h.document.querySelector('progress').value,1);
  const css=await readFile('public/command-deck.css','utf8');for(const marker of ['min-height:48px','@media(max-width:720px)','@media(forced-colors:active)','@media(prefers-reduced-motion:reduce)','env(safe-area-inset-bottom)','var(--panel)'])assert.ok(css.includes(marker));
});
