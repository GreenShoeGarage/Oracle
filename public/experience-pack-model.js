// Versioned, declarative authored material only. Never an event/player backup.
export const PACK_FORMAT = 'oracle-experience-pack';
export const PACK_VERSION = 1;
export const PACK_MAX_BYTES = 400000;
export const PACK_THEMES = ['fantasy', 'cyberpunk', 'wasteland'];
const error = message => { const e = new Error(message); e.status = 400; throw e; };
const own = (o,k) => Object.hasOwn(o,k);
export function packRecord(v, keys, label='Record') {
  if (!v || typeof v!=='object' || Array.isArray(v) || ![Object.prototype,null].includes(Object.getPrototypeOf(v))) error(`${label}: expected a plain record.`);
  if (Reflect.ownKeys(v).length!==keys.length || keys.some(k=>!own(v,k))) error(`${label}: missing or unsupported fields.`);
  for (const k of keys) if (!own(Object.getOwnPropertyDescriptor(v,k),'value')) error(`${label}: executable properties are not supported.`);
  return v;
}
const text=(v,label,max,min=0)=>{if(typeof v!=='string'||v.trim().length<min||v.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v))error(`${label}: use ${min}–${max} characters of plain text.`);return v.trim();};
const key=(v,label='Identifier')=>{if(typeof v!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(v))error(`${label}: use a lowercase identifier of at most 40 characters.`);return v;};
const integer=(v,min,max,label)=>{if(!Number.isInteger(v)||v<min||v>max)error(`${label}: use a whole number from ${min} to ${max}.`);return v;};
const choice=(v,values,label)=>{if(!values.includes(v))error(`${label}: unsupported value.`);return v;};
const bool=(v,label)=>{if(typeof v!=='boolean')error(`${label}: expected true or false.`);return v;};
function list(v,max,label,min=0){if(!Array.isArray(v)||v.length<min||v.length>max||Reflect.ownKeys(v).length!==v.length+1)error(`${label}: expected ${min}–${max} entries.`);for(let i=0;i<v.length;i++)if(!own(v,i)||!own(Object.getOwnPropertyDescriptor(v,i),'value'))error(`${label}: sparse or executable entries are not supported.`);return v;}
function unique(rows,label){if(new Set(rows.map(r=>r.key)).size!==rows.length)error(`${label}: duplicate identifiers.`);return rows;}
function refs(v,allowed,label,max=12){const ids=list(v,max,label).map(x=>key(x,label));if(new Set(ids).size!==ids.length||ids.some(x=>!allowed.includes(x)))error(`${label}: duplicate or unresolved reference.`);return ids;}
export function canonicalPack(value) { return JSON.stringify(sort(value)); }
function sort(v){if(Array.isArray(v))return v.map(sort);if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])]));return v;}
export function validateExperiencePack(input) {
  packRecord(input,['format','formatVersion','key','version','themeId','title','summary','players','durationMinutes','opening','ending','unfinishedEnding','organizerNotes','roles','endingRoles','connections','arcs','resources','nodes','project'],'Experience pack');
  if(input.format!==PACK_FORMAT||input.formatVersion!==PACK_VERSION)error('Unsupported experience pack format/version. Legacy briefing packs and player backups are not experience packs.');
  packRecord(input.players,['min','max'],'Players');
  const min=integer(input.players.min,2,24,'Minimum players'),max=integer(input.players.max,min,24,'Maximum players');
  const roles=unique(list(input.roles,12,'Roles').map(r=>{packRecord(r,['key','name','brief','optional'],'Role');return{key:key(r.key),name:text(r.name,'Role name',80,1),brief:text(r.brief,'Role brief',1000,1),optional:bool(r.optional,'Optional role')};}),'Roles');
  const roleKeys=roles.map(r=>r.key);
  const connections=unique(list(input.connections,24,'Connection cards',1).map(c=>{
    packRecord(c,['key','title','situation','approach','opening','followUp','quietAlternative','roleKeys'],'Connection card');
    return{key:key(c.key),title:text(c.title,'Card title',80,1),situation:text(c.situation,'Situation',500,1),approach:text(c.approach,'Approach',160,1),opening:text(c.opening,'Opening line',500,1),followUp:text(c.followUp,'Follow-up',500),quietAlternative:text(c.quietAlternative,'Lower-pressure alternative',500),roleKeys:refs(c.roleKeys,roleKeys,'Card roles')};
  }),'Connection cards');
  const arcs=unique(list(input.arcs,12,'Arcs',1).map(a=>{packRecord(a,['key','title','summary','startingQuestion','prompts','closingReflection'],'Arc');return{key:key(a.key),title:text(a.title,'Arc title',100,1),summary:text(a.summary,'Arc summary',1000),startingQuestion:text(a.startingQuestion,'Starting question',1000,1),prompts:list(a.prompts,5,'Arc prompts',1).map(p=>text(p,'Arc prompt',1000,1)),closingReflection:text(a.closingReflection,'Closing reflection',1000,1)};}),'Arcs');
  const resources=unique(list(input.resources,10,'Resource dependencies').map(r=>{packRecord(r,['key','name'],'Resource dependency');return{key:key(r.key),name:text(r.name,'Resource name',80,1)};}),'Resources');
  const nodes=unique(list(input.nodes,20,'Instruments').map(n=>{
    packRecord(n,['key','type','title','text','after','answer','successText','failureText','location','durationMinutes'],'Instrument');
    const type=choice(n.type,['relic','dead_drop','cipherbox','wayfinder'],'Instrument type');
    return{key:key(n.key),type,title:text(n.title,'Instrument title',120,1),text:text(n.text,'Instrument text',4000,1),after:list(n.after,10,'Earlier instruments').map(v=>key(v)),answer:text(n.answer,'Puzzle answer',80,type==='cipherbox'?1:0),successText:text(n.successText,'Success reading',2000,type==='cipherbox'?1:0),failureText:text(n.failureText,'Fallback reading',2000,type==='cipherbox'?1:0),location:text(n.location,'Location',160),durationMinutes:integer(n.durationMinutes,1,120,'Scene duration')};
  }),'Instruments');
  const byId=new Map(nodes.map(n=>[n.key,n])),visiting=new Set(),visited=new Set();
  function visit(id){if(visiting.has(id))error('Instrument prerequisites contain a cycle.');if(visited.has(id))return;visiting.add(id);const n=byId.get(id);refs(n.after,[...byId.keys()],'Instrument prerequisites');for(const other of n.after)visit(other);visiting.delete(id);visited.add(id);}
  nodes.forEach(n=>visit(n.key));
  const p=input.project;packRecord(p,['key','title','purpose','routes','milestones','outcomeText','consequences'],'Community project');
  const routes=unique(list(p.routes,12,'Contribution routes',1).map(r=>{packRecord(r,['key','label','help','lowPressure'],'Route');return{key:key(r.key),label:text(r.label,'Route label',100,1),help:text(r.help,'Route help',1000,1),lowPressure:bool(r.lowPressure,'Lower-pressure route')};}),'Routes');
  const milestones=unique(list(p.milestones,12,'Milestones',1).map(m=>{
    packRecord(m,['key','title','description','requiredCount','countingRule','mode','resourceKey','allowedEvidence'],'Milestone');
    const mode=choice(m.mode,['reviewed','evidence','resource'],'Contribution mode');
    const resourceKey=m.resourceKey===null?null:key(m.resourceKey);
    const evidence=list(m.allowedEvidence,4,'Evidence types').map(e=>choice(e,['relic','dead_drop','sigil','oath'],'Evidence type'));
    if(new Set(evidence).size!==evidence.length)error('Evidence types must be unique.');
    if(mode==='resource'&&(!resourceKey||!resources.some(r=>r.key===resourceKey)))error('Resource milestone has an unresolved resource dependency.');
    if(mode!=='resource'&&resourceKey!==null)error('Only resource milestones may reference a resource.');
    if((mode==='evidence')!==Boolean(evidence.length))error('Only evidence milestones require one or more evidence types.');
    return{key:key(m.key),title:text(m.title,'Milestone title',160,1),description:text(m.description,'Milestone description',2000),requiredCount:integer(m.requiredCount,1,1000,'Required count'),countingRule:choice(m.countingRule,['distinct_accounts','accepted_contributions'],'Counting rule'),mode,resourceKey,allowedEvidence:evidence};
  }),'Milestones');
  const consequences=unique(list(p.consequences,8,'Consequences').map(c=>{packRecord(c,['key','kind','title','body','audience'],'Consequence');if(c.audience!=='event')error('Experience pack v1 supports explicit event-wide consequences only; player and faction identifiers cannot be exported.');return{key:key(c.key),kind:choice(c.kind,['content_unlock','broadside_draft'],'Consequence kind'),title:text(c.title,'Consequence title',160,1),body:text(c.body,'Consequence body',6000,1),audience:'event'};}),'Consequences');
  const result={format:PACK_FORMAT,formatVersion:PACK_VERSION,key:key(input.key),version:integer(input.version,1,1000000,'Pack version'),themeId:choice(input.themeId,PACK_THEMES,'Theme'),title:text(input.title,'Title',120,1),summary:text(input.summary,'Summary',1000),players:{min,max},durationMinutes:integer(input.durationMinutes,15,180,'Experience duration'),opening:text(input.opening,'Opening',3000,1),ending:text(input.ending,'Ending',3000,1),unfinishedEnding:text(input.unfinishedEnding,'Unfinished ending',3000,1),organizerNotes:text(input.organizerNotes,'Organizer notes',4000),roles,endingRoles:refs(input.endingRoles,roleKeys,'Ending roles'),connections,arcs,resources,nodes,project:{key:key(p.key),title:text(p.title,'Project title',120,1),purpose:text(p.purpose,'Project purpose',3000,1),routes,milestones,outcomeText:text(p.outcomeText,'Project outcome',3000,1),consequences}};
  if(new TextEncoder().encode(canonicalPack(result)).length>PACK_MAX_BYTES)error('Experience pack exceeds the 400 KB limit.');
  return result;
}
export function requiredInstruments(pack) {
  const names={dead_drop:'dead-drop',oath:'oathbook'};
  return [...new Set([...pack.nodes.map(n=>names[n.type]||n.type),...pack.project.milestones.flatMap(m=>m.allowedEvidence.map(e=>names[e]||e)),...(pack.resources.length?['bazaar']:[]),...(pack.project.consequences.some(c=>c.kind==='broadside_draft')?['broadside']:[])])].sort();
}
export function assessExperiencePack(value,context={}) {
  let pack;try{pack=validateExperiencePack(value);}catch(e){return{valid:false,errors:[e.message],warnings:[],requiredInstruments:[]};}
  const errors=[],warnings=[];
  if(context.themeId&&context.themeId!==pack.themeId)errors.push('The pack theme must match the destination event. Choose a matching event; installation never changes its theme.');
  if(!pack.project.routes.some(r=>r.lowPressure))warnings.push('Add a lower-pressure contribution route that does not require public speaking, resources, or a puzzle.');
  for(const r of pack.roles)if(!r.optional&&!pack.connections.some(c=>(!c.roleKeys.length||c.roleKeys.includes(r.key))&&c.quietAlternative))warnings.push(`${r.name} has no lower-pressure connection opening.`);
  if(pack.players.max>pack.project.routes.length)warnings.push(`${pack.players.max} players and ${pack.project.routes.length} independent contribution routes: allow shared routes or add more ways to help.`);
  for(const m of pack.project.milestones)if(m.mode!=='resource'&&m.countingRule==='distinct_accounts'&&m.requiredCount>pack.players.max)errors.push(`${m.title} requires more distinct players than this experience supports.`);
  if(context.resourceBindings)for(const r of pack.resources)if(!context.resourceBindings[r.key])errors.push(`Map the required resource: ${r.name}.`);
  if(context.roleBindings)for(const k of pack.endingRoles)if(!context.roleBindings[k])errors.push(`The ending depends on an unassigned role: ${pack.roles.find(r=>r.key===k).name}.`);
  if(context.status&&!['draft','rehearsal'].includes(context.status))errors.push('Install authored packs only in draft or rehearsal events. Existing play is never rewritten.');
  return{valid:errors.length===0,errors,warnings,requiredInstruments:requiredInstruments(pack)};
}
export function compareExperiencePacks(before,after) {
  const a=validateExperiencePack(before),b=validateExperiencePack(after),rows=[];
  for(const collection of ['roles','connections','arcs','resources','nodes'])compare(collection,a[collection],b[collection]);
  for(const collection of ['routes','milestones','consequences'])compare(`project.${collection}`,a.project[collection],b.project[collection]);
  for(const field of ['title','summary','themeId','players','durationMinutes','opening','ending','unfinishedEnding','organizerNotes','endingRoles'])if(canonicalPack(a[field])!==canonicalPack(b[field]))rows.push({path:field,change:'changed'});
  for(const field of ['key','title','purpose','outcomeText'])if(a.project[field]!==b.project[field])rows.push({path:`project.${field}`,change:'changed'});
  function compare(prefix,x,y){const m=new Map(x.map(r=>[r.key,r])),n=new Map(y.map(r=>[r.key,r]));for(const [k,r]of n)if(!m.has(k))rows.push({path:`${prefix}.${k}`,change:'added'});else if(canonicalPack(m.get(k))!==canonicalPack(r))rows.push({path:`${prefix}.${k}`,change:'changed'});for(const k of m.keys())if(!n.has(k))rows.push({path:`${prefix}.${k}`,change:'removed'});}
  return{from:a.version,to:b.version,sameKey:a.key===b.key,changes:rows};
}
