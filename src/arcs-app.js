import { randomUUID } from 'node:crypto';
import { ARC_STARTERS } from './arc-starters.js';

class ArcError extends Error { constructor(status,message){ super(message); this.status=status; } }
const fail=(status,message)=>{ throw new ArcError(status,message); };
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const managers=new Set(['owner','organizer','superuser']);
const clean=(value,label,max,required=true)=>{ if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fail(400,`${label} is invalid.`); return value.trim(); };
async function json(req,max=32768){const chunks=[];let n=0;for await(const c of req){n+=c.length;if(n>max)fail(413,'Request is too large.');chunks.push(c);}try{const v=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(!v||typeof v!=='object'||Array.isArray(v))throw 0;return v;}catch{fail(400,'Invalid JSON request.');}}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(data===undefined?undefined:JSON.stringify(data));}
async function eventAccess(pool,eventId,user){if(!UUID.test(eventId))fail(404,'Event not found.');const {rows}=await pool.query(`SELECT e.id,e.status,e.setup,CASE WHEN $2::boolean THEN 'superuser' ELSE m.role END role FROM events e LEFT JOIN memberships m ON m.event_id=e.id AND m.user_id=$1 WHERE e.id=$3 AND ($2::boolean OR m.user_id IS NOT NULL)`,[user.id,user.is_superuser===true,eventId]);if(!rows[0])fail(404,'Event not found or access has been removed.');return rows[0];}
async function ownCharacter(db,eventId,characterId,userId,lock=false){if(!UUID.test(characterId||''))fail(404,'Character not found.');const q=`SELECT id,event_id,user_id,status,profile FROM characters WHERE event_id=$1 AND id=$2 AND user_id=$3${lock?' FOR UPDATE':''}`;const {rows}=await db.query(q,[eventId,characterId,userId]);if(!rows[0]||rows[0].status!=='approved')fail(404,'An approved character assigned to you is required.');return rows[0];}
const snap=row=>({id:row.id,title:row.title,summary:row.summary,startingQuestion:row.starting_question,prompts:row.prompts,closingReflection:row.closing_reflection,themeId:row.theme_id,version:row.version});
const template=row=>({...snap(row),source:row.source,published:row.published});
const state=row=>row?{id:row.id,characterId:row.character_id,template:row.template_snapshot,promptStates:row.prompt_states,status:row.status,version:row.version,startedAt:row.started_at,endedAt:row.ended_at,updatedAt:row.updated_at}:null;

