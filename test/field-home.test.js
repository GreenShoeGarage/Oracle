import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';

const source=await readFile('public/field-home.js','utf8');
const html='<!doctype html><main id="field-home"></main>';
const response=data=>({ok:true,status:200,text:async()=>JSON.stringify(data)});
async function settle(dom){for(let i=0;i<20;i++){await new Promise(r=>setTimeout(r,0));if(!dom.window.document.querySelector('.field-loading'))break;}}

test('Field Home recommends an offered or kept connection before lower-priority field actions',async()=>{
 const dom=new JSDOM(html,{url:'https://oracle.example/field-home.html?event=e1',runScripts:'outside-only'});
 const map=new Map([
  ['/api/session',{user:{id:'u1'}}],
  ['/api/events',{events:[{id:'e1',name:'Lantern Gathering',status:'live',role:'player'}]}],
  ['/api/events/e1/characters',{characters:[{id:'c1',userId:'u1',visibility:'private',status:'approved',profile:{name:'Mara'}}]}],
  ['/api/events/e1/connections',{assignments:[{id:'a1',status:'kept',title:'A Little Local Knowledge'}]}],
  ['/api/events/e1/projects',{projects:[{id:'p1',status:'open',title:'Restore the Border Lantern'}]}],
  ['/api/events/e1/arcs?characterId=c1',{current:{template:{title:'Learning to Trust'},promptStates:['open','open','open']}}]
 ]);
 dom.window.fetch=async input=>{const path=new URL(String(input),dom.window.location.origin).pathname+new URL(String(input),dom.window.location.origin).search;if(!map.has(path))throw new Error(`Unexpected request ${path}`);return response(map.get(path));};
 dom.window.eval(source);await settle(dom);
 const text=dom.window.document.body.textContent;
 assert.match(text,/Suggested next action/);assert.match(text,/Meet someone/);assert.match(text,/A Little Local Knowledge/);assert.match(text,/Mara/);assert.match(text,/Explore the world/);
 const primary=dom.window.document.querySelector('.field-hero .field-action');assert.match(primary.getAttribute('href'),/^\/connections\.html/);
});

test('Field Home fails closed offline and points only to prepared or saved material',async()=>{
 const dom=new JSDOM(html,{url:'https://oracle.example/field-home.html',runScripts:'outside-only'});
 dom.window.fetch=async()=>{throw new Error('network unavailable');};
 dom.window.eval(source);await settle(dom);
 const text=dom.window.document.body.textContent;
 assert.match(text,/You’re offline/);assert.match(text,/Last-confirmed copies may be older/);assert.match(text,/Prepared connection cards/);assert.match(text,/Saved project snapshots/);assert.match(text,/require a connection/);
 assert.equal(dom.window.document.querySelectorAll('.field-bottom a').length,3);
});

test('Field Home CSS retains narrow-screen, safe-area, forced-colors and reduced-motion support',async()=>{
 const css=await readFile('public/field-home.css','utf8');
 for(const marker of ['@media(max-width:720px)','env(safe-area-inset-bottom)','@media(forced-colors:active)','@media(prefers-reduced-motion:reduce)','min-height:48px'])assert.ok(css.includes(marker),marker);
});
