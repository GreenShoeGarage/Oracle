import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { testDatabase } from './database.js';
import { migrate } from '../src/db.js';
import { createAppV19 } from '../src/app-v19.js';
import { readConfig } from '../src/config.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
import { defaultStoryDocument } from '../public/story-model.js';
import { defaultAdventure, defaultAdventureNode } from '../public/adventure-model.js';
import { defaultStagehandDocument } from '../public/stagehand-model.js';

let database,pool,server,origin;
const users={};
const queries=[];
let observe=false, afterSnapshot=null, releasedCheck=Promise.resolve();
async function request(path,method='GET',body,who=users.owner,headers={}) {
  const response=await fetch(origin+path,{method,signal:AbortSignal.timeout(12000),headers:{...(who?.cookie?{Cookie:who.cookie}:{}),...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});
  return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0],headers:response.headers};
}
const ok=(r,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.data));return r.data;};
async function event(theme='fantasy') {
  const setup=defaultSetup(theme,'council');setup.enabledInstruments=['briefing','relic','wayfinder','stagehand','broadside'];
  const ev=ok(await request('/api/events','POST',{name:`Command Deck ${theme}`,setup}),201).event;
  for(const [name,role] of [['organizer','organizer'],['staff','staff'],['player','player']]) await pool.query('INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,$3)',[ev.id,users[name].id,role]);
  return ev;
}
let badgeSequence=0;
async function character(ev,{status='approved',userId=users.player.id,name='Ari',privateText='PRIVATE_CHARACTER_OBJECTIVE'}={}) {
  const id=randomUUID(),profile={...defaultCharacterProfile(ev.setup.rules),name,privateObjectives:privateText};
  // Only test fixtures use direct SQL; deck actions use existing HTTP workflows.
  await pool.query('INSERT INTO characters(id,event_id,user_id,status,profile,badge_code,inventory_initialized) VALUES($1,$2,$3,$4,$5,$6,true)',[id,ev.id,userId,status,JSON.stringify(profile),`ZZZZZZZZZZZZZZZZZZ${'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(++badgeSequence/32)]}${'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[badgeSequence%32]}`]);
  return id;
}
async function project(ev) {
  return ok(await request(`/api/events/${ev.id}/projects/create`,'POST',{title:'Repair the relay',purpose:'A shared job.',contributionRoutes:[{key:'quiet',label:'Quiet support',help:'Written notes and logistics.'}],milestones:[{title:'Prepare the plan',requiredCount:2,countingRule:'distinct_accounts'}],outcomeText:'The relay is ready.',organizerNotes:'PRIVATE_PROJECT_NOTES'}),201);
}
const deck=(ev,who)=>request(`/api/events/${ev.id}/command-deck`,'GET',undefined,who);

before(async()=>{
  database=await testDatabase();pool=database.pool;await migrate(pool);
  const observed={
    async query(sql,values){await releasedCheck;if(observe)queries.push(sql);return pool.query(sql,values);},
    async connect(){const c=await pool.connect();return {async query(sql,values){if(observe)queries.push(sql);return c.query(sql,values);},release(){c.release();if(afterSnapshot){const fn=afterSnapshot;afterSnapshot=null;releasedCheck=Promise.resolve(fn());}}};},
  };
  let handler;server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  handler=createAppV19({pool:observed,config:{...readConfig({DATABASE_URL:'postgres://unused',PORT:'3000'}),origin},logger:()=>{}});
  for(const name of ['owner','organizer','staff','player','outsider','superuser']) {
    const r=await request('/api/auth/register','POST',{email:`${name}@command-deck.test`,displayName:`Deck ${name}`,password:'Command deck testing passphrase!'},null);
    users[name]={...ok(r,201).user,cookie:r.cookie};
  }
  await pool.query('UPDATE users SET is_superuser=true WHERE id=$1',[users.superuser.id]);
});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await database.close();});

test('Command Deck authorizes current organizer roles and rejects staff, players, outsiders and forged accounts',async()=>{
  const ev=await event();
  for(const name of ['owner','organizer','superuser']) {const r=await deck(ev,users[name]);ok(r);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.equal(r.headers.get('x-oracle-shell-version'),null);}
  for(const [who,status] of [[null,401],[users.player,403],[users.staff,403],[users.outsider,404]]) assert.equal((await deck(ev,who)).status,status);
  assert.equal((await request(`/api/events/${ev.id}/command-deck?audience=organizer`)).status,400);
  assert.equal((await request(`/api/events/${ev.id}/command-deck`,'GET',undefined,users.owner,{'X-ORACLE-Expected-Account':users.player.id})).status,409);
  assert.equal((await request(`/api/events/${ev.id}/command-deck`,'POST',{})).status,405);
  assert.equal((await request('/api/events/not-a-uuid/command-deck')).status,404);
});