export function createArcsHandler({pool}){
  return async function handle({req,res,path,method,user}){
    const match=path.match(/^\/api\/events\/([0-9a-f-]{36})\/arcs(?:\/([^/]+))?$/i);if(!match)return false;
    const eventId=match[1],action=match[2]||'',event=await eventAccess(pool,eventId,user);
    if(method==='GET'&&!action){
      const characterId=new URL(req.url,'http://oracle.local').searchParams.get('characterId');
      if(managers.has(event.role)&&!characterId){
        const {rows}=await pool.query('SELECT * FROM character_arc_templates WHERE event_id=$1 ORDER BY created_at,title',[eventId]);
        return send(res,200,{mode:'organizer',templates:rows.map(template),themeId:event.setup?.theme?.id||'fantasy'}),true;
      }
      const character=await ownCharacter(pool,eventId,characterId,user.id);
      const [{rows:templates},{rows:states}]=await Promise.all([
        pool.query('SELECT * FROM character_arc_templates WHERE event_id=$1 AND published ORDER BY created_at,title',[eventId]),
        pool.query("SELECT * FROM character_arc_states WHERE event_id=$1 AND character_id=$2 AND user_id=$3 ORDER BY updated_at DESC",[eventId,character.id,user.id])
      ]);
      const current=states.find(row=>row.status==='active')||null;
      return send(res,200,{mode:'player',character:{id:character.id,name:character.profile?.name||'Character'},templates:templates.map(template),current:state(current),history:states.filter(row=>row.status!=='active').map(state)}),true;
    }
    if(method==='POST'&&action==='install-starter'){
      if(!managers.has(event.role))fail(403,'Only an organizer can install arc starters.');if(event.status==='archived')fail(409,'Archived events are read-only.');
      const themeId=event.setup?.theme?.id;const starters=ARC_STARTERS[themeId];if(!starters)fail(400,'This event theme has no starter arc pack.');
      const inserted=[];for(const item of starters){const exists=(await pool.query('SELECT id FROM character_arc_templates WHERE event_id=$1 AND source=\'starter\' AND theme_id=$2 AND lower(title)=lower($3)',[eventId,themeId,item.title])).rows[0];if(exists)continue;const id=randomUUID();await pool.query(`INSERT INTO character_arc_templates(id,event_id,title,summary,starting_question,prompts,closing_reflection,theme_id,source,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'starter',true)`,[id,eventId,item.title,item.summary,item.startingQuestion,JSON.stringify(item.prompts),item.closingReflection,themeId]);inserted.push(id);}
      return send(res,201,{installed:inserted.length,total:starters.length}),true;
    }
    if(method==='POST'&&action==='templates'){
      if(!managers.has(event.role))fail(403,'Only an organizer can author arc templates.');if(event.status==='archived')fail(409,'Archived events are read-only.');const input=await json(req);
      if(!Array.isArray(input.prompts)||input.prompts.length<1||input.prompts.length>5)fail(400,'Use between one and five turning-point prompts.');
      const prompts=input.prompts.map((p,i)=>clean(p,`Prompt ${i+1}`,1000));const id=randomUUID();const themeId=['fantasy','cyberpunk','wasteland'].includes(input.themeId)?input.themeId:'custom';
      const row=(await pool.query(`INSERT INTO character_arc_templates(id,event_id,title,summary,starting_question,prompts,closing_reflection,theme_id,source,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'custom',$9) RETURNING *`,[id,eventId,clean(input.title,'Title',100),clean(input.summary||'','Summary',1000,false),clean(input.startingQuestion,'Starting question',1000),JSON.stringify(prompts),clean(input.closingReflection,'Closing reflection',1000),themeId,input.published!==false])).rows[0];
      return send(res,201,{template:template(row)}),true;
    }
    if(method==='PATCH'&&action==='templates'){
      if(!managers.has(event.role))fail(403,'Only an organizer can edit arc templates.');if(event.status==='archived')fail(409,'Archived events are read-only.');const input=await json(req);if(!UUID.test(input.id||'')||!Number.isInteger(input.version))fail(400,'Template identity or version is invalid.');
      const current=(await pool.query('SELECT * FROM character_arc_templates WHERE event_id=$1 AND id=$2',[eventId,input.id])).rows[0];if(!current)fail(404,'Arc template not found.');
      const prompts=input.prompts===undefined?current.prompts:input.prompts.map((p,i)=>clean(p,`Prompt ${i+1}`,1000));if(!Array.isArray(prompts)||prompts.length<1||prompts.length>5)fail(400,'Use between one and five turning-point prompts.');
      const row=(await pool.query(`UPDATE character_arc_templates SET title=$1,summary=$2,starting_question=$3,prompts=$4,closing_reflection=$5,published=$6,version=version+1,updated_at=now() WHERE event_id=$7 AND id=$8 AND version=$9 RETURNING *`,[clean(input.title??current.title,'Title',100),clean(input.summary??current.summary,'Summary',1000,false),clean(input.startingQuestion??current.starting_question,'Starting question',1000),JSON.stringify(prompts),clean(input.closingReflection??current.closing_reflection,'Closing reflection',1000),input.published===undefined?current.published:Boolean(input.published),eventId,input.id,input.version])).rows[0];if(!row)fail(409,'This arc template changed. Refresh and try again.');return send(res,200,{template:template(row)}),true;
    }
    if(method==='POST'&&action==='select'){
      if(!['draft','rehearsal','live','paused'].includes(event.status))fail(409,'Character arcs are not available in this event state.');const input=await json(req);const client=await pool.connect();try{await client.query('BEGIN');const character=await ownCharacter(client,eventId,input.characterId,user.id,true);if(!UUID.test(input.templateId||''))fail(400,'Choose an arc.');const chosen=(await client.query('SELECT * FROM character_arc_templates WHERE event_id=$1 AND id=$2 AND published',[eventId,input.templateId])).rows[0];if(!chosen)fail(404,'Arc is unavailable.');const old=(await client.query("SELECT * FROM character_arc_states WHERE character_id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[character.id,user.id])).rows[0];if(old)await client.query("UPDATE character_arc_states SET status='replaced',ended_at=now(),updated_at=now(),version=version+1 WHERE id=$1",[old.id]);const promptStates=chosen.prompts.map(()=> 'open');const id=randomUUID();const created=(await client.query(`INSERT INTO character_arc_states(id,event_id,character_id,user_id,template_id,template_snapshot,prompt_states) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,[id,eventId,character.id,user.id,chosen.id,JSON.stringify(snap(chosen)),JSON.stringify(promptStates)])).rows[0];await client.query('COMMIT');return send(res,201,{current:state(created)}),true;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    if(method==='PATCH'&&action==='progress'){
      if(!['draft','rehearsal','live','paused'].includes(event.status))fail(409,'Character arcs are not available in this event state.');const input=await json(req);if(!Number.isInteger(input.expectedVersion))fail(400,'Arc version is required.');const client=await pool.connect();try{await client.query('BEGIN');const character=await ownCharacter(client,eventId,input.characterId,user.id,true);const current=(await client.query("SELECT * FROM character_arc_states WHERE character_id=$1 AND user_id=$2 AND status='active' FOR UPDATE",[character.id,user.id])).rows[0];if(!current)fail(404,'No active arc was found.');if(current.version!==input.expectedVersion)fail(409,'Your arc changed. Refresh before updating it.');let states=[...current.prompt_states],status='active',endedAt=null;if(input.operation==='set-prompt'){if(!Number.isInteger(input.index)||input.index<0||input.index>=states.length||!['open','complete','skipped'].includes(input.value))fail(400,'Prompt update is invalid.');states[input.index]=input.value;}else if(input.operation==='end'){status='ended';endedAt='now()';}else fail(400,'Arc update is invalid.');const sql=status==='ended'?`UPDATE character_arc_states SET prompt_states=$1,status='ended',ended_at=now(),version=version+1,updated_at=now() WHERE id=$2 RETURNING *`:`UPDATE character_arc_states SET prompt_states=$1,version=version+1,updated_at=now() WHERE id=$2 RETURNING *`;const updated=(await client.query(sql,[JSON.stringify(states),current.id])).rows[0];await client.query('COMMIT');return send(res,200,{current:state(updated)}),true;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
    }
    fail(405,'Method not allowed.');
  };
}
