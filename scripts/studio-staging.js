// Authenticated writes are called only by the allowlisted disposable staging journey.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EXPERIENCE_LIBRARY } from '../public/experience-library.js';
import { defaultSetup } from '../public/kit.js';
import { defaultCharacterProfile } from '../public/characters-model.js';
export async function exerciseExperienceStudio({owner,player,request,createEvent,ownedEvents,pass}) {
 for(const theme of ['fantasy','cyberpunk','wasteland']){
  const pack=structuredClone(EXPERIENCE_LIBRARY.find(p=>p.themeId===theme));
  const event=await createEvent(owner,`Experience Studio ${theme} ${randomUUID()}`,defaultSetup(theme));
  const base=`/api/events/${event.id}`,studio=base+'/experience-studio';
  const {invitation}=await request(owner,base+'/invites',{method:'POST',body:{role:'player',maxUses:1,expiresInHours:1},status:201});
  await request(player,'/api/events/join',{method:'POST',body:{code:invitation.code}});
  await request(player,studio,{status:403});
  const report=await request(owner,studio+'/acceptance');assert.equal(report.version,0,'Field evidence must start unrun.');assert.equal(report.assessment.selfReportedComplete,false,'A deployed release is not field acceptance.');
  const saved=await request(owner,studio+'/drafts',{method:'POST',body:{document:pack,version:0},status:201});
  assert.equal(saved.version,1,'Authoring draft persists independently of installed definitions.');
  const input={pack,resourceBindings:{},roleBindings:{}};
  const preview=await request(owner,studio+'/preview',{method:'POST',body:input});assert.equal(preview.assessment.valid,true,'The themed pack has a valid installation preview.');
  const body={...input,previewToken:preview.previewToken,confirm:true,enableInstruments:true,additiveVersion:false};
  const install=await request(owner,studio+'/install',{method:'POST',body,status:201});
  const replay=await request(owner,studio+'/install',{method:'POST',body});assert.equal(replay.id,install.id,'Exact retry retains one installation.');assert.equal(replay.installed,false,'Retry creates no duplicate content.');
  const exported=await request(owner,studio+'/installs/'+install.id);assert.deepEqual(exported.document,pack,'Export preserves the original portable authored pack.');assert.equal(Object.hasOwn(exported.document,'mapping'),false,'Portable exports contain no event mapping.');
  await request(player,studio+'/installs/'+install.id,{status:403});
  const projectBase=base+'/projects/'+install.mapping.projectId;
  const project=await request(owner,projectBase);assert.equal(project.project.status,'draft','Installation leaves the project in draft.');assert.equal(project.contributions.length,0,'Installation creates no player contributions.');
  const roster=await request(owner,base+'/characters');assert.equal(roster.characters.length,0,'Installation does not create or assign players.');
  const chars={};
  for(const [key,account]of [['owner',owner],['player',player]]){
   let character=(await request(account,base+'/characters',{method:'POST',body:{profile:{...defaultCharacterProfile(event.setup.rules),name:`Studio ${key}`}},status:201})).character;
   character=(await request(account,`${base}/characters/${character.id}/submit`,{method:'POST',body:{version:character.version}})).character;
   if(character.status!=='approved')character=(await request(owner,`${base}/characters/${character.id}/review`,{method:'POST',body:{version:character.version,decision:'approve',feedback:''}})).character;
   chars[key]=character;
  }
  const current=(await request(owner,base)).event;
  await request(owner,base,{method:'PATCH',body:{version:current.version,status:'rehearsal'}});
  const adventure=await request(owner,base+'/adventure/manage'),node=adventure.definition.nodes.find(n=>n.id===install.mapping.nodes.observation);
  await request(player,base+'/adventure/action',{method:'POST',body:{requestId:randomUUID(),characterId:chars.player.id,nodeId:node.id,version:adventure.version,kind:'examine',examId:node.examinations[0].id,code:node.code}});
  await request(owner,projectBase+'/status',{method:'PATCH',body:{version:project.project.version,status:'open'}});
  const eligible=(await request(player,projectBase+`/integrations?characterId=${chars.player.id}`)).evidence.find(e=>e.kind==='relic');assert.ok(eligible,'The new authored discovery is eligible evidence.');
  await request(player,projectBase+'/evidence',{method:'POST',status:201,body:{requestId:randomUUID(),characterId:chars.player.id,milestoneId:project.milestones.find(m=>m.contributionMode==='evidence').id,sourceKind:'relic',sourceId:eligible.id,summary:'Staging verified discovery.'}});
  for(const milestone of project.milestones.filter(m=>m.contributionMode==='reviewed'))for(const [key,account]of [['player',player],['owner',owner]].slice(0,milestone.requiredCount)){
   const contribution=(await request(account,projectBase+'/contributions',{method:'POST',status:201,body:{requestId:randomUUID(),characterId:chars[key].id,milestoneId:milestone.id,routeKey:pack.project.routes[0].key,summary:'Staging scene contribution.'}})).contribution;
   await request(owner,projectBase+'/review',{method:'PATCH',body:{contributionId:contribution.id,version:contribution.version,decision:'accepted',reviewNote:'Confirmed in automated rehearsal.'}});
  }
  assert.equal((await request(owner,projectBase)).project.status,'completed','Accepted contributions complete the authored project.');
  assert.equal((await request(player,projectBase+`/unlocks?characterId=${chars.player.id}`)).unlocks.length,1,'Completion creates one permitted ending.');
  const copy=(await request(owner,base+'/adventure/rehearsal',{method:'POST',body:{},status:201})).event;ownedEvents.push({account:owner,id:copy.id});
  const copyStudio=`/api/events/${copy.id}/experience-studio`,copied=(await request(owner,copyStudio)).installs;
  assert.equal(copied.length,1,'Rehearsals retain pack provenance.');const copiedPack=await request(owner,copyStudio+'/installs/'+copied[0].id);assert.notEqual(copiedPack.mapping.projectId,install.mapping.projectId,'Rehearsal record IDs are remapped.');
  const copyProject=await request(owner,`/api/events/${copy.id}/projects/${copiedPack.mapping.projectId}`);assert.equal(copyProject.project.status,'draft','Rehearsals do not inherit completion.');assert.equal(copyProject.contributions.length,0,'Rehearsals do not inherit player claims.');
  const manage=await request(owner,`/api/events/${copy.id}/adventure/manage`);await request(owner,`/api/events/${copy.id}/adventure/reset`,{method:'POST',body:{version:manage.version,confirm:true}});
  assert.equal((await request(owner,projectBase)).project.status,'completed','Reset does not change source completion.');
  pass(`Experience Studio ${theme}: draft, preview, install, exact retry, author-only export, original discovery, accepted contributions, ending, and isolated rehearsal/reset`);
 }
}
