import { randomUUID, randomInt, createHash } from 'node:crypto';
import { validateExperiencePack, assessExperiencePack, canonicalPack, compareExperiencePacks, requiredInstruments, packRecord } from '../public/experience-pack-model.js';
import { newFieldAcceptance, assessFieldAcceptance } from '../public/field-acceptance-model.js';
import { defaultAdventure, defaultAdventureNode, validateAdventure } from '../public/adventure-model.js';
import { VERSION } from './config.js';
const managers=new Set(['owner','organizer','superuser']);
const hash=v=>createHash('sha256').update(typeof v==='string'?v:canonicalPack(v)).digest('hex');
const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const code=()=>Array.from({length:20},()=>alphabet[randomInt(alphabet.length)]).join('');
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function reject(status,message){const e=new Error(message);e.status=status;throw e;}
function manager(event){if(!managers.has(event.role))reject(403,'Only an event organizer can use Experience Studio.');}
function editable(event){if(event.status==='archived')reject(409,'Archived events are read-only.');}
async function adventure(db,id){return(await db.query('SELECT definition,version FROM event_adventures WHERE event_id=$1',[id])).rows[0]||{definition:defaultAdventure(),version:0};}
function bindings(value,allowed,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))reject(400,`${label} must be a plain mapping.`);
 if(Reflect.ownKeys(value).some(k=>typeof k!=='string'||!allowed.includes(k)||!Object.hasOwn(Object.getOwnPropertyDescriptor(value,k),'value')))reject(400,`${label} has an unsupported key.`);
 return Object.fromEntries(Object.entries(value).map(([k,v])=>{if(typeof v!=='string'||v.length>100)reject(400,`${label} contains an invalid identifier.`);return[k,v];}));
}
async function boundInput(db,event,input){
 const pack=validateExperiencePack(input.pack);
 const resourceBindings=bindings(input.resourceBindings,pack.resources.map(r=>r.key),'Resource bindings');
 const roleBindings=bindings(input.roleBindings,pack.roles.map(r=>r.key),'Role bindings');
 for(const id of Object.values(resourceBindings))if(id&&!(await db.query('SELECT id FROM economy_resources WHERE event_id=$1 AND id=$2',[event.id,id])).rows.length)reject(400,'A mapped resource is not published in this event.');
 for(const id of Object.values(roleBindings))if(id&&(!uuid.test(id)||!(await db.query("SELECT c.id FROM characters c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=u.id AND m.event_id=c.event_id WHERE c.event_id=$1 AND c.id=$2 AND c.status='approved' AND NOT u.is_disabled",[event.id,id])).rows.length))reject(400,'A mapped role needs a currently approved, assigned character in this event.');
 return{pack,resourceBindings,roleBindings};
}
async function preview(db,event,input){
 const normalized=await boundInput(db,event,input),{pack,resourceBindings,roleBindings}=normalized;
 const record=await adventure(db,event.id);
 const rows=(await db.query('SELECT id,pack_version,digest,document,mapping FROM experience_pack_installs WHERE event_id=$1 AND pack_key=$2 ORDER BY pack_version DESC',[event.id,pack.key])).rows;
 const same=rows.find(r=>r.pack_version===pack.version),prior=rows[0];
 const assessment=assessExperiencePack(pack,{themeId:event.setup.theme.id,status:event.status,resourceBindings,roleBindings});
 if(pack.nodes.length&&record.definition.nodes.length+pack.nodes.length>50&&!same)assessment.errors.push('The combined adventure would exceed 50 instruments. Use a separate event.');
 if(pack.nodes.length&&!same&&(await db.query('SELECT character_id FROM adventure_runs WHERE event_id=$1 LIMIT 1',[event.id])).rows.length)assessment.errors.push('This adventure already has play history. Install into a new event or reset a dedicated rehearsal first.');
 if(same&&same.digest!==hash(pack))assessment.errors.push('This key/version was installed with different content. Increase the pack version; existing content will not be overwritten.');
 if(prior&&pack.version<prior.pack_version&&!same)assessment.errors.push('Use a version newer than the latest installed version, or a new pack key.');
 const disabled=requiredInstruments(pack).filter(i=>!event.setup.enabledInstruments.includes(i));
 if(prior&&prior.pack_version!==pack.version)assessment.warnings.push('A new version installs alongside the earlier version with fresh identifiers. Earlier customized definitions and all play history remain untouched.');
 let customization=[];
 if(prior)customization=await customizationStatus(db,event.id,prior);
 assessment.valid=assessment.errors.length===0;
 const previewToken=hash({eventId:event.id,eventVersion:event.version,adventureVersion:record.version,pack,resourceBindings,roleBindings,installed:rows.map(r=>[r.id,r.pack_version,r.digest])});
 return{...normalized,assessment,previewToken,disabled,alreadyInstalled:Boolean(same&&same.digest===hash(pack)),installId:same?.id||null,previous:prior?{id:prior.id,version:prior.pack_version,comparison:compareExperiencePacks(prior.document,pack),customization}:null,
  changes:{connectionCards:pack.connections.length,arcs:pack.arcs.length,projects:1,milestones:pack.project.milestones.length,consequences:pack.project.consequences.length,instruments:pack.nodes.length},eventVersion:event.version,adventureVersion:record.version};
}
// Bounded comparisons of authored definitions; never inspect player responses.
async function customizationStatus(db,eventId,install){
 const out=[];const mapping=install.mapping;
 for(const [kind,table]of [['connections','connection_templates'],['arcs','character_arc_templates']])for(const [key,id]of Object.entries(mapping[kind]||{})){
  const r=(await db.query(`SELECT version FROM ${table} WHERE event_id=$1 AND id=$2`,[eventId,id])).rows[0];
  if(!r||r.version!==1)out.push({kind,key,state:r?'edited':'missing'});
 }
 const p=(await db.query('SELECT version FROM community_projects WHERE event_id=$1 AND id=$2',[eventId,mapping.projectId])).rows[0];
 if(!p||p.version!==1)out.push({kind:'project',key:install.document.project.key,state:p?'changed or played':'missing'});
 const a=await adventure(db,eventId);
 for(const [key,id]of Object.entries(mapping.nodes||{})){
  const n=a.definition.nodes.find(n=>n.id===id);if(!n||hash(n)!==mapping.nodeFingerprints?.[key])out.push({kind:'node',key,state:n?'edited':'missing'});
 }
 return out;
}
async function installDefinitions(db,event,userId,pack,resourceBindings,roleBindings,{includeNodes=true}={}){
 const mapping={connections:{},arcs:{},milestones:{},consequences:{},nodes:{},nodeFingerprints:{},resourceBindings,roleBindings};
 for(const [table,limit,amount] of [['connection_templates',500,pack.connections.length],['character_arc_templates',200,pack.arcs.length],['community_projects',100,1]]){
  const n=(await db.query(`SELECT count(*)::int n FROM ${table} WHERE event_id=$1`,[event.id])).rows[0].n;if(n+amount>limit)reject(409,`Installing would exceed this event's ${table.replaceAll('_',' ')} limit.`);
 }
 for(const c of pack.connections){const id=randomUUID();mapping.connections[c.key]=id;await db.query('INSERT INTO connection_templates(id,event_id,title,situation,approach,opening,follow_up,quiet_alternative,source_key,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',[id,event.id,c.title,c.situation,c.approach,c.opening,c.followUp,c.quietAlternative,`pack:${pack.key}:${pack.version}:${c.key}`]);}
 for(const a of pack.arcs){const id=randomUUID();mapping.arcs[a.key]=id;await db.query("INSERT INTO character_arc_templates(id,event_id,title,summary,starting_question,prompts,closing_reflection,theme_id,source,published) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'custom',true)",[id,event.id,a.title,a.summary,a.startingQuestion,JSON.stringify(a.prompts),a.closingReflection,pack.themeId]);}
 const p=pack.project;mapping.projectId=randomUUID();
 await db.query("INSERT INTO community_projects(id,event_id,title,purpose,contribution_routes,outcome_text,organizer_notes,theme_id,source,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'custom','draft')",[mapping.projectId,event.id,p.title,p.purpose,JSON.stringify(p.routes.map(({key,label,help})=>({key,label,help}))),p.outcomeText,pack.organizerNotes,pack.themeId]);
 for(const [i,m]of p.milestones.entries()){const id=randomUUID();mapping.milestones[m.key]=id;await db.query('INSERT INTO community_project_milestones(id,event_id,project_id,title,description,required_count,counting_rule,position,contribution_mode,resource_id,allowed_evidence) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[id,event.id,mapping.projectId,m.title,m.description,m.requiredCount,m.countingRule,i,m.mode,m.resourceKey?resourceBindings[m.resourceKey]:null,JSON.stringify(m.allowedEvidence)]);}
 for(const [i,c]of p.consequences.entries()){const id=randomUUID();mapping.consequences[c.key]=id;await db.query('INSERT INTO community_project_consequences(id,event_id,project_id,kind,title,body,audience,position,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[id,event.id,mapping.projectId,c.kind,c.title,c.body,JSON.stringify({type:'event'}),i,userId]);}
 if(includeNodes&&pack.nodes.length){
  const a=await adventure(db,event.id),definition=structuredClone(a.definition);
  for(const n of pack.nodes)mapping.nodes[n.key]=`p${randomUUID().replaceAll('-','')}`;
  for(const n of pack.nodes){const node=defaultAdventureNode(n.type,mapping.nodes[n.key],code());node.title=n.title;node.conditions.completed=n.after.map(k=>mapping.nodes[k]);
   if(n.type==='relic')node.examinations[0].text=n.text;
   else if(n.type==='cipherbox'){node.prompt=n.text;node.answer=n.answer;node.successText=n.successText;node.failureText=n.failureText;}
   else node.body=n.text;
   if(n.type==='wayfinder'){node.location=n.location;node.durationMinutes=n.durationMinutes;node.minPlayers=1;node.maxPlayers=pack.players.max;}
   mapping.nodeFingerprints[n.key]=hash(node);definition.nodes.push(node);
  }
  validateAdventure(definition,event.setup);
  await db.query('INSERT INTO event_adventures(event_id,definition) VALUES($1,$2) ON CONFLICT(event_id) DO UPDATE SET definition=EXCLUDED.definition,version=event_adventures.version+1,updated_at=now()',[event.id,JSON.stringify(definition)]);
 }
 return mapping;
}
export function createExperienceStudioHandler({pool,config,helpers}){
 const{membership,identifier,transaction,body,send,audit,fail}=helpers;
 return async function handle({req,res,path,url,method,user}){
  const match=/^\/api\/events\/([^/]+)\/experience-studio(?:\/(drafts|installs|preview|install|acceptance))?(?:\/([^/]+))?$/.exec(path);if(!match)return false;
  if(!user)fail(401,'Sign in to continue.');if(url.search)fail(400,'Experience Studio does not accept alternate audiences or query options.');
  const eventId=identifier(match[1]),action=match[2]||'',id=match[3]?identifier(match[3]):null;
  res.setHeader('Cache-Control','private, no-store');
  const input=method==='GET'?null:await body(req,500000);
  const result=await transaction(pool,async db=>{
   const event=await membership(db,eventId,user.id,method!=='GET');manager(event);
   if(method==='GET'){
    if(!action){const drafts=(await db.query("SELECT id,document->>'title' title,document->>'key' key,version,updated_at FROM experience_pack_drafts WHERE event_id=$1 ORDER BY updated_at DESC LIMIT 100",[eventId])).rows;
     const installs=(await db.query("SELECT id,pack_key,pack_version,digest,document->>'title' title,installed_at FROM experience_pack_installs WHERE event_id=$1 ORDER BY installed_at DESC LIMIT 100",[eventId])).rows;
     const resources=(await db.query('SELECT id,name FROM economy_resources WHERE event_id=$1 ORDER BY name',[eventId])).rows;
     const characters=(await db.query("SELECT c.id,c.profile->>'name' name FROM characters c JOIN users u ON u.id=c.user_id JOIN memberships m ON m.user_id=u.id AND m.event_id=c.event_id WHERE c.event_id=$1 AND c.status='approved' AND NOT u.is_disabled ORDER BY c.profile->>'name'",[eventId])).rows;
     return{data:{event:{id:event.id,name:event.name,status:event.status,version:event.version,themeId:event.setup.theme.id},drafts,installs,resources,characters,release:{version:VERSION,commit:config.deploymentCommit||''}}};
    }
    if(action==='drafts'&&id){const r=(await db.query('SELECT id,document,version FROM experience_pack_drafts WHERE event_id=$1 AND id=$2',[eventId,id])).rows[0];if(!r)fail(404,'Draft not found.');return{data:r};}
    if(action==='installs'&&id){const r=(await db.query('SELECT id,document,mapping,pack_version,digest FROM experience_pack_installs WHERE event_id=$1 AND id=$2',[eventId,id])).rows[0];if(!r)fail(404,'Installed pack not found.');return{data:{id:r.id,document:validateExperiencePack(r.document),mapping:r.mapping,digest:r.digest,customization:await customizationStatus(db,eventId,r),note:'This exports the authored pack as installed. Later source-workspace edits and all player history are excluded.'}};}
    if(action==='acceptance'&&!id){const row=(await db.query('SELECT report,version FROM field_acceptance_reports WHERE event_id=$1',[eventId])).rows[0]||{version:0,report:newFieldAcceptance(VERSION,config.deploymentCommit||'')};return{data:{...row,assessment:assessFieldAcceptance(row.report,{version:VERSION,commit:config.deploymentCommit})}};}
    fail(404,'Not found.');
   }
   editable(event);
   if(action==='preview'&&method==='POST'&&!id){packRecord(input,['pack','resourceBindings','roleBindings'],'Preview');return{data:await preview(db,event,input)};}
   if(action==='install'&&method==='POST'&&!id){
    packRecord(input,['pack','resourceBindings','roleBindings','previewToken','confirm','enableInstruments','additiveVersion'],'Installation');
    if(input.confirm!==true||typeof input.enableInstruments!=='boolean'||typeof input.additiveVersion!=='boolean')fail(400,'Preview and explicitly confirm the installation choices.');
    const p=await preview(db,event,input),fingerprint=hash({pack:p.pack,resourceBindings:p.resourceBindings,roleBindings:p.roleBindings,enableInstruments:input.enableInstruments,additiveVersion:input.additiveVersion});
    if(p.alreadyInstalled){const old=(await db.query('SELECT mapping FROM experience_pack_installs WHERE id=$1 AND event_id=$2',[p.installId,eventId])).rows[0];if(old.mapping.requestFingerprint!==fingerprint)fail(409,'This pack was installed with different choices. Open its installation record.');return{data:{installed:false,id:p.installId,mapping:old.mapping}};}
    if(!p.assessment.valid)fail(409,p.assessment.errors.join(' '));
    if(p.previewToken!==input.previewToken)fail(409,'The event, pack, or dependencies changed. Preview again before installing.');
    if(p.previous&&!input.additiveVersion)fail(409,'Confirm a separate new-version installation; previous definitions are never overwritten.');
    if(p.disabled.length&&!input.enableInstruments)fail(409,`Explicitly enable required instruments: ${p.disabled.join(', ')}.`);
    if((await db.query('SELECT count(*)::int n FROM experience_pack_installs WHERE event_id=$1',[eventId])).rows[0].n>=100)fail(409,'This event has reached its 100-pack installation limit.');
    const setup=structuredClone(event.setup);setup.enabledInstruments=[...new Set([...setup.enabledInstruments,...p.disabled])];
    const mapping=await installDefinitions(db,{...event,setup},user.id,p.pack,p.resourceBindings,p.roleBindings);mapping.requestFingerprint=fingerprint;
    await db.query('UPDATE events SET setup=$2,version=version+1,updated_at=now() WHERE id=$1',[eventId,JSON.stringify(setup)]);
    const installId=randomUUID();await db.query('INSERT INTO experience_pack_installs(id,event_id,pack_key,pack_version,digest,document,mapping,installed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[installId,eventId,p.pack.key,p.pack.version,hash(p.pack),JSON.stringify(p.pack),JSON.stringify(mapping),user.id]);
    await audit(db,eventId,user.id,'experience_pack.installed',{installId,packKey:p.pack.key,packVersion:p.pack.version,digest:hash(p.pack)});
    return{status:201,data:{installed:true,id:installId,mapping,note:'Authored cards and arcs are available. The project remains a draft. Assign cards and characters, review the adventure, and open the project deliberately.'}};
   }
   if(action==='drafts'&&['POST','PUT'].includes(method)&&((method==='POST'&&!id)||(method==='PUT'&&id))){
    packRecord(input,['document','version'],'Draft save');const document=validateExperiencePack(input.document);if(document.themeId!==event.setup.theme.id)fail(400,'Use the destination event theme.');
    if(!Number.isInteger(input.version)||input.version<0)fail(400,'A draft revision is required.');
    if(!id){if(input.version!==0)fail(409,'New drafts start at revision zero.');if((await db.query('SELECT count(*)::int n FROM experience_pack_drafts WHERE event_id=$1',[eventId])).rows[0].n>=100)fail(409,'This event has reached its draft limit.');const draftId=randomUUID();await db.query('INSERT INTO experience_pack_drafts(id,event_id,document,created_by) VALUES($1,$2,$3,$4)',[draftId,eventId,JSON.stringify(document),user.id]);return{status:201,data:{id:draftId,document,version:1}};}
    const row=(await db.query('UPDATE experience_pack_drafts SET document=$3,version=version+1,updated_at=now() WHERE event_id=$1 AND id=$2 AND version=$4 RETURNING id,document,version',[eventId,id,JSON.stringify(document),input.version])).rows[0];if(!row)fail(409,'The draft changed or is no longer available. Export your unsaved work, then reopen it.');return{data:row};
   }
   if(action==='acceptance'&&method==='PUT'&&!id){packRecord(input,['report','version'],'Acceptance save');const assessment=assessFieldAcceptance(input.report);if(!assessment.valid)fail(400,assessment.errors.join(' '));
    const current=(await db.query('SELECT version FROM field_acceptance_reports WHERE event_id=$1',[eventId])).rows[0]?.version||0;if(current!==input.version)fail(409,'The acceptance report changed. Export your work and reload before saving.');
    const row=(await db.query('INSERT INTO field_acceptance_reports(event_id,report,version,updated_by) VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO UPDATE SET report=EXCLUDED.report,version=EXCLUDED.version,updated_by=EXCLUDED.updated_by,updated_at=now() RETURNING report,version',[eventId,JSON.stringify(input.report),current+1,user.id])).rows[0];
    await audit(db,eventId,user.id,'field_acceptance.recorded',{selfReported:true,version:row.version});return{data:{...row,assessment:assessFieldAcceptance(row.report,{version:VERSION,commit:config.deploymentCommit})}};
   }
   fail(405,'Method not allowed.');
  });
  // Recheck current authority after releasing the transaction; never deliver a
  // private report to an account that lost access while it was assembled.
  const latest=await membership(pool,eventId,user.id);manager(latest);
  send(res,result.status||200,result.data);return true;
 };
}
