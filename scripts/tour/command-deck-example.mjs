// Fictional, inert example rendered with the shipped organizer component.
import { JSDOM } from 'jsdom';
import { createCommandDeckUI } from '../../public/command-deck-ui.js';
export async function examples() {
  const dom=new JSDOM('<main id="screen"></main>',{url:'https://oracle.example.test/'});
  const prior=new Map();
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator})) {
    prior.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});
  }
  const event={id:'51000000-0000-4000-8000-000000000002',name:'The Lantern Gathering',status:'live',role:'owner'};
  const snapshot={event,checkedAt:'2026-09-08T17:30:00.000Z',playActive:true,readOnly:false,
    counts:{members:5,players:4,approvals:1,unassigned:0,contributions:1,openProjects:1,openScenes:1,waitingParties:1,dispatchedParties:0},
    attention:{total:3,sections:[
      {key:'approvals',title:'Character approvals',destination:'characters',total:1,items:[{id:'example-character',title:'Mara of the North Road',detail:'Character awaiting organizer approval.',destination:'character'}]},
      {key:'contributions',title:'Project contributions',destination:'projects',total:1,items:[{id:'example-contribution',projectId:'example-project',title:'Restore the Border Lantern',detail:'Submitted contribution awaiting review; it does not count yet.',destination:'project'}]},
      {key:'bulletins',title:'BROADSIDE drafts and submissions',destination:'bulletins',total:1,items:[{id:'example-bulletin',title:'A watch for the border',detail:'Draft needs editorial review.',destination:'bulletin'}]},
    ]},
    projects:{total:1,truncated:false,items:[{id:'example-project',title:'Restore the Border Lantern',status:'open',milestones:[{id:'example-milestone',title:'Prepare the watch',mode:'reviewed',accepted:1,required:2,complete:false}]}]},
    scenes:{enabled:true,total:1,truncated:false,items:[{id:'example-scene',title:'At the old tower',location:'Tower steps',availability:'open',occupied:0,capacity:6,ready:true}],upcoming:[]},
    beats:[{key:'lantern',title:'The Lantern Gathering',suggestion:'Leave space for personal scenes, then invite a useful project contribution.',unfinishedEnding:'The group agrees to return at first light.'}],
  };
  let ui;
  try {
    const state={event,view:'detail',session:{user:{id:'fictional-organizer'}}};
    ui=createCommandDeckUI({state,api:async()=>structuredClone(snapshot),shell:html=>{dom.window.document.querySelector('#screen').innerHTML=html;},esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),openTool:()=>{throw new Error('An example cannot navigate to a live workflow.');}});
    await ui.open();
    return [{id:'organizer-command-deck',title:'Organizer Command Deck',theme:'fantasy',source:'public/command-deck-ui.js',description:'Three fictional work items: a character approval, a project contribution, and a bulletin draft. The organizer opens the original workflow to decide. Private arcs, reflections, and player engagement scores are never included.',html:dom.window.document.querySelector('#screen').innerHTML}];
  } finally {
    ui?.reset();dom.window.close();for(const [key,descriptor] of prior){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}
  }
}
