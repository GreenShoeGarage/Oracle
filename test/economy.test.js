import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {testDatabase} from './database.js';
import {migrate,transaction} from '../src/db.js';
import {createApp} from '../src/app.js';
import {readConfig} from '../src/config.js';
import {defaultSetup} from '../public/kit.js';
import {defaultCharacterProfile} from '../public/characters-model.js';
import {validateEconomyRequest,validateTradeAssets} from '../public/economy-model.js';
import {transferEconomyAssets,readEconomyAssets} from '../src/economy.js';
let database,pool,server,origin;const users={};
async function request(path,method='GET',data,who=users.owner){const response=await fetch(origin+path,{method,headers:{...(method!=='GET'?{'Content-Type':'application/json',Origin:origin}:{}),...(who?.cookie?{Cookie:who.cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)});const text=await response.text();return {status:response.status,data:text?JSON.parse(text):null,cookie:response.headers.get('set-cookie')?.split(';')[0]};}
function ok(result,status=200){assert.equal(result.status,status,JSON.stringify(result.data));return result.data;}
const cmd=(extra={})=>({requestId:randomUUID(),...extra});
async function fixture(){
 const setup=defaultSetup();setup.enabledInstruments=['briefing','bazaar'];const event=ok(await request('/api/events','POST',{name:'Economy rehearsal',setup}),201).event;
 await pool.query("UPDATE events SET status='rehearsal' WHERE id=$1",[event.id]);event.status='rehearsal';const chars={};
 for(const who of ['one','two']){await pool.query("INSERT INTO memberships(event_id,user_id,role) VALUES($1,$2,'player')",[event.id,users[who].id]);const profile={...defaultCharacterProfile(setup.rules),name:`Trader ${who}`};chars[who]=ok(await request(`/api/events/${event.id}/characters`,'POST',{profile},users[who]),201).character;await pool.query("UPDATE characters SET status='approved',inventory_initialized=true WHERE id=$1",[chars[who].id]);}
 const path=`/api/events/${event.id}/bazaar`;
 ok(await request(`${path}/resources`,'POST',cmd({id:'crowns',name:'Crowns'})),201);
 const shop=ok(await request(`${path}/shops`,'POST',cmd({name:'General goods',description:'Public listing',enabled:true})),201).shop;
 const stock=ok(await request(`${path}/shops/${shop.id}/stock`,'POST',cmd({name:'Ration',description:'A provision',quantity:2,resourceId:'crowns',unitPrice:4})),201).stock;
 return {event,chars,path,shop,stock};
}
async function grant(f,who,quantity,version=0,extra={}){return ok(await request(`${f.path}/adjust`,'POST',cmd({characterId:f.chars[who].id,resourceId:'crowns',quantity,version,reason:'Organizer initial allocation',...extra})));}
async function assets(f,who){return ok(await request(`${f.path}?characterId=${f.chars[who].id}`,'GET',undefined,users[who]));}
before(async()=>{database=await testDatabase();pool=database.pool;await migrate(pool);let handler;server=createServer((req,res)=>handler(req,res));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;handler=createApp({pool,config:{...readConfig({DATABASE_URL:'postgres://unused',PORT:'3000'}),origin},logger:entry=>console.error(entry)});for(const name of ['owner','one','two']){const r=await request('/api/auth/register','POST',{displayName:`Economy ${name}`,email:`${name}@economy.example.test`,password:'Economy integration passphrase!'},null);users[name]={...ok(r,201).user,cookie:r.cookie};}});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));if(database)await database.close();});

test('economy validators reject invented fields, coercion, prototype actions, duplicate assets and sparse lists',()=>{
 const input=cmd({characterId:randomUUID(),shopId:randomUUID(),stockId:randomUUID(),version:1,quantity:1});assert.deepEqual(validateEconomyRequest(input,'purchase'),input);
 for(const action of ['__proto__','constructor','toString'])assert.throws(()=>validateEconomyRequest({},action),{status:400});
 for(const bad of [{...input,quantity:'1'},{...input,quantity:-1},{...input,quantity:1.5},{...input,unitPrice:0}])assert.throws(()=>validateEconomyRequest(bad,'purchase'),{status:400});
 const item={itemId:randomUUID(),quantity:1,version:1};for(const value of [{items:[item,item],resources:[]},{items:Array(2),resources:[]},{items:[],resources:[{resourceId:'crowns',quantity:1e9+1}]}])assert.throws(()=>validateTradeAssets(value),{status:400});
});