test('all three themes retain truthful counts and isolate another event',async()=>{
  for(const theme of ['fantasy','cyberpunk','wasteland']) {
    const ev=await event(theme);await character(ev,{status:'pending'});await character(ev,{userId:null,name:'Unassigned character'});
    const other=await event(theme);await character(other,{status:'pending',name:'OTHER_EVENT_PRIVATE_NAME'});
    const d=ok(await deck(ev));assert.equal(d.event.themeId,theme);assert.equal(d.counts.members,4);assert.equal(d.counts.players,1);assert.equal(d.counts.approvals,1);assert.equal(d.counts.unassigned,1);
    assert.ok(!JSON.stringify(d).includes('OTHER_EVENT_PRIVATE_NAME'));assert.ok(!JSON.stringify(d).includes('PRIVATE_CHARACTER_OBJECTIVE'));
    assert.equal(d.attention.total,2);assert.equal(d.playActive,false);
  }
});

test('original character approval removes its queue item on the next deck read',async()=>{
  const ev=await event(),id=await character(ev,{status:'pending'});
  assert.equal(ok(await deck(ev)).counts.approvals,1);
  ok(await request(`/api/events/${ev.id}/characters/${id}/review`,'POST',{version:1,decision:'approve',feedback:''}));
  assert.equal(ok(await deck(ev)).counts.approvals,0);
});

test('only accepted distinct accounts advance project progress and GET never completes a project',async()=>{
  const ev=await event(),ch=await character(ev),p=await project(ev),projectId=p.project.id,mid=p.milestones[0].id;
  ok(await request(`/api/events/${ev.id}/projects/${projectId}/status`,'PATCH',{version:p.project.version,status:'open'}));
  const ids=[];
  for(let i=0;i<2;i++) ids.push(ok(await request(`/api/events/${ev.id}/projects/${projectId}/contributions`,'POST',{requestId:randomUUID(),characterId:ch,milestoneId:mid,routeKey:'quiet',summary:`PRIVATE_CONTRIBUTION_BODY_${i}`},users.player),201).contribution.id);
  let d=ok(await deck(ev));assert.equal(d.counts.contributions,2);assert.equal(d.projects.items[0].milestones[0].accepted,0);
  ok(await request(`/api/events/${ev.id}/projects/${projectId}/review`,'PATCH',{contributionId:ids[0],version:1,decision:'accepted',reviewNote:'Good plan.'}));
  ok(await request(`/api/events/${ev.id}/projects/${projectId}/review`,'PATCH',{contributionId:ids[1],version:1,decision:'accepted',reviewNote:'Additional note.'}));
  d=ok(await deck(ev));assert.equal(d.counts.contributions,0);assert.equal(d.projects.items[0].milestones[0].accepted,1);
  assert.ok(!JSON.stringify(d).includes('PRIVATE_PROJECT_NOTES'));assert.ok(!JSON.stringify(d).includes('PRIVATE_CONTRIBUTION_BODY'));
  await pool.query('UPDATE community_project_milestones SET required_count=1 WHERE id=$1',[mid]);
  d=ok(await deck(ev));assert.equal(d.projects.items[0].milestones[0].complete,true);assert.equal(d.projects.items[0].status,'open');
  assert.equal((await pool.query('SELECT count(*)::int n FROM community_project_receipts WHERE project_id=$1',[projectId])).rows[0].n,0,'reading is never the completion trigger');
  await pool.query("INSERT INTO community_project_receipts(id,event_id,project_id,kind,milestone_id) VALUES($1,$2,$3,'milestone_complete',$4)",[randomUUID(),ev.id,projectId,mid]);
  await pool.query("UPDATE community_project_contributions SET status='declined' WHERE project_id=$1",[projectId]);
  d=ok(await deck(ev));assert.equal(d.projects.items[0].milestones[0].historicalCompletion,true);assert.equal(d.projects.items[0].milestones[0].accepted,0);
});

test('resource milestones count accepted units rather than people or pending donations',async()=>{
  const ev=await event(),ch=await character(ev),p=await project(ev),mid=p.milestones[0].id;
  await pool.query("UPDATE community_project_milestones SET contribution_mode='resource',required_count=10 WHERE id=$1",[mid]);
  for(const [status,units] of [['accepted',4],['submitted',6]]) await pool.query(`INSERT INTO community_project_contributions(id,request_id,event_id,project_id,milestone_id,character_id,user_id,route_key,summary,status,kind,units) VALUES($1,$2,$3,$4,$5,$6,$7,'quiet','Test donation',$8,'resource',$9)`,[randomUUID(),randomUUID(),ev.id,p.project.id,mid,ch,users.player.id,status,units]);
  const d=ok(await deck(ev));assert.equal(d.projects.items[0].milestones[0].accepted,4);assert.equal(d.projects.items[0].milestones[0].complete,false);
});

