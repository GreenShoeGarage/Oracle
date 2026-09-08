import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {testDatabase} from './database.js';
import {migrate} from '../src/db.js';
import {createAppV17} from '../src/app-v17.js';
import {readConfig} from '../src/config.js';
import {defaultSetup} from '../public/kit.js';
import {STARTER_EXPERIENCES} from '../src/experience-starters.js';
import {ARC_STARTERS} from '../src/arc-starters.js';
import {PROJECT_STARTERS} from '../src/project-starters.js';

let database,pool,server,origin;const users={};
async function request(path,method='GET',data,who=users.owner){const r=await fetch(`${origin}${path}`,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(who?.cookie?{Cookie:who.cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});const raw=await r.text();return{status:r.status,data:raw?JSON.parse(raw):null,cookie:r.headers.get('set-cookie')?.split(';')[0]};}
function ok(r,status=200){assert.equal(r.status,status,JSON.stringify(r.data));return r.data;}
before(async()=>{database=await testDatabase();pool=database.pool;await migrate(pool);let handler;server=createServer((req,res)=>handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));origin=`http://127.0.0.1:${server.address().port}`;handler=createAppV17({pool,config:{...readConfig({DATABASE_URL:'postgres://unused',PORT:'3000'}),origin},logger:()=>{}});for(const name of ['owner','player']){const r=await request('/api/auth/register','POST',{email:`${name}@experience.example.test`,displayName:`Experience ${name}`,password:'Complete starter experience passphrase!'},null);users[name]={...ok(r,201).user,cookie:r.cookie};}});
after(async()=>{if(server)await new Promise(r=>server.close(r));if(database)await database.close();});

test('all three complete starter experiences remain deliberately bounded',()=>{for(const theme of ['fantasy','cyberpunk','wasteland']){const x=STARTER_EXPERIENCES[theme];assert.equal(x.themeId,theme);assert.equal(x.version,1);assert.equal(x.connectionCards.length,6);assert.equal(ARC_STARTERS[theme].length,3);assert.ok(PROJECT_STARTERS[theme]);assert.equal(PROJECT_STARTERS[theme].milestones.length,3);assert.ok(x.assignmentSuggestions.length>=2);assert.match(x.duration,/30/);}});

test('preview precedes organizer-only repeat-safe installation and installation creates authored definitions only',async()=>{const ev=ok(await request('/api/events','POST',{name:'Lantern Gathering test',setup:defaultSetup('fantasy','blank')}),201).event;await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')",[ev.id,users.player.id]);const base=`/api/events/${ev.id}/experience`;const preview=ok(await request(`${base}/preview`));assert.equal(preview.manager,true);assert.equal(preview.experience.title,'The Lantern Gathering');assert.equal(preview.experience.connectionCards.length,6);assert.equal(preview.experience.arcs.length,3);assert.equal(preview.installs.length,0);assert.equal((await request(`${base}/install`,'POST',{confirm:true},users.player)).status,403);assert.equal((await request(`${base}/install`,'POST',{})).status,400);
 const first=ok(await request(`${base}/install`,'POST',{confirm:true}),201);assert.equal(first.installed,true);const second=ok(await request(`${base}/install`,'POST',{confirm:true}));assert.equal(second.installed,false);
 assert.equal((await pool.query('SELECT count(*)::int n FROM starter_experience_installs WHERE event_id=$1',[ev.id])).rows[0].n,1);
 assert.equal((await pool.query("SELECT count(*)::int n FROM connection_templates WHERE event_id=$1 AND source_key LIKE 'experience:lantern-gathering:%'",[ev.id])).rows[0].n,6);
 assert.equal((await pool.query("SELECT count(*)::int n FROM character_arc_templates WHERE event_id=$1 AND source='starter'",[ev.id])).rows[0].n,3);
 assert.equal((await pool.query("SELECT count(*)::int n FROM community_projects WHERE event_id=$1 AND source='starter'",[ev.id])).rows[0].n,1);
 for(const table of ['connection_assignments','connection_confirmations','character_arc_states','community_project_contributions','community_project_receipts','community_project_effects','community_project_refunds']){const q=table==='connection_confirmations'?`SELECT count(*)::int n FROM ${table} c JOIN connection_assignments a ON a.id=c.assignment_id WHERE a.event_id=$1`:`SELECT count(*)::int n FROM ${table} WHERE event_id=$1`;assert.equal((await pool.query(q,[ev.id])).rows[0].n,0,`${table} must remain empty after authored bundle installation`);}
 const after=ok(await request(`${base}/preview`));assert.equal(after.installs.length,1);assert.equal(after.installs[0].starter_key,'lantern-gathering');assert.equal(after.installs[0].starter_version,1);
});
