// User-recorded acceptance evidence. A valid report never proves an observation occurred.
import { packRecord } from './experience-pack-model.js';
export const FIELD_CHECKS=Object.freeze([
 {key:'iphone-offline',label:'iPhone: prepare, airplane mode, cold reopen, reconnect',physical:true,human:true},
 {key:'android-offline',label:'Android: prepare, airplane mode, cold reopen, reconnect',physical:true,human:true},
 {key:'camera-qr',label:'Camera, QR, denied permission, and manual-code fallback',physical:true,human:true},
 {key:'accessibility',label:'Keyboard, screen reader, zoom, outdoor contrast, and reduced motion',physical:true,human:true},
 {key:'newcomer',label:'Newcomer starts a scene without an interface explanation',physical:false,human:true},
 {key:'quiet-player',label:'Lower-pressure participation works without forced disclosure or speaking',physical:false,human:true},
 {key:'organizer',label:'An unfamiliar organizer sets up and runs a small gathering',physical:false,human:true},
 {key:'rehearsal-reset',label:'Rehearsal copy/reset preserves source and clears play history',physical:false,human:false},
 {key:'live-backup',label:'Scheduled live backup has a retained, readable artifact',physical:false,human:false},
 {key:'live-restore',label:'A live-data backup restores into an isolated recovery environment',physical:false,human:false},
 {key:'application-rollback',label:'A schema-compatible application rollback is rehearsed in isolation',physical:false,human:false},
 {key:'sustained-capacity',label:'Sustained Railway workload measured with recorded limits and duration',physical:false,human:false},
]);
export function newFieldAcceptance(version='',commit='') {return{format:'oracle-field-acceptance',formatVersion:1,release:{version,commit},humanAttested:false,checks:FIELD_CHECKS.map(c=>({key:c.key,status:'not_run',observer:'',observedAt:'',target:'',physical:false,evidence:''})),findings:[]};}
export function assessFieldAcceptance(report,{version,commit,now=Date.now()}={}) {
 const errors=[],blockers=[];let passed=0;
 const t=(x,max)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(x);
 try{
  packRecord(report,['format','formatVersion','release','humanAttested','checks','findings'],'Field acceptance');
  packRecord(report.release,['version','commit'],'Release');
  if(report.format!=='oracle-field-acceptance'||report.formatVersion!==1)throw new Error('Unsupported field report format.');
  if(!t(report.release.version,20)||!/^\d+\.\d+\.\d+$/.test(report.release.version))errors.push('Record a valid release version.');
  if(!t(report.release.commit,40)||!/^([a-f0-9]{40})?$/.test(report.release.commit))errors.push('Commit must be a full lowercase Git SHA.');
  if(!report.release.commit)blockers.push('Record the exact tested commit.');
  if(version&&version!==report.release.version||commit&&commit!==report.release.commit)blockers.push('This report describes a different release. Repeat the relevant checks for the current release.');
  if(typeof report.humanAttested!=='boolean')errors.push('Human observation attestation must be true or false.');
  if(!report.humanAttested)blockers.push('Human field observations have not been attested.');
  if(!Array.isArray(report.checks)||report.checks.length!==FIELD_CHECKS.length||new Set(report.checks.map(c=>c?.key)).size!==FIELD_CHECKS.length)throw new Error('Include each required check exactly once.');
  for(const check of report.checks){
   packRecord(check,['key','status','observer','observedAt','target','physical','evidence'],'Field check');
   const spec=FIELD_CHECKS.find(c=>c.key===check.key);if(!spec)throw new Error('Unknown field check.');
   if(!['not_run','pass','fail','blocked'].includes(check.status))errors.push(`${spec.label}: invalid status.`);
   if(!t(check.observer,120)||!t(check.observedAt,40)||!t(check.target,500)||!t(check.evidence,4000)||typeof check.physical!=='boolean')errors.push(`${spec.label}: invalid evidence fields.`);
   if(check.status==='pass'){
    passed++;
    if(!check.observer.trim()||!check.target.trim()||!check.evidence.trim()||!/^\d{4}-\d\d-\d\dT/.test(check.observedAt)||!Number.isFinite(Date.parse(check.observedAt))||Date.parse(check.observedAt)>now+60000)errors.push(`${spec.label}: a pass needs an observer, real timestamp, tested target, and evidence.`);
    if(spec.physical&&!check.physical)errors.push(`${spec.label}: record an actual physical-device observation, not emulation.`);
   }else blockers.push(`${spec.label}: ${check.status.replaceAll('_',' ')}.`);
  }
  if(!Array.isArray(report.findings)||report.findings.length>100)throw new Error('Use at most 100 findings.');
  const ids=new Set();for(const f of report.findings){packRecord(f,['key','severity','status','notes'],'Finding');if(!t(f.key,60)||!f.key||ids.has(f.key)||!['critical','major','minor'].includes(f.severity)||!['open','fixed','scheduled'].includes(f.status)||!t(f.notes,3000)||!f.notes.trim())errors.push('Findings need unique keys, severity, disposition, and evidence or a tracked next action.');ids.add(f.key);if(f.status!=='fixed'&&['critical','major'].includes(f.severity))blockers.push(`Unresolved ${f.severity} finding: ${f.key}.`);}
 }catch(e){errors.push(e.message);}
 return{valid:errors.length===0,selfReportedComplete:errors.length===0&&blockers.length===0,passed,total:FIELD_CHECKS.length,errors,blockers,notice:'Self-reported evidence only. Software tests and deployment do not establish physical-device, human field, live-backup, rollback, or sustained-capacity acceptance.'};
}
