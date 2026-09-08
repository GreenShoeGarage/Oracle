// Public examples use fictional fixtures and the actual renderer, never a live event.
import { JSDOM } from 'jsdom';
import { createExperienceStudioUI } from '../../public/experience-studio-ui.js';
import { EXPERIENCE_LIBRARY } from '../../public/experience-library.js';
import { newFieldAcceptance } from '../../public/field-acceptance-model.js';
export async function examples(){
 const dom=new JSDOM('<main id="screen"></main>',{url:'https://oracle.example.test/'}),previous=new Map();
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator})){previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});}
 const event={id:'51000000-0000-4000-8000-000000000023',name:'The Festival Gathering',status:'draft',themeId:'fantasy',version:1};
 const context={event,drafts:[],installs:[],resources:[],characters:[],release:{version:'2.3.0',commit:''}};
 const state={event,view:'detail',session:{user:{id:'fictional-organizer'}}};
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let ui;const screens=[];
 function capture(id,title,description){screens.push({id,title,theme:'fantasy',source:'public/experience-studio-ui.js',description,html:dom.window.document.querySelector('#screen').innerHTML});}
 try{
  ui=createExperienceStudioUI({state,api:async path=>path.endsWith('/acceptance')?{version:0,report:newFieldAcceptance('2.3.0','')}:structuredClone(context),shell:html=>dom.window.document.querySelector('#screen').innerHTML=html,esc,isManager:()=>true});
  await ui.open();capture('experience-library','Experience scenario library','Five fantasy starters, alongside five cyberpunk and five wasteland scenarios in their matching events. Choose a copy to customize; viewing an example installs nothing.');
  await ui.action({dataset:{action:'studio-load',key:EXPERIENCE_LIBRARY[0].key}});await ui.action({dataset:{action:'studio-step',step:'3'}});
  capture('experience-builder','Experience builder','Six guided steps connect people, personal stakes, a shared goal, instruments, and endings. Installation uses a deliberate server preview and leaves the shared project in draft.');
  await ui.action({dataset:{action:'studio-tab',tab:'acceptance'}});await ui.action({dataset:{action:'studio-report-load'}});
  capture('field-acceptance','Field acceptance evidence','An explicitly unrun checklist. Deployment is not proof of physical-device, human field, live-backup, rollback, or sustained-capacity acceptance. Evidence is organizer-recorded, not telemetry.');
  return screens;
 }finally{ui?.reset();dom.window.close();for(const [key,d]of previous){if(d)Object.defineProperty(globalThis,key,d);else delete globalThis[key];}}
}
