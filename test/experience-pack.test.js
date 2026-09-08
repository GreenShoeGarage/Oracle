import test from 'node:test';
import assert from 'node:assert/strict';
import { EXPERIENCE_LIBRARY, blankExperience } from '../public/experience-library.js';
import { validateExperiencePack, assessExperiencePack, compareExperiencePacks, canonicalPack } from '../public/experience-pack-model.js';
import { FIELD_CHECKS, newFieldAcceptance, assessFieldAcceptance } from '../public/field-acceptance-model.js';
const sample=()=>structuredClone(EXPERIENCE_LIBRARY[0]);
test('all fifteen authored experiences have six cards, three arcs, complete endings and working portable graphs',()=>{
 assert.equal(EXPERIENCE_LIBRARY.length,15);assert.equal(new Set(EXPERIENCE_LIBRARY.map(p=>p.key)).size,15);
 for(const theme of ['fantasy','cyberpunk','wasteland'])assert.equal(EXPERIENCE_LIBRARY.filter(p=>p.themeId===theme).length,5);
 for(const p of EXPERIENCE_LIBRARY){assert.deepEqual(validateExperiencePack(p),p);assert.equal(p.connections.length,6);assert.equal(p.arcs.length,3);assert.ok(p.project.routes.some(r=>r.lowPressure));assert.equal(assessExperiencePack(p).valid,true);assert.ok(p.ending&&p.unfinishedEnding);assert.ok(p.nodes.find(n=>n.after.length));}
 assert.equal(assessExperiencePack(blankExperience()).valid,true);
});
test('format validation excludes player state, arbitrary code fields, future formats and sparse data',()=>{
 for(const mutation of [p=>p.users=[],p=>p.contributions=[],p=>p.javascript='alert(1)',p=>p.formatVersion=2,p=>p.connections[0].assigned_user_id='private',p=>p.project.consequences[0].audience={type:'characters',ids:['private']},p=>delete p.connections[0],p=>p.players.max='6']){const p=sample();mutation(p);assert.throws(()=>validateExperiencePack(p));}
 const p=sample();Object.defineProperty(p,'title',{get(){throw Error('getter ran');}});assert.throws(()=>validateExperiencePack(p),/executable/);
 assert.throws(()=>validateExperiencePack(JSON.parse(JSON.stringify(sample()).replace('"format":','"__proto__":{},"format":'))),/unsupported/);
});
test('cycles, dangling references, wrong themes, missing resources and impossible distinct-participant counts fail validation',()=>{
 let p=sample();p.nodes[0].after=['message'];assert.throws(()=>validateExperiencePack(p),/cycle/);
 p=sample();p.nodes[0].after=['missing'];assert.throws(()=>validateExperiencePack(p),/reference/);
 p=sample();p.project.milestones[0].mode='resource';p.project.milestones[0].allowedEvidence=[];assert.throws(()=>validateExperiencePack(p),/resource dependency/);
 p=sample();p.project.milestones[0].requiredCount=8;assert.equal(assessExperiencePack(p).valid,false);
 assert.equal(assessExperiencePack(sample(),{themeId:'wasteland'}).valid,false);
 p=sample();p.endingRoles=['role-1'];assert.equal(assessExperiencePack(p,{roleBindings:{}}).valid,false);
});
test('portable comparisons preserve logical identifiers and expose added removed changed material',()=>{
 const p=sample(),q=sample();q.version++;q.title='Revised';q.connections[0].opening='A revised opening';q.nodes.pop();
 const diff=compareExperiencePacks(p,q);assert.equal(diff.from,1);assert.equal(diff.to,2);assert.ok(diff.changes.some(c=>c.path==='title'));assert.ok(diff.changes.some(c=>c.change==='removed'));assert.equal(canonicalPack(validateExperiencePack(p)),canonicalPack(p));
});
test('field acceptance never passes by deployment, blank evidence, emulation or unresolved major findings',()=>{
 const report=newFieldAcceptance('2.3.0','a'.repeat(40));let result=assessFieldAcceptance(report);assert.equal(result.valid,true);assert.equal(result.selfReportedComplete,false);
 report.humanAttested=true;report.checks.forEach(c=>Object.assign(c,{status:'pass',observer:'Test observer',observedAt:'2026-09-07T12:00:00Z',target:'Recorded specific target',physical:false,evidence:'Recorded observation reference'}));
 result=assessFieldAcceptance(report);assert.equal(result.valid,false);assert.match(result.errors.join(' '),/physical-device/);
 report.checks.forEach(c=>c.physical=true);assert.equal(assessFieldAcceptance(report).selfReportedComplete,true);
 report.findings.push({key:'blocking-issue',severity:'major',status:'scheduled',notes:'Tracked for repair'});assert.equal(assessFieldAcceptance(report).selfReportedComplete,false);
 report.findings=[];assert.equal(assessFieldAcceptance(report,{version:'2.3.1'}).selfReportedComplete,false);
 report.checks[0].evidence='';assert.equal(assessFieldAcceptance(report).valid,false);assert.equal(FIELD_CHECKS.length,12);
});