test('BROADSIDE queue uses draft/submitted state, excludes rumor truth, and resolves after original publication',async()=>{
  const ev=await event();await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1",[ev.id]);const doc={...defaultStoryDocument(),title:'The relay is ready',body:'PRIVATE_BULLETIN_BODY',truth:'PRIVATE_HIDDEN_TRUTH'};
  const entry=ok(await request(`/api/events/${ev.id}/story/entries`,'POST',{requestId:randomUUID(),kind:'bulletin',document:doc}),201).entry;
  ok(await request(`/api/events/${ev.id}/story/entries`,'POST',{requestId:randomUUID(),kind:'rumor',document:{...doc,title:'SECRET_RUMOR_TITLE'}}),201);
  let d=ok(await deck(ev));assert.equal(d.counts.bulletins,1);for(const marker of ['PRIVATE_BULLETIN_BODY','PRIVATE_HIDDEN_TRUTH','SECRET_RUMOR_TITLE']) assert.ok(!JSON.stringify(d).includes(marker));
  ok(await request(`/api/events/${ev.id}/story/entries/${entry.id}/publish`,'POST',{requestId:randomUUID(),version:entry.version}));
  d=ok(await deck(ev));assert.equal(d.counts.bulletins,0);
});

test('connection attention reports broken assignment eligibility, never acceptance or dismissal',async()=>{
  const ev=await event(),ch=await character(ev),peer=await character(ev,{userId:users.owner.id,name:'Guide'}),assignment=randomUUID();
  await pool.query(`INSERT INTO connection_assignments(id,event_id,character_id,assigned_user_id,counterpart_character_id,counterpart_user_id,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,[assignment,ev.id,ch,users.player.id,peer,users.owner.id,JSON.stringify({title:'Old friends',sharedFact:'PRIVATE_SHARED_FACT'})]);
  for(const status of ['offered','kept','paused','dismissed']) {await pool.query('UPDATE connection_assignments SET response_status=$1 WHERE id=$2',[status,assignment]);assert.equal(ok(await deck(ev)).counts.connections,0);}
  await pool.query('UPDATE characters SET user_id=$1 WHERE id=$2',[users.organizer.id,peer]);
  for(const status of ['offered','kept','paused','dismissed']) {await pool.query('UPDATE connection_assignments SET response_status=$1 WHERE id=$2',[status,assignment]);const d=ok(await deck(ev));assert.equal(d.counts.connections,1);assert.ok(!JSON.stringify(d).includes('PRIVATE_SHARED_FACT'));assert.ok(!JSON.stringify(d).includes('response_status'));}
});

test('scene readiness follows the existing engine and upcoming times are authored rather than invented',async()=>{
  const ev=await event();await pool.query("UPDATE events SET status='live' WHERE id=$1",[ev.id]);
  const definition=defaultAdventure();const node=defaultAdventureNode('wayfinder');node.title='Bridge watch';node.availability='open';node.maxPlayers=6;definition.nodes=[node];
  const later=defaultAdventureNode('wayfinder');later.title='Night shift';later.startsAt=new Date(Date.now()+86400000).toISOString();definition.nodes.push(later);
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)',[ev.id,JSON.stringify(definition)]);
  const encounter=randomUUID(),document={...defaultStagehandDocument(),title:'Watch desk',nodeId:node.id,staffNotes:'PRIVATE_STAFF_NOTES',checks:[{id:'ready',label:'Venue ready'}]};
  await pool.query("INSERT INTO stagehand_encounters(id,event_id,document,state,created_by) VALUES($1,$2,$3,'open',$4)",[encounter,ev.id,JSON.stringify(document),users.owner.id]);
  let d=ok(await deck(ev));assert.equal(d.counts.openScenes,0);assert.equal(d.scenes.items[0].ready,false);assert.equal(d.scenes.upcoming[0].title,'Night shift');assert.ok(!JSON.stringify(d).includes('PRIVATE_STAFF_NOTES'));
  await pool.query('UPDATE stagehand_encounters SET checks=$1 WHERE id=$2',[JSON.stringify({ready:{ready:true,actorId:users.owner.id,at:new Date().toISOString()}}),encounter]);
  d=ok(await deck(ev));assert.equal(d.counts.openScenes,1);assert.equal(d.scenes.items[0].ready,true);
  await pool.query("UPDATE events SET status='paused' WHERE id=$1",[ev.id]);d=ok(await deck(ev));assert.equal(d.playActive,false);assert.equal(d.counts.openScenes,0);
});

test('deck reports are bounded and never read private arc tables or perform writes',async()=>{
  const ev=await event();for(let i=0;i<28;i++) await character(ev,{status:'pending',name:`Pending ${i}`});
  queries.length=0;observe=true;const d=ok(await deck(ev));observe=false;
  const approvals=d.attention.sections.find(s=>s.key==='approvals');assert.equal(approvals.total,28);assert.equal(approvals.items.length,25);assert.equal(approvals.truncated,true);
  assert.ok(queries.some(q=>q==='BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'));
  assert.ok(queries.every(q=>!/^\s*(INSERT|UPDATE|DELETE|ALTER|DROP)\b/i.test(q)));
  assert.ok(queries.every(q=>!/(character_arcs|character_arc_progress|connection_confirmations|response_status)/i.test(q)));
});

test('demotion, disabled accounts and revoked sessions stop further privileged reads',async()=>{
  const ev=await event();ok(await deck(ev,users.organizer));
  await pool.query("UPDATE memberships SET role='player' WHERE event_id=$1 AND user_id=$2",[ev.id,users.organizer.id]);assert.equal((await deck(ev,users.organizer)).status,403);
  await pool.query('UPDATE users SET is_disabled=true WHERE id=$1',[users.superuser.id]);assert.equal((await deck(ev,users.superuser)).status,401);await pool.query('UPDATE users SET is_disabled=false WHERE id=$1',[users.superuser.id]);
  await pool.query('DELETE FROM sessions WHERE user_id=$1',[users.outsider.id]);assert.equal((await deck(ev,users.outsider)).status,401);
});

test('archived reports are historical and expose no mutating operations',async()=>{
  const ev=await event();await pool.query("UPDATE events SET status='archived' WHERE id=$1",[ev.id]);const d=ok(await deck(ev));assert.equal(d.readOnly,true);assert.equal(d.playActive,false);assert.equal((await request(`/api/events/${ev.id}/command-deck`,'POST',{})).status,405);
});


test('a demotion while the read snapshot completes prevents returning privileged data',async()=>{
  const ev=await event();await character(ev,{status:'pending',name:'Hidden after demotion'});
  afterSnapshot=()=>pool.query("UPDATE memberships SET role='player' WHERE event_id=$1 AND user_id=$2",[ev.id,users.organizer.id]);
  const r=await deck(ev,users.organizer);assert.equal(r.status,403);assert.ok(!JSON.stringify(r.data).includes('Hidden after demotion'));
});

test('overdue parties are surfaced without releasing seats or mutating their state',async()=>{
  const ev=await event(),ch=await character(ev);await pool.query("UPDATE events SET status='live' WHERE id=$1",[ev.id]);
  const definition=defaultAdventure(),node=defaultAdventureNode('wayfinder');node.title='Return watch';node.availability='open';node.maxPlayers=6;definition.nodes=[node];
  await pool.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2)',[ev.id,JSON.stringify(definition)]);
  const eid=randomUUID(),pid=randomUUID();
  await pool.query("INSERT INTO stagehand_encounters(id,event_id,document,state,created_by) VALUES($1,$2,$3,'open',$4)",[eid,ev.id,JSON.stringify({...defaultStagehandDocument(),title:'Return desk',nodeId:node.id}),users.owner.id]);
  await pool.query("INSERT INTO stagehand_parties(id,event_id,encounter_id,name,status,return_minutes,members,dispatched_at,return_by,dispatched_node_id,created_by) VALUES($1,$2,$3,'Overdue crew','dispatched',30,$4,now()-interval '60 minutes',now()-interval '30 minutes',$5,$6)",[pid,ev.id,eid,JSON.stringify([{characterId:ch,ownerUserId:users.player.id,name:'Ari',response:'accepted',responseTermsVersion:1}]),node.id,users.owner.id]);
  const before=(await pool.query('SELECT * FROM stagehand_parties WHERE id=$1',[pid])).rows[0];
  const d=ok(await deck(ev));assert.equal(d.counts.dispatchedParties,1);assert.match(d.attention.sections[0].items.find(i=>i.id===pid).detail,/overdue/);
  assert.deepEqual((await pool.query('SELECT * FROM stagehand_parties WHERE id=$1',[pid])).rows[0],before);
});