test('purchases debit funds and finite stock atomically, retry one immutable receipt, and preserve frozen names and prices',async()=>{
 const f=await fixture();await grant(f,'one',20);const input=cmd({characterId:f.chars.one.id,shopId:f.shop.id,stockId:f.stock.id,version:1,quantity:1});
 const purchased=ok(await request(`${f.path}/purchase`,'POST',input,users.one));assert.equal(purchased.receipt.purchase.total,4);assert.equal(purchased.receipt.purchase.name,'Ration');
 const replay=ok(await request(`${f.path}/purchase`,'POST',input,users.one));assert.equal(replay.outcome.replayed,true);assert.equal(replay.receipt.id,purchased.receipt.id);
 let view=await assets(f,'one');assert.equal(view.balances[0].quantity,16);assert.equal(view.inventory[0].quantity,1);assert.equal(view.shops[0].stock[0].quantity,1);
 assert.equal((await request(`${f.path}/purchase`,'POST',{...input,quantity:2},users.one)).status,409);
 assert.equal((await request(`${f.path}/purchase`,'POST',cmd({...input,requestId:randomUUID(),version:2,quantity:2}),users.one)).status,409);
 ok(await request(`${f.path}/shops/${f.shop.id}/stock/${f.stock.id}`,'PATCH',cmd({name:'Renamed ration',description:'New listing',quantity:3,resourceId:'crowns',unitPrice:9,version:2,reason:'Stock count corrected'})));
 view=await assets(f,'one');assert.equal(view.receipts.find(r=>r.id===purchased.receipt.id).purchase.unitPrice,4);assert.equal(view.receipts.find(r=>r.id===purchased.receipt.id).purchase.name,'Ration');
 const audit=(await pool.query("SELECT details FROM audit_entries WHERE event_id=$1 AND action='economy.stockUpdate'",[f.event.id])).rows[0].details;assert.equal(audit.correction.before.quantity,1);assert.equal(audit.correction.after.unitPrice,9);
});

test('unfunded, impersonated, disabled, hidden-shop and archived spending cannot alter balances or stock',async()=>{
 const f=await fixture(),input=cmd({characterId:f.chars.one.id,shopId:f.shop.id,stockId:f.stock.id,version:1,quantity:1});
 assert.equal((await request(`${f.path}/purchase`,'POST',input,users.one)).status,409);
 assert.equal((await request(`${f.path}/purchase`,'POST',input,users.owner)).status,404);
 assert.equal((await request(`${f.path}/adjust`,'POST',cmd({characterId:f.chars.one.id,resourceId:'crowns',quantity:100,version:0,reason:'Forged'}),users.one)).status,403);
 await grant(f,'one',10);
 await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\"]') WHERE id=$1",[f.event.id]);assert.equal((await request(`${f.path}/purchase`,'POST',input,users.one)).status,409);
 await pool.query("UPDATE events SET setup=jsonb_set(setup,'{enabledInstruments}','[\"briefing\",\"bazaar\"]') WHERE id=$1",[f.event.id]);
 await pool.query('UPDATE economy_shops SET enabled=false WHERE id=$1',[f.shop.id]);assert.equal((await request(`${f.path}/purchase`,'POST',input,users.one)).status,404);assert.equal((await assets(f,'one')).shops.length,0);
 await pool.query('UPDATE economy_shops SET enabled=true WHERE id=$1',[f.shop.id]);await pool.query("UPDATE events SET status='archived' WHERE id=$1",[f.event.id]);assert.equal((await request(`${f.path}/purchase`,'POST',input,users.one)).status,409);
 assert.equal((await readEconomyAssets(pool,f.event.id,f.chars.one.id)).balances[0].quantity,10);assert.equal((await pool.query('SELECT quantity FROM economy_stock WHERE id=$1',[f.stock.id])).rows[0].quantity,2);
});

test('account-bound receipts and balances are private and reassignment cannot obtain a previous owner receipt',async()=>{
 const f=await fixture();const allocation=await grant(f,'one',30);await grant(f,'two',4);
 let own=await assets(f,'one'),peer=await assets(f,'two');assert.equal(own.receipts[0].id,allocation.receipt.id);assert.ok(!JSON.stringify(peer).includes(allocation.receipt.id));assert.equal((await request(`${f.path}/manage`,'GET',undefined,users.one)).status,403);
 await pool.query('UPDATE characters SET user_id=$2 WHERE id=$1',[f.chars.one.id,users.two.id]);assert.equal((await request(`${f.path}?characterId=${f.chars.one.id}`,'GET',undefined,users.one)).status,404);
 const reassigned=ok(await request(`${f.path}?characterId=${f.chars.one.id}`,'GET',undefined,users.two));assert.equal(reassigned.receipts.length,0);assert.equal(reassigned.balances[0].quantity,30);
});

test('transfer engine aggregates all debits, strips item notes, rejects capacity overflow and duplicate-reference changes without mutation',async()=>{
 const f=await fixture();await grant(f,'one',40);await grant(f,'two',5);
 const itemId=randomUUID();await pool.query("INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,'Map fragment',2,'SECRET route')",[itemId,f.event.id,f.chars.one.id]);
 const participants=['one','two'].map(who=>({characterId:f.chars[who].id,userId:users[who].id,name:`Trader ${who}`}));
 const command={kind:'exchange',actorUserId:users.one.id,referenceId:randomUUID(),participants,transfers:[{fromCharacterId:f.chars.one.id,toCharacterId:f.chars.two.id,items:[{itemId,quantity:1,version:1}],resources:[{resourceId:'crowns',quantity:10}]},{fromCharacterId:f.chars.two.id,toCharacterId:f.chars.one.id,items:[],resources:[{resourceId:'crowns',quantity:2}]}]};
 const run=value=>transaction(pool,db=>transferEconomyAssets(db,f.event,value));
 const receipt=await run(command);assert.equal(receipt.transfers[0].items[0].name,'Map fragment');assert.ok(!JSON.stringify(receipt).includes('SECRET'));
 assert.equal((await run(command)).id,receipt.id);assert.equal((await readEconomyAssets(pool,f.event.id,f.chars.one.id)).balances[0].quantity,32);assert.equal((await readEconomyAssets(pool,f.event.id,f.chars.two.id)).balances[0].quantity,13);
 const receiver=(await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 AND character_id=$2',[f.event.id,f.chars.two.id])).rows[0];assert.equal(receiver.notes,'');
 await assert.rejects(()=>run({...command,actorUserId:users.two.id}),{status:409});await assert.rejects(()=>run({...command,transfers:[{...command.transfers[0],resources:[{resourceId:'crowns',quantity:11}]}]}),{status:409});
 const before=(await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id',[f.event.id])).rows;
 await assert.rejects(()=>run({...command,referenceId:randomUUID(),transfers:[{...command.transfers[0],items:[{itemId,quantity:1,version:2}],resources:[{resourceId:'crowns',quantity:1}]},{...command.transfers[1],resources:[{resourceId:'crowns',quantity:14}]}]}),{status:409});assert.deepEqual((await pool.query('SELECT * FROM character_inventory WHERE event_id=$1 ORDER BY id',[f.event.id])).rows,before);
});

test('purchase reference collision from another organizer rolls back its balance correction',async()=>{
 const f=await fixture();await pool.query("UPDATE memberships SET role='organizer' WHERE event_id=$1 AND user_id=$2",[f.event.id,users.two.id]);
 const requestId=randomUUID(),input={requestId,characterId:f.chars.one.id,resourceId:'crowns',quantity:10,version:0,reason:'Initial funding'};
 ok(await request(`${f.path}/adjust`,'POST',input));
 // Restore the live balance version in the request: even a disclosed request UUID
 // cannot be used by another actor to borrow a receipt or commit a second grant.
 const collision=await request(`${f.path}/adjust`,'POST',{...input,version:1,quantity:25},users.two);assert.equal(collision.status,409);
 assert.equal((await readEconomyAssets(pool,f.event.id,f.chars.one.id)).balances[0].quantity,10);assert.equal((await pool.query("SELECT count(*)::int AS n FROM economy_transactions WHERE event_id=$1 AND kind='adjustment'",[f.event.id])).rows[0].n,1);
});

test('net full-inventory barter can exchange occupied slots while resource overflow rejects the entire plan',async()=>{
 const f=await fixture();await grant(f,'one',1);await grant(f,'two',1_000_000_000);
 const ids={one:randomUUID(),two:randomUUID()};
 for(const who of ['one','two']){
  await pool.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,1,\'\')',[ids[who],f.event.id,f.chars[who].id,`${who} trade item`]);
  for(let i=0;i<99;i++)await pool.query('INSERT INTO character_inventory(id,event_id,character_id,name,quantity,notes) VALUES($1,$2,$3,$4,1,\'\')',[randomUUID(),f.event.id,f.chars[who].id,`${who} retained ${i}`]);
 }
 const participants=['one','two'].map(who=>({characterId:f.chars[who].id,userId:users[who].id,name:`Trader ${who}`}));
 const transfers=['one','two'].map(who=>({fromCharacterId:f.chars[who].id,toCharacterId:f.chars[who==='one'?'two':'one'].id,items:[{itemId:ids[who],quantity:1,version:1}],resources:who==='one'?[{resourceId:'crowns',quantity:1}]:[]}));
 const command={kind:'exchange',actorUserId:users.one.id,referenceId:randomUUID(),participants,transfers};
 await assert.rejects(()=>transaction(pool,db=>transferEconomyAssets(db,f.event,command)),{status:409});assert.equal((await pool.query('SELECT count(*)::int AS n FROM character_inventory WHERE id=ANY($1::uuid[])',[[ids.one,ids.two]])).rows[0].n,2);
 const receipt=await transaction(pool,db=>transferEconomyAssets(db,f.event,{...command,transfers:transfers.map(row=>({...row,resources:[]}))}));assert.equal(receipt.transfers.length,2);
 for(const who of ['one','two'])assert.equal((await readEconomyAssets(pool,f.event.id,f.chars[who].id)).inventory.length,100);
 await assert.rejects(()=>transaction(pool,db=>transferEconomyAssets(db,f.event,{...command,transfers:[]})),{status:409});
});
